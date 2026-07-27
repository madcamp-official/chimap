import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type Coordinate,
  type NormalizedRoute,
  type RouteLeg,
} from "@chimap/contracts";
import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import { MemoryCache } from "../services/cache.js";
import type {
  SubwayRoutingEdge,
  SubwayRoutingGraph,
  SubwayRoutingStation,
} from "../transit/transit-repository.js";
import type { TransitService } from "../transit/transit-service.js";
import type {
  MobilityProvider,
  TransitRouteRequest,
} from "./types.js";

const SUBWAY_SEARCH_RADIUS_METERS = 2_500;
const SUBWAY_STATION_CANDIDATE_LIMIT = 6;

export type SubwayPathCandidate = {
  stations: SubwayRoutingStation[];
  edges: SubwayRoutingEdge[];
  accessDistanceMeters: number;
  egressDistanceMeters: number;
  waitingDurationSeconds: number;
  ridingDurationSeconds: number;
  transferDurationSeconds: number;
  scoreSeconds: number;
};

function coordinate(station: SubwayRoutingStation): Coordinate {
  return { lat: station.latitude, lng: station.longitude };
}

function kstRoutingPeriod(at: Date): {
  dayGroup: "WEEKDAY" | "WEEKEND_HOLIDAY";
  timePeriod:
    | "EARLY_MORNING"
    | "MORNING_PEAK"
    | "DAYTIME"
    | "EVENING_PEAK"
    | "LATE_NIGHT";
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 12);
  return {
    dayGroup:
      weekday === "Sat" || weekday === "Sun"
        ? "WEEKEND_HOLIDAY"
        : "WEEKDAY",
    timePeriod:
      hour < 7
        ? "EARLY_MORNING"
        : hour < 10
          ? "MORNING_PEAK"
          : hour < 17
            ? "DAYTIME"
            : hour < 20
              ? "EVENING_PEAK"
              : "LATE_NIGHT",
  };
}

function closestStations(
  stations: readonly SubwayRoutingStation[],
  point: Coordinate,
): Array<{ station: SubwayRoutingStation; distanceMeters: number }> {
  return stations
    .map((station) => ({
      station,
      distanceMeters: haversineDistanceMeters(point, coordinate(station)),
    }))
    .filter((candidate) => candidate.distanceMeters <= SUBWAY_SEARCH_RADIUS_METERS)
    .sort((first, second) => first.distanceMeters - second.distanceMeters)
    .slice(0, SUBWAY_STATION_CANDIDATE_LIMIT);
}

function reconstructPath(
  startNodeId: string,
  destinationNodeId: string,
  previous: Map<string, SubwayRoutingEdge>,
): SubwayRoutingEdge[] | undefined {
  const result: SubwayRoutingEdge[] = [];
  let current = destinationNodeId;
  while (current !== startNodeId) {
    const edge = previous.get(current);
    if (edge === undefined) {
      return undefined;
    }
    result.push(edge);
    current = edge.fromNodeId;
  }
  return result.reverse();
}

function dijkstra(
  graph: SubwayRoutingGraph,
  startNodeId: string,
): Map<string, SubwayRoutingEdge> {
  const adjacency = new Map<string, SubwayRoutingEdge[]>();
  for (const edge of graph.edges) {
    const edges = adjacency.get(edge.fromNodeId) ?? [];
    edges.push(edge);
    adjacency.set(edge.fromNodeId, edges);
  }
  const distance = new Map<string, number>([[startNodeId, 0]]);
  const previous = new Map<string, SubwayRoutingEdge>();
  const queue: Array<{ nodeId: string; distance: number }> = [
    { nodeId: startNodeId, distance: 0 },
  ];
  while (queue.length > 0) {
    queue.sort((first, second) => second.distance - first.distance);
    const current = queue.pop()!;
    if (current.distance !== distance.get(current.nodeId)) {
      continue;
    }
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistance = current.distance + edge.durationSeconds;
      if (nextDistance >= (distance.get(edge.toNodeId) ?? Infinity)) {
        continue;
      }
      distance.set(edge.toNodeId, nextDistance);
      previous.set(edge.toNodeId, edge);
      queue.push({ nodeId: edge.toNodeId, distance: nextDistance });
    }
  }
  return previous;
}

function pathDurations(edges: readonly SubwayRoutingEdge[]): {
  waiting: number;
  riding: number;
  transfer: number;
} {
  let waiting = 0;
  let riding = 0;
  let transfer = 0;
  let activeLine: string | null = null;
  for (const edge of edges) {
    if (edge.kind === "TRANSFER") {
      transfer += edge.durationSeconds;
      activeLine = null;
      continue;
    }
    if (activeLine !== edge.serviceLineId) {
      waiting += edge.expectedWaitSeconds;
      activeLine = edge.serviceLineId;
    }
    riding += edge.durationSeconds;
  }
  return { waiting, riding, transfer };
}

export function findSubwayPathCandidates(
  graph: SubwayRoutingGraph,
  origin: Coordinate,
  destination: Coordinate,
): SubwayPathCandidate[] {
  const stationByNode = new Map(
    graph.stations.map((station) => [station.nodeId, station]),
  );
  const origins = closestStations(graph.stations, origin);
  const destinations = closestStations(graph.stations, destination);
  const candidates: SubwayPathCandidate[] = [];
  for (const originCandidate of origins) {
    const previous = dijkstra(graph, originCandidate.station.nodeId);
    for (const destinationCandidate of destinations) {
      if (originCandidate.station.nodeId === destinationCandidate.station.nodeId) {
        continue;
      }
      const edges = reconstructPath(
        originCandidate.station.nodeId,
        destinationCandidate.station.nodeId,
        previous,
      );
      if (edges === undefined || !edges.some((edge) => edge.kind === "RIDE")) {
        continue;
      }
      const stations = [originCandidate.station];
      for (const edge of edges) {
        const station = stationByNode.get(edge.toNodeId);
        if (station === undefined) {
          stations.length = 0;
          break;
        }
        stations.push(station);
      }
      if (stations.length === 0) {
        continue;
      }
      const durations = pathDurations(edges);
      const scoreSeconds =
        durations.waiting +
        durations.riding +
        durations.transfer +
        (originCandidate.distanceMeters + destinationCandidate.distanceMeters) /
          1.25;
      candidates.push({
        stations,
        edges,
        accessDistanceMeters: Math.round(originCandidate.distanceMeters),
        egressDistanceMeters: Math.round(destinationCandidate.distanceMeters),
        waitingDurationSeconds: durations.waiting,
        ridingDurationSeconds: durations.riding,
        transferDurationSeconds: durations.transfer,
        scoreSeconds,
      });
    }
  }
  const unique = new Map<string, SubwayPathCandidate>();
  for (const candidate of candidates.sort(
    (first, second) => first.scoreSeconds - second.scoreSeconds,
  )) {
    const signature = [
      candidate.stations[0]?.nodeId,
      candidate.stations.at(-1)?.nodeId,
      ...candidate.edges
        .filter((edge) => edge.kind === "RIDE")
        .map((edge) => edge.serviceLineId),
    ].join(">");
    if (!unique.has(signature)) {
      unique.set(signature, candidate);
    }
  }
  return [...unique.values()].slice(0, 3);
}

function serviceLabel(station: SubwayRoutingStation): string {
  return station.lineName.includes(station.regionName)
    ? station.lineName
    : `${station.regionName} ${station.lineName}`;
}

function subwayCoreLegs(candidate: SubwayPathCandidate): RouteLeg[] {
  const stationByNode = new Map(
    candidate.stations.map((station) => [station.nodeId, station]),
  );
  const legs: RouteLeg[] = [];
  let index = 0;
  while (index < candidate.edges.length) {
    const edge = candidate.edges[index]!;
    const from = stationByNode.get(edge.fromNodeId)!;
    if (edge.kind === "TRANSFER") {
      const to = stationByNode.get(edge.toNodeId)!;
      legs.push({
        id: `subway-transfer-${index}-${from.nodeId}-${to.nodeId}`,
        mode: "WALK",
        name: "지하철 환승",
        guidance: `${from.stationName}역에서 ${serviceLabel(to)} 승강장으로 환승`,
        distanceMeters: edge.distanceMeters,
        durationSeconds: edge.durationSeconds,
        coordinates: [coordinate(from), coordinate(to)],
        isExerciseSegment: false,
        walkingRole: "TRANSFER",
      });
      index += 1;
      continue;
    }
    const serviceLineId = edge.serviceLineId!;
    const rideEdges: SubwayRoutingEdge[] = [];
    while (
      index < candidate.edges.length &&
      candidate.edges[index]?.kind === "RIDE" &&
      candidate.edges[index]?.serviceLineId === serviceLineId
    ) {
      rideEdges.push(candidate.edges[index]!);
      index += 1;
    }
    const rideStations = [stationByNode.get(rideEdges[0]!.fromNodeId)!];
    rideEdges.forEach((ride) =>
      rideStations.push(stationByNode.get(ride.toNodeId)!),
    );
    const boarding = rideStations[0]!;
    const alighting = rideStations.at(-1)!;
    const waitingSeconds = rideEdges[0]?.expectedWaitSeconds ?? 300;
    legs.push({
      id: `subway-${serviceLineId}-${boarding.sourceStationKey}-${alighting.sourceStationKey}`,
      mode: "SUBWAY",
      name: serviceLabel(boarding),
      guidance: `${boarding.stationName}역에서 ${serviceLabel(boarding)} 탑승 · ${alighting.stationName}역 하차 (TAGO 시간표 기반 예상)`,
      distanceMeters: rideEdges.reduce(
        (total, ride) => total + ride.distanceMeters,
        0,
      ),
      durationSeconds:
        waitingSeconds +
        rideEdges.reduce((total, ride) => total + ride.durationSeconds, 0),
      stops: rideStations.map((station) => station.stationName),
      coordinates: rideStations.map(coordinate),
      isExerciseSegment: false,
    });
  }
  return legs;
}

function fallbackWalk(
  id: string,
  from: Coordinate,
  to: Coordinate,
  walkSpeedKmh: number,
): RouteLeg {
  const distanceMeters = Math.round(haversineDistanceMeters(from, to));
  return {
    id,
    mode: "WALK",
    guidance: "지하철역까지 도보 이동",
    distanceMeters,
    durationSeconds: Math.max(
      1,
      Math.round(distanceMeters / ((walkSpeedKmh * 1_000) / 3_600)),
    ),
    coordinates: [from, to],
    isExerciseSegment: false,
    walkingRole: "ACCESS",
  };
}

function accessLegs(route: NormalizedRoute, prefix: string): RouteLeg[] {
  return route.legs.map((leg, index) => ({
    ...leg,
    id: `${prefix}-${index}-${leg.id}`,
    isExerciseSegment: false,
    walkingRole: "ACCESS" as const,
  }));
}

export class SubwayRoutePlanner {
  readonly #baseProvider: MobilityProvider;
  readonly #transitService: TransitService;
  readonly #config: AppConfig;
  readonly #graphCache = new MemoryCache(32 * 1024 * 1024);

  public constructor(options: {
    baseProvider: MobilityProvider;
    transitService: TransitService;
    config: AppConfig;
  }) {
    this.#baseProvider = options.baseProvider;
    this.#transitService = options.transitService;
    this.#config = options.config;
  }

  async #graph(at: Date): Promise<SubwayRoutingGraph> {
    const period = kstRoutingPeriod(at);
    const key = `subway-routing:${period.dayGroup}:${period.timePeriod}`;
    return this.#graphCache.getOrLoad(key, 5 * 60 * 1000, () =>
      this.#transitService.repository.getSubwayRoutingGraph(
        period.dayGroup,
        period.timePeriod,
      ),
    );
  }

  async #walk(
    id: string,
    from: Coordinate,
    to: Coordinate,
    signal?: AbortSignal,
  ): Promise<RouteLeg[]> {
    if (haversineDistanceMeters(from, to) <= 20) {
      return [];
    }
    try {
      const route = await this.#baseProvider.getWalkingRoute({
        origin: from,
        destination: to,
        routeMode: "BROAD_FIRST",
        ...(signal === undefined ? {} : { signal }),
      });
      return accessLegs(route, id);
    } catch {
      return [
        fallbackWalk(id, from, to, this.#config.transit.walkSpeedKmh),
      ];
    }
  }

  public async getRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    const graph = await this.#graph(new Date());
    const candidates = findSubwayPathCandidates(
      graph,
      request.origin.location,
      request.destination.location,
    );
    return Promise.all(
      candidates.slice(0, 2).map(async (candidate, candidateIndex) => {
        const first = candidate.stations[0]!;
        const last = candidate.stations.at(-1)!;
        const [access, egress] = await Promise.all([
          this.#walk(
            `subway-access-${candidateIndex}`,
            request.origin.location,
            coordinate(first),
            request.signal,
          ),
          this.#walk(
            `subway-egress-${candidateIndex}`,
            coordinate(last),
            request.destination.location,
            request.signal,
          ),
        ]);
        const legs = [...access, ...subwayCoreLegs(candidate), ...egress];
        const distanceMeters = legs.reduce(
          (total, leg) => total + leg.distanceMeters,
          0,
        );
        const walkDistanceMeters = legs
          .filter((leg) => leg.mode === "WALK")
          .reduce((total, leg) => total + leg.distanceMeters, 0);
        const hash = createHash("sha1")
          .update(candidate.stations.map((station) => station.nodeId).join(">"))
          .digest("hex")
          .slice(0, 12);
        return normalizedRouteSchema.parse({
          id: `tago-subway-${hash}`,
          source: "TAGO",
          durationSeconds: legs.reduce(
            (total, leg) => total + leg.durationSeconds,
            0,
          ),
          distanceMeters,
          walkDistanceMeters,
          transitDistanceMeters: distanceMeters - walkDistanceMeters,
          transferCount: candidate.edges.filter(
            (edge) => edge.kind === "TRANSFER",
          ).length,
          waitingDurationSeconds: candidate.waitingDurationSeconds,
          ridingDurationSeconds: candidate.ridingDurationSeconds,
          isRealtime: false,
          estimationNotes: [
            "지하철 운행 시간은 TAGO 시간표와 검증된 구간 소요시간을 기반으로 한 예상이며 실시간 지연은 반영하지 않습니다.",
          ],
          legs,
        });
      }),
    );
  }
}
