import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type BusRoute,
  type BusRouteStop,
  type BusStop,
  type Coordinate,
  type NormalizedRoute,
  type RouteLeg,
  type TransitBusLeg,
  type TransitTiming,
  type TransitTransferType,
  type WalkingRole,
} from "@chimap/contracts";
import { createHash } from "node:crypto";

import type { AppConfig } from "../config.js";
import { MemoryCache } from "../services/cache.js";
import type {
  BusSubwayTransferLink,
  SubwayRoutingGraph,
  SubwayRoutingStation,
} from "../transit/transit-repository.js";
import type { TransitService } from "../transit/transit-service.js";
import type {
  MobilityProvider,
  RoadGeometryProvider,
  TransitRouteRequest,
} from "./types.js";
import {
  assembleSubwayRideGeometry,
  usesTrackGeometry,
  type RouteGeometryProfile,
  type SubwayGeometryObservation,
} from "./subway-track-geometry.js";
import {
  classifyGeometryError,
  RouteGeometryService,
  withWalkingGeometryLimit,
} from "./route-geometry.js";
import type { RouteGeometryObservation } from "./route-geometry.js";

const SUBWAY_ACCESS_RADIUS_METERS = 2_500;
const SUBWAY_ACCESS_LIMIT = 6;
const ENDPOINT_STOP_LIMIT = 16;
const ENDPOINT_ROUTE_LIMIT = 12;
const GRAPH_RESULT_LIMIT = 8;
const GRAPH_CANDIDATE_LIMIT = 12;
const MAX_LABELS_PER_STATE = 3;

type StopRoutes = { stop: BusStop; routes: BusRoute[] };

export type GraphNode = {
  id: string;
  kind: "ORIGIN" | "DESTINATION" | "BUS_STOP" | "SUBWAY_STATION";
  name: string;
  coordinate: Coordinate;
  busStop?: BusRouteStop;
  subwayStation?: SubwayRoutingStation;
};

export type GraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: "WALK" | "RIDE";
  mode: "WALK" | "BUS" | "SUBWAY";
  durationSeconds: number;
  distanceMeters: number;
  coordinates: Coordinate[];
  serviceKey?: string;
  expectedWaitSeconds?: number;
  busRoute?: BusRoute;
  fromBusStop?: BusRouteStop;
  toBusStop?: BusRouteStop;
  serviceLineId?: string;
  transferType?: TransitTransferType;
  walkingKind?: "ACCESS" | "EGRESS" | "TRANSFER";
  precomputedWalking?: boolean;
  subwayTrackCoordinates?: Coordinate[] | null;
  subwayTrackDistanceMeters?: number | null;
  subwayGeometrySource?: string | null;
};

export type RequestGraph = {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
  topologyPartial: boolean;
  geometryProfile?: RouteGeometryProfile;
  observeSubwayGeometry?: (observation: SubwayGeometryObservation) => void;
  observeRouteGeometry?: (observation: RouteGeometryObservation) => void;
};

type TraversedEdge = {
  edge: GraphEdge;
  boardingWaitSeconds: number;
  startedAtEpochSeconds: number;
};

type RoutePath = {
  steps: TraversedEdge[];
  durationSeconds: number;
  transferCount: number;
};

type SearchLabel = {
  nodeId: string;
  onboardServiceKey: string | null;
  lastBoardedServiceKey: string | null;
  transferCount: number;
  elapsedSeconds: number;
  walkDistanceMeters: number;
  steps: TraversedEdge[];
};

function stopCoordinate(stop: BusStop | BusRouteStop): Coordinate {
  return { lat: stop.latitude, lng: stop.longitude };
}

function subwayCoordinate(station: SubwayRoutingStation): Coordinate {
  return { lat: station.latitude, lng: station.longitude };
}

function busNodeId(cityCode: string, nodeId: string): string {
  return `BUS:${cityCode}:${nodeId}`;
}

function routeKey(route: BusRoute): string {
  return `${route.cityCode}:${route.routeId}`;
}

function busServiceKey(route: BusRoute): string {
  return `BUS:${route.cityCode}:${route.routeId}`;
}

function subwayServiceKey(serviceLineId: string): string {
  return `SUBWAY:${serviceLineId}`;
}

export function splitSubwayTiming(
  resolved: TransitTiming & { direction: "U" | "D" | "UNKNOWN" },
): {
  direction: "U" | "D" | "UNKNOWN";
  timing: TransitTiming;
} {
  const { direction, ...timing } = resolved;
  return { direction, timing };
}

function routeStopAsStop(stop: BusRouteStop): BusStop {
  return {
    id: stop.stopId,
    cityCode: stop.cityCode,
    nodeId: stop.nodeId,
    sourceStopNo: null,
    arsId: null,
    name: stop.stopName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    source: "database",
  };
}

function expectedBusWaitSeconds(route: BusRoute, at = new Date()): number {
  const day = at.getDay();
  const interval =
    day === 0 || day === 6
      ? (route.weekendIntervalMinutes ?? route.weekdayIntervalMinutes)
      : (route.weekdayIntervalMinutes ?? route.weekendIntervalMinutes);
  return interval === null ? 600 : Math.max(30, Math.round(interval * 30));
}

function walkingSeconds(distanceMeters: number, walkSpeedKmh: number): number {
  return Math.max(
    1,
    Math.round(distanceMeters / ((walkSpeedKmh * 1_000) / 3_600)),
  );
}

function polylineDistance(coordinates: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += haversineDistanceMeters(
      coordinates[index]!,
      coordinates[index + 1]!,
    );
  }
  return Math.round(total);
}

function addEdge(graph: RequestGraph, edge: GraphEdge): void {
  const entries = graph.adjacency.get(edge.fromNodeId) ?? [];
  entries.push(edge);
  graph.adjacency.set(edge.fromNodeId, entries);
}

function transitSignature(steps: readonly TraversedEdge[]): string {
  const services: string[] = [];
  for (const step of steps) {
    const service = step.edge.serviceKey;
    if (service !== undefined && services.at(-1) !== service) {
      services.push(service);
    }
  }
  return services.join(">");
}

class MinHeap<T> {
  readonly #items: Array<{ priority: number; value: T }> = [];

  public get size(): number {
    return this.#items.length;
  }

  public push(priority: number, value: T): void {
    const item = { priority, value };
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#items[parent]!.priority <= priority) {
        break;
      }
      this.#items[index] = this.#items[parent]!;
      index = parent;
    }
    this.#items[index] = item;
  }

  public pop(): T | undefined {
    const first = this.#items[0];
    const last = this.#items.pop();
    if (first === undefined) {
      return undefined;
    }
    if (this.#items.length === 0 || last === undefined) {
      return first.value;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#items.length) {
        break;
      }
      const child =
        right < this.#items.length &&
        this.#items[right]!.priority < this.#items[left]!.priority
          ? right
          : left;
      if (this.#items[child]!.priority >= last.priority) {
        break;
      }
      this.#items[index] = this.#items[child]!;
      index = child;
    }
    this.#items[index] = last;
    return first.value;
  }
}

function stateKey(label: SearchLabel): string {
  return [
    label.nodeId,
    label.onboardServiceKey ?? "-",
    label.lastBoardedServiceKey ?? "-",
    label.transferCount,
  ].join("|");
}

function keepLabel(
  labels: Map<string, Array<{ elapsed: number; walk: number }>>,
  label: SearchLabel,
): boolean {
  const key = stateKey(label);
  const current = labels.get(key) ?? [];
  if (
    current.some(
      (entry) =>
        entry.elapsed <= label.elapsedSeconds &&
        entry.walk <= label.walkDistanceMeters,
    )
  ) {
    return false;
  }
  const next = current
    .filter(
      (entry) =>
        entry.elapsed < label.elapsedSeconds ||
        entry.walk < label.walkDistanceMeters,
    )
    .concat({ elapsed: label.elapsedSeconds, walk: label.walkDistanceMeters })
    .sort((first, second) => first.elapsed - second.elapsed)
    .slice(0, MAX_LABELS_PER_STATE);
  labels.set(key, next);
  return next.some(
    (entry) =>
      entry.elapsed === label.elapsedSeconds &&
      entry.walk === label.walkDistanceMeters,
  );
}

export function findMultimodalPaths(
  graph: RequestGraph,
  maxTransferCount: 0 | 1 | 2,
  departureAt: Date,
): RoutePath[] {
  const queue = new MinHeap<SearchLabel>();
  const initial: SearchLabel = {
    nodeId: "ORIGIN",
    onboardServiceKey: null,
    lastBoardedServiceKey: null,
    transferCount: 0,
    elapsedSeconds: 0,
    walkDistanceMeters: 0,
    steps: [],
  };
  queue.push(0, initial);
  const labels = new Map<string, Array<{ elapsed: number; walk: number }>>();
  keepLabel(labels, initial);
  const results: RoutePath[] = [];
  const signatures = new Set<string>();

  while (queue.size > 0 && results.length < GRAPH_CANDIDATE_LIMIT) {
    const current = queue.pop()!;
    if (current.nodeId === "DESTINATION") {
      const signature = transitSignature(current.steps);
      if (signature.length > 0 && !signatures.has(signature)) {
        signatures.add(signature);
        results.push({
          steps: current.steps,
          durationSeconds: current.elapsedSeconds,
          transferCount: current.transferCount,
        });
      }
      continue;
    }
    if (current.steps.length >= 500) {
      continue;
    }
    for (const edge of graph.adjacency.get(current.nodeId) ?? []) {
      let waitSeconds = 0;
      let transferCount = current.transferCount;
      let onboardServiceKey = current.onboardServiceKey;
      let lastBoardedServiceKey = current.lastBoardedServiceKey;
      if (edge.kind === "RIDE") {
        const serviceKey = edge.serviceKey!;
        if (current.onboardServiceKey !== serviceKey) {
          waitSeconds = edge.expectedWaitSeconds ?? 0;
          if (current.lastBoardedServiceKey !== null) {
            transferCount += 1;
          }
          onboardServiceKey = serviceKey;
          lastBoardedServiceKey = serviceKey;
        }
      } else {
        onboardServiceKey = null;
      }
      if (transferCount > maxTransferCount) {
        continue;
      }
      const next: SearchLabel = {
        nodeId: edge.toNodeId,
        onboardServiceKey,
        lastBoardedServiceKey,
        transferCount,
        elapsedSeconds:
          current.elapsedSeconds + waitSeconds + edge.durationSeconds,
        walkDistanceMeters:
          current.walkDistanceMeters +
          (edge.kind === "WALK" ? edge.distanceMeters : 0),
        steps: [
          ...current.steps,
          {
            edge,
            boardingWaitSeconds: waitSeconds,
            startedAtEpochSeconds:
              Math.floor(departureAt.getTime() / 1_000) +
              current.elapsedSeconds,
          },
        ],
      };
      if (keepLabel(labels, next)) {
        queue.push(next.elapsedSeconds, next);
      }
    }
  }
  return results.sort(
    (first, second) => first.durationSeconds - second.durationSeconds,
  );
}

export class MultimodalRoutePlanner {
  readonly #baseProvider: MobilityProvider & RoadGeometryProvider;
  readonly #transitService: TransitService;
  readonly #config: AppConfig;
  readonly #subwayGraphCache = new MemoryCache(48 * 1024 * 1024);
  readonly #walkingCache = new MemoryCache(32 * 1024 * 1024);
  readonly #routeGeometryService: RouteGeometryService;

  public constructor(options: {
    baseProvider: MobilityProvider & RoadGeometryProvider;
    transitService: TransitService;
    config: AppConfig;
    routeGeometryService?: RouteGeometryService;
  }) {
    this.#baseProvider = options.baseProvider;
    this.#transitService = options.transitService;
    this.#config = options.config;
    this.#routeGeometryService = options.routeGeometryService ?? new RouteGeometryService({
      provider: options.baseProvider,
      repository: options.transitService.repository,
    });
  }

  async #subwayGraph(): Promise<SubwayRoutingGraph> {
    const at = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 12);
    const dayGroup: "WEEKDAY" | "WEEKEND_HOLIDAY" =
      weekday === "Sat" || weekday === "Sun"
        ? "WEEKEND_HOLIDAY"
        : "WEEKDAY";
    const timePeriod:
      | "EARLY_MORNING"
      | "MORNING_PEAK"
      | "DAYTIME"
      | "EVENING_PEAK"
      | "LATE_NIGHT" =
      hour < 7
        ? "EARLY_MORNING"
        : hour < 10
          ? "MORNING_PEAK"
          : hour < 17
            ? "DAYTIME"
            : hour < 20
              ? "EVENING_PEAK"
              : "LATE_NIGHT";
    return this.#subwayGraphCache.getOrLoad(
      `multimodal:subway:${dayGroup}:${timePeriod}`,
      5 * 60 * 1_000,
      () =>
        this.#transitService.repository.getSubwayRoutingGraph(
          dayGroup,
          timePeriod,
        ),
    );
  }

  async #endpointStopRoutes(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<{ entries: StopRoutes[]; partial: boolean }> {
    let partial = false;
    const checked = new Set<string>();
    const entries: StopRoutes[] = [];
    const radii = [
      this.#config.transit.maxNearbyStopDistanceMeters,
      800,
      this.#config.transit.routeSearchMaxDistanceMeters,
    ].filter((value, index, values) => values.indexOf(value) === index);
    for (const radius of radii.sort((a, b) => a - b)) {
      const nearby = await this.#transitService.getNearbyStops(
        coordinate,
        radius,
        signal,
      );
      partial ||= nearby.partial;
      const candidates = nearby.items
        .filter(
          (stop) =>
            stop.cityCode !== null &&
            stop.nodeId !== null &&
            !checked.has(`${stop.cityCode}:${stop.nodeId}`),
        )
        .slice(0, ENDPOINT_STOP_LIMIT);
      candidates.forEach((stop) =>
        checked.add(`${stop.cityCode}:${stop.nodeId}`),
      );
      const loaded = await Promise.allSettled(
        candidates.map(async (stop): Promise<StopRoutes> => ({
          stop,
          routes: (
            await this.#transitService.getRoutesByStop(
              stop.cityCode!,
              stop.nodeId!,
              signal,
            )
          ).items,
        })),
      );
      entries.push(
        ...loaded.flatMap((result) =>
          result.status === "fulfilled" && result.value.routes.length > 0
            ? [result.value]
            : [],
        ),
      );
      if (entries.length >= 8) {
        break;
      }
    }
    return {
      entries: entries
        .sort(
          (first, second) =>
            (first.stop.distanceMeters ?? Infinity) -
            (second.stop.distanceMeters ?? Infinity),
        )
        .slice(0, ENDPOINT_STOP_LIMIT),
      partial,
    };
  }

  async #requestGraph(
    request: TransitRouteRequest,
  ): Promise<RequestGraph> {
    const [subwayGraph, originStops, destinationStops] = await Promise.all([
      this.#subwayGraph(),
      this.#endpointStopRoutes(request.origin.location, request.signal),
      this.#endpointStopRoutes(request.destination.location, request.signal),
    ]);
    const graph: RequestGraph = {
      nodes: new Map(),
      adjacency: new Map(),
      topologyPartial: originStops.partial || destinationStops.partial,
      ...(request.geometryProfile === undefined
        ? {}
        : { geometryProfile: request.geometryProfile }),
      ...(request.observeSubwayGeometry === undefined
        ? {}
        : { observeSubwayGeometry: request.observeSubwayGeometry }),
      ...(request.observeRouteGeometry === undefined
        ? {}
        : { observeRouteGeometry: request.observeRouteGeometry }),
    };
    graph.nodes.set("ORIGIN", {
      id: "ORIGIN",
      kind: "ORIGIN",
      name: request.origin.name,
      coordinate: request.origin.location,
    });
    graph.nodes.set("DESTINATION", {
      id: "DESTINATION",
      kind: "DESTINATION",
      name: request.destination.name,
      coordinate: request.destination.location,
    });

    for (const station of subwayGraph.stations) {
      graph.nodes.set(station.nodeId, {
        id: station.nodeId,
        kind: "SUBWAY_STATION",
        name: station.stationName,
        coordinate: subwayCoordinate(station),
        subwayStation: station,
      });
    }
    for (const edge of subwayGraph.edges) {
      const from = graph.nodes.get(edge.fromNodeId);
      const to = graph.nodes.get(edge.toNodeId);
      if (from === undefined || to === undefined) {
        continue;
      }
      addEdge(graph, {
        id: `subway:${edge.fromNodeId}:${edge.toNodeId}`,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        kind: edge.kind === "RIDE" ? "RIDE" : "WALK",
        mode: edge.kind === "RIDE" ? "SUBWAY" : "WALK",
        durationSeconds: edge.durationSeconds,
        distanceMeters: edge.distanceMeters,
        coordinates: [from.coordinate, to.coordinate],
        ...(edge.serviceLineId === null
          ? {
              walkingKind: "TRANSFER" as const,
              transferType: "SUBWAY_TO_SUBWAY" as const,
              precomputedWalking: true,
            }
          : {
              serviceKey: subwayServiceKey(edge.serviceLineId),
              expectedWaitSeconds: edge.expectedWaitSeconds,
              serviceLineId: edge.serviceLineId,
              subwayTrackCoordinates: edge.trackCoordinates,
              subwayTrackDistanceMeters: edge.trackDistanceMeters,
              subwayGeometrySource: edge.geometrySource,
            }),
      });
    }

    const routeMap = new Map<string, BusRoute>();
    const endpointRoutes = (entries: StopRoutes[]) => {
      const selected = new Map<string, BusRoute>();
      for (const route of entries.flatMap((entry) => entry.routes)) {
        selected.set(routeKey(route), route);
        if (selected.size >= ENDPOINT_ROUTE_LIMIT) {
          break;
        }
      }
      return selected.values();
    };
    for (const route of endpointRoutes(originStops.entries)) {
      routeMap.set(routeKey(route), route);
    }
    for (const route of endpointRoutes(destinationStops.entries)) {
      routeMap.set(routeKey(route), route);
    }
    const loadedRoutes = await Promise.allSettled(
      [...routeMap.values()].map(async (route) => ({
        route: await this.#transitService.getRoute(
          route.cityCode,
          route.routeId,
          request.signal,
        ),
        stops: await this.#transitService.getRouteStops(
          route.cityCode,
          route.routeId,
          request.signal,
        ),
      })),
    );
    const busNodesByStopId = new Map<string, string>();
    for (const loaded of loadedRoutes) {
      if (loaded.status !== "fulfilled") {
        graph.topologyPartial = true;
        continue;
      }
      const { route, stops } = loaded.value;
      for (const stop of stops) {
        const nodeId = busNodeId(stop.cityCode, stop.nodeId);
        busNodesByStopId.set(stop.stopId, nodeId);
        if (!graph.nodes.has(nodeId)) {
          graph.nodes.set(nodeId, {
            id: nodeId,
            kind: "BUS_STOP",
            name: stop.stopName,
            coordinate: stopCoordinate(stop),
            busStop: stop,
          });
        }
      }
      for (let index = 0; index < stops.length - 1; index += 1) {
        const from = stops[index]!;
        const to = stops[index + 1]!;
        const distanceMeters = Math.max(
          1,
          Math.round(haversineDistanceMeters(stopCoordinate(from), stopCoordinate(to))),
        );
        const durationSeconds = Math.max(
          30,
          Math.round(
            distanceMeters /
              ((this.#config.transit.busAverageSpeedKmh * 1_000) / 3_600) +
              this.#config.transit.stopDwellSeconds,
          ),
        );
        addEdge(graph, {
          id: `bus:${route.cityCode}:${route.routeId}:${from.nodeOrder}:${to.nodeOrder}`,
          fromNodeId: busNodeId(from.cityCode, from.nodeId),
          toNodeId: busNodeId(to.cityCode, to.nodeId),
          kind: "RIDE",
          mode: "BUS",
          durationSeconds,
          distanceMeters,
          coordinates: [stopCoordinate(from), stopCoordinate(to)],
          serviceKey: busServiceKey(route),
          expectedWaitSeconds: expectedBusWaitSeconds(route),
          busRoute: route,
          fromBusStop: from,
          toBusStop: to,
        });
      }
    }

    const endpointWalk = (
      fromNodeId: string,
      toNodeId: string,
      from: Coordinate,
      to: Coordinate,
      kind: "ACCESS" | "EGRESS",
    ) => {
      const distanceMeters = Math.round(haversineDistanceMeters(from, to));
      addEdge(graph, {
        id: `${kind.toLowerCase()}:${fromNodeId}:${toNodeId}`,
        fromNodeId,
        toNodeId,
        kind: "WALK",
        mode: "WALK",
        durationSeconds: walkingSeconds(
          distanceMeters,
          this.#config.transit.walkSpeedKmh,
        ),
        distanceMeters,
        coordinates: [from, to],
        walkingKind: kind,
      });
    };
    for (const entry of originStops.entries) {
      const nodeId = busNodeId(entry.stop.cityCode!, entry.stop.nodeId!);
      if (graph.nodes.has(nodeId)) {
        endpointWalk(
          "ORIGIN",
          nodeId,
          request.origin.location,
          stopCoordinate(entry.stop),
          "ACCESS",
        );
      }
    }
    for (const entry of destinationStops.entries) {
      const nodeId = busNodeId(entry.stop.cityCode!, entry.stop.nodeId!);
      if (graph.nodes.has(nodeId)) {
        endpointWalk(
          nodeId,
          "DESTINATION",
          stopCoordinate(entry.stop),
          request.destination.location,
          "EGRESS",
        );
      }
    }
    const closestSubway = (point: Coordinate) =>
      subwayGraph.stations
        .map((station) => ({
          station,
          distance: haversineDistanceMeters(point, subwayCoordinate(station)),
        }))
        .filter((candidate) => candidate.distance <= SUBWAY_ACCESS_RADIUS_METERS)
        .sort((first, second) => first.distance - second.distance)
        .slice(0, SUBWAY_ACCESS_LIMIT);
    for (const candidate of closestSubway(request.origin.location)) {
      endpointWalk(
        "ORIGIN",
        candidate.station.nodeId,
        request.origin.location,
        subwayCoordinate(candidate.station),
        "ACCESS",
      );
    }
    for (const candidate of closestSubway(request.destination.location)) {
      endpointWalk(
        candidate.station.nodeId,
        "DESTINATION",
        subwayCoordinate(candidate.station),
        request.destination.location,
        "EGRESS",
      );
    }

    const links = await this.#transitService.repository.getBusSubwayTransferLinks(
      [...busNodesByStopId.keys()],
    );
    for (const link of links) {
      const busNode = busNodesByStopId.get(link.busStopId);
      if (busNode === undefined || !graph.nodes.has(link.subwayNodeId)) {
        continue;
      }
      this.#addBusSubwayLink(graph, busNode, link.subwayNodeId, link, true);
      this.#addBusSubwayLink(graph, link.subwayNodeId, busNode, link, false);
    }
    this.#addNearbyBusTransfers(graph);
    return graph;
  }

  #addBusSubwayLink(
    graph: RequestGraph,
    fromNodeId: string,
    toNodeId: string,
    link: BusSubwayTransferLink,
    busToSubway: boolean,
  ): void {
    addEdge(graph, {
      id: `bus-subway:${fromNodeId}:${toNodeId}`,
      fromNodeId,
      toNodeId,
      kind: "WALK",
      mode: "WALK",
      durationSeconds: link.walkDurationSeconds,
      distanceMeters: link.walkDistanceMeters,
      coordinates: busToSubway
        ? link.coordinates
        : [...link.coordinates].reverse(),
      transferType: busToSubway ? "BUS_TO_SUBWAY" : "SUBWAY_TO_BUS",
      walkingKind: "TRANSFER",
      precomputedWalking: true,
    });
  }

  #addNearbyBusTransfers(graph: RequestGraph): void {
    const busNodes = [...graph.nodes.values()].filter(
      (node) => node.kind === "BUS_STOP",
    );
    const buckets = new Map<string, GraphNode[]>();
    const bucketKey = (coordinate: Coordinate) =>
      `${Math.floor(coordinate.lat * 1_000)}:${Math.floor(coordinate.lng * 1_000)}`;
    for (const node of busNodes) {
      const key = bucketKey(node.coordinate);
      const entries = buckets.get(key) ?? [];
      entries.push(node);
      buckets.set(key, entries);
    }
    for (const from of busNodes) {
      const latBucket = Math.floor(from.coordinate.lat * 1_000);
      const lngBucket = Math.floor(from.coordinate.lng * 1_000);
      for (let latDelta = -1; latDelta <= 1; latDelta += 1) {
        for (let lngDelta = -1; lngDelta <= 1; lngDelta += 1) {
          for (const to of
            buckets.get(`${latBucket + latDelta}:${lngBucket + lngDelta}`) ?? []) {
            if (from.id >= to.id) {
              continue;
            }
            const distanceMeters = Math.round(
              haversineDistanceMeters(from.coordinate, to.coordinate),
            );
            if (distanceMeters === 0 || distanceMeters > 100) {
              continue;
            }
            for (const [first, second] of [[from, to], [to, from]] as const) {
              addEdge(graph, {
                id: `bus-transfer:${first.id}:${second.id}`,
                fromNodeId: first.id,
                toNodeId: second.id,
                kind: "WALK",
                mode: "WALK",
                durationSeconds: walkingSeconds(
                  distanceMeters,
                  this.#config.transit.walkSpeedKmh,
                ),
                distanceMeters,
                coordinates: [first.coordinate, second.coordinate],
                walkingKind: "TRANSFER",
                transferType: "BUS_TO_BUS",
              });
            }
          }
        }
      }
    }
  }

  async #walkingLegs(
    graph: RequestGraph,
    edge: GraphEdge,
    index: number,
    signal?: AbortSignal,
  ): Promise<RouteLeg[]> {
    const role: WalkingRole = edge.walkingKind === "TRANSFER" ? "TRANSFER" : "ACCESS";
    if (edge.precomputedWalking === true || edge.distanceMeters <= 20) {
      const detailed = edge.precomputedWalking === true && edge.coordinates.length > 2;
      const quality = detailed ? "DETAILED" as const : "APPROXIMATE" as const;
      graph.observeRouteGeometry?.({
        mode: "WALK",
        outcome: quality,
        reason: detailed ? "NONE" : "SHORT_DISTANCE",
        source: detailed ? "PRECOMPUTED" : "FALLBACK",
        cacheState: "NONE",
        durationMilliseconds: 0,
        inputVertexCount: 2,
        outputVertexCount: edge.coordinates.length,
        successfulSectionCount: detailed ? 1 : 0,
        failedSectionCount: detailed ? 0 : 1,
        walkingRole: role,
      });
      return [{
        id: `multimodal-walk-${index}`,
        mode: "WALK",
        guidance:
          edge.walkingKind === "TRANSFER"
            ? "환승 지점까지 도보 이동"
            : edge.walkingKind === "EGRESS"
              ? "하차 후 목적지까지 도보 이동"
              : "탑승 지점까지 도보 이동",
        distanceMeters: edge.distanceMeters,
        durationSeconds: edge.durationSeconds,
        coordinates: edge.coordinates,
        ...(graph.geometryProfile === "TRANSIT_V2"
          ? { geometryQuality: quality }
          : {}),
        isExerciseSegment: false,
        walkingRole: role,
        ...(edge.transferType === undefined
          ? {}
          : {
              transfer: {
                transferType: edge.transferType,
                fromServiceId: edge.fromNodeId,
                toServiceId: edge.toNodeId,
              },
            }),
      }];
    }
    if (graph.geometryProfile === "TRANSIT_V2") {
      return [{
        id: `multimodal-walk-${index}`,
        mode: "WALK",
        guidance:
          edge.walkingKind === "TRANSFER"
            ? "환승 지점까지 도보 이동"
            : edge.walkingKind === "EGRESS"
              ? "하차 후 목적지까지 도보 이동"
              : "탑승 지점까지 도보 이동",
        distanceMeters: edge.distanceMeters,
        durationSeconds: edge.durationSeconds,
        coordinates: edge.coordinates,
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        walkingRole: role,
        ...(edge.transferType === undefined
          ? {}
          : {
              transfer: {
                transferType: edge.transferType,
                fromServiceId: edge.fromNodeId,
                toServiceId: edge.toNodeId,
              },
            }),
      }];
    }
    const from = edge.coordinates[0]!;
    const to = edge.coordinates.at(-1)!;
    const cacheKey = `multimodal:walk:${from.lng.toFixed(5)},${from.lat.toFixed(5)}:${to.lng.toFixed(5)},${to.lat.toFixed(5)}`;
    const walkingCacheHit = this.#walkingCache.get<NormalizedRoute>(cacheKey) !== undefined;
    const startedAt = performance.now();
    const budgetSignal = AbortSignal.timeout(8_000);
    const walkingSignal = signal === undefined
      ? budgetSignal
      : AbortSignal.any([signal, budgetSignal]);
    try {
      const route = await this.#walkingCache.getOrLoad(
        cacheKey,
        30 * 60 * 1_000,
        () =>
          withWalkingGeometryLimit(() => this.#baseProvider.getWalkingRoute({
            origin: from,
            destination: to,
            routeMode: "BROAD_FIRST",
            signal: walkingSignal,
          }), walkingSignal),
      );
      const legs = route.legs.map((leg, legIndex) => ({
        ...leg,
        id: `multimodal-walk-${index}-${legIndex}`,
        isExerciseSegment: false,
        walkingRole: role,
        ...(graph.geometryProfile === "TRANSIT_V2"
          ? { geometryQuality: "DETAILED" as const }
          : {}),
        ...(edge.transferType === undefined || legIndex > 0
          ? {}
          : {
              transfer: {
                transferType: edge.transferType,
                fromServiceId: edge.fromNodeId,
                toServiceId: edge.toNodeId,
              },
            }),
      }));
      graph.observeRouteGeometry?.({
        mode: "WALK",
        outcome: "DETAILED",
        reason: "NONE",
        source: "KAKAO_WALK",
        cacheState: walkingCacheHit ? "FRESH" : "MISS",
        durationMilliseconds: performance.now() - startedAt,
        inputVertexCount: 2,
        outputVertexCount: legs.reduce((total, leg) => total + leg.coordinates.length, 0),
        successfulSectionCount: 1,
        failedSectionCount: 0,
        walkingRole: role,
      });
      return legs;
    } catch (error) {
      graph.observeRouteGeometry?.({
        mode: "WALK",
        outcome: "APPROXIMATE",
        reason: classifyGeometryError(error),
        source: "FALLBACK",
        cacheState: "MISS",
        durationMilliseconds: performance.now() - startedAt,
        inputVertexCount: 2,
        outputVertexCount: edge.coordinates.length,
        successfulSectionCount: 0,
        failedSectionCount: 1,
        walkingRole: role,
      });
      return [{
        id: `multimodal-walk-${index}`,
        mode: "WALK",
        guidance: "도보 이동",
        distanceMeters: edge.distanceMeters,
        durationSeconds: edge.durationSeconds,
        coordinates: edge.coordinates,
        isExerciseSegment: false,
        walkingRole: role,
        ...(edge.transferType === undefined
          ? {}
          : {
              transfer: {
                transferType: edge.transferType,
                fromServiceId: edge.fromNodeId,
                toServiceId: edge.toNodeId,
              },
            }),
      }];
    }
  }

  async #busLeg(
    graph: RequestGraph,
    steps: TraversedEdge[],
    index: number,
    signal?: AbortSignal,
  ): Promise<RouteLeg> {
    const first = steps[0]!;
    const route = first.edge.busRoute!;
    const stops = [
      first.edge.fromBusStop!,
      ...steps.map((step) => step.edge.toBusStop!),
    ];
    const rideDistance = steps.reduce(
      (total, step) => total + step.edge.distanceMeters,
      0,
    );
    const rideSeconds = steps.reduce(
      (total, step) => total + step.edge.durationSeconds,
      0,
    );
    const fallbackWaitSeconds = first.boardingWaitSeconds;
    const road = await this.#routeGeometryService.resolveBusGeometry({
      stops,
      ...(signal === undefined ? {} : { signal }),
      ...(graph.observeRouteGeometry === undefined
        ? {}
        : { observe: graph.observeRouteGeometry }),
    });
    const coordinates = road.coordinates.length >= 2
      ? road.coordinates
      : stops.map(stopCoordinate);
    const roadMatched = road.quality === "DETAILED";
    const boarding = stops[0]!;
    const alighting = stops.at(-1)!;
    const timing = await this.#transitService.resolveBusTiming({
      cityCode: route.cityCode,
      nodeId: boarding.nodeId,
      routeId: route.routeId,
      plannedBoardingAt: new Date(first.startedAtEpochSeconds * 1_000),
      fallbackWaitSeconds,
      ...(signal === undefined ? {} : { signal }),
    });
    const waitSeconds = timing.waitSeconds;
    const bus: TransitBusLeg = {
      routeId: route.routeId,
      cityCode: route.cityCode,
      routeNo: route.routeNo,
      routeType: route.routeType,
      boardingStop: routeStopAsStop(boarding),
      alightingStop: routeStopAsStop(alighting),
      stopCount: stops.length - 1,
      boardingNodeOrder: boarding.nodeOrder,
      alightingNodeOrder: alighting.nodeOrder,
      expectedArrivalSeconds: waitSeconds,
      expectedRideSeconds: rideSeconds,
      vehicleNo: null,
      vehicleType: null,
      isArrivalRealtime: false,
      polyline: coordinates,
      stops,
    };
    return {
      id: `multimodal-bus-${index}-${route.routeId}`,
      mode: "BUS",
      name: route.routeNo,
      distanceMeters: rideDistance,
      durationSeconds: waitSeconds + rideSeconds,
      stops: stops.map((stop) => stop.stopName),
      coordinates,
      ...(graph.geometryProfile === "TRANSIT_V2"
        ? { geometryQuality: road.quality }
        : {}),
      isExerciseSegment: false,
      bus,
      timing,
      guidance: `${boarding.stopName}에서 ${route.routeNo}번 버스를 타고 ${alighting.stopName}까지 이동${roadMatched ? "" : " (정류장 좌표 기반 경로)"}`,
    };
  }

  async #subwayLeg(
    graph: RequestGraph,
    steps: TraversedEdge[],
    index: number,
    signal?: AbortSignal,
  ): Promise<RouteLeg> {
    const first = steps[0]!;
    const stations = [
      graph.nodes.get(first.edge.fromNodeId)!.subwayStation!,
      ...steps.map(
        (step) => graph.nodes.get(step.edge.toNodeId)!.subwayStation!,
      ),
    ];
    const boarding = stations[0]!;
    const alighting = stations.at(-1)!;
    const rideSeconds = steps.reduce(
      (total, step) => total + step.edge.durationSeconds,
      0,
    );
    const resolvedTiming = await this.#transitService.resolveSubwayTiming({
      serviceLineId: boarding.serviceLineId,
      stationLineId: boarding.stationLineId,
      fromSourceStationKey: boarding.sourceStationKey,
      toSourceStationKey: stations[1]!.sourceStationKey,
      plannedBoardingAt: new Date(first.startedAtEpochSeconds * 1_000),
      fallbackWaitSeconds: first.boardingWaitSeconds,
      ...(signal === undefined ? {} : { signal }),
    });
    const { direction, timing } = splitSubwayTiming(resolvedTiming);
    const waitSeconds = timing.waitSeconds;
    const timingLabel = timing.isRealtime
      ? "실시간 도착정보"
      : timing.timingSource === "TAGO_SUBWAY_TIMETABLE"
        ? "TAGO 시간표 기반 예상"
        : "배차간격 기반 예상";
    const stationRef = (station: SubwayRoutingStation) => ({
      stationLineId: station.stationLineId,
      sourceStationKey: station.sourceStationKey,
      name: station.stationName,
      location: subwayCoordinate(station),
    });
    const rideGeometry = assembleSubwayRideGeometry({
      ...(graph.geometryProfile === undefined
        ? {}
        : { profile: graph.geometryProfile }),
      stationCoordinates: stations.map(subwayCoordinate),
      edges: steps.map((step) => ({
        from: graph.nodes.get(step.edge.fromNodeId)!.coordinate,
        to: graph.nodes.get(step.edge.toNodeId)!.coordinate,
        straightDistanceMeters: step.edge.distanceMeters,
        trackCoordinates: step.edge.subwayTrackCoordinates ?? null,
        trackDistanceMeters: step.edge.subwayTrackDistanceMeters ?? null,
        geometrySource: step.edge.subwayGeometrySource ?? null,
      })),
    });
    if (usesTrackGeometry(graph.geometryProfile)) {
      graph.observeSubwayGeometry?.(rideGeometry.observation);
    }
    return {
      id: `multimodal-subway-${index}-${boarding.serviceLineId}`,
      mode: "SUBWAY",
      name: boarding.lineName,
      guidance: `${boarding.stationName}역에서 ${boarding.lineName} 탑승 · ${alighting.stationName}역 하차 (${timingLabel})`,
      distanceMeters: rideGeometry.distanceMeters,
      durationSeconds: waitSeconds + rideSeconds,
      stops: stations.map((station) => station.stationName),
      coordinates: rideGeometry.coordinates,
      ...(graph.geometryProfile === "TRANSIT_V2"
        ? {
            geometryQuality: rideGeometry.usedTrackGeometry
              ? "DETAILED" as const
              : "APPROXIMATE" as const,
          }
        : {}),
      isExerciseSegment: false,
      timing,
      subway: {
        serviceLineId: boarding.serviceLineId,
        lineName: boarding.lineName,
        boardingStation: stationRef(boarding),
        alightingStation: stationRef(alighting),
        stationCount: stations.length - 1,
        rideDurationSeconds: rideSeconds,
        direction:
          direction === "U"
            ? "UP"
            : direction === "D"
              ? "DOWN"
              : "UNKNOWN",
        destinationName: null,
        intermediateStations: stations.slice(1, -1).map(stationRef),
      },
    };
  }

  async #materialize(
    graph: RequestGraph,
    path: RoutePath,
    index: number,
    signal?: AbortSignal,
  ): Promise<NormalizedRoute> {
    const legs: RouteLeg[] = [];
    let cursor = 0;
    while (cursor < path.steps.length) {
      const step = path.steps[cursor]!;
      if (step.edge.kind === "WALK") {
        legs.push(...(await this.#walkingLegs(graph, step.edge, cursor, signal)));
        cursor += 1;
        continue;
      }
      const service = step.edge.serviceKey!;
      const group: TraversedEdge[] = [];
      while (
        cursor < path.steps.length &&
        path.steps[cursor]?.edge.kind === "RIDE" &&
        path.steps[cursor]?.edge.serviceKey === service
      ) {
        group.push(path.steps[cursor]!);
        cursor += 1;
      }
      legs.push(
        group[0]!.edge.mode === "BUS"
          ? await this.#busLeg(graph, group, index * 100 + cursor, signal)
          : await this.#subwayLeg(
              graph,
              group,
              index * 100 + cursor,
              signal,
            ),
      );
    }
    const distanceMeters = legs.reduce(
      (total, leg) => total + leg.distanceMeters,
      0,
    );
    const walkDistanceMeters = legs
      .filter((leg) => leg.mode === "WALK")
      .reduce((total, leg) => total + leg.distanceMeters, 0);
    const waitingDurationSeconds = legs.reduce(
      (total, leg) => total + (leg.timing?.waitSeconds ?? 0),
      0,
    );
    const ridingDurationSeconds = legs
      .filter((leg) => leg.mode !== "WALK")
      .reduce(
        (total, leg) =>
          total + leg.durationSeconds - (leg.timing?.waitSeconds ?? 0),
        0,
      );
    const durationSeconds = Math.max(
      1,
      legs.reduce((total, leg) => total + leg.durationSeconds, 0),
    );
    const id = createHash("sha1")
      .update(
        legs
          .filter((leg) => leg.mode !== "WALK")
          .map((leg) => `${leg.mode}:${leg.name ?? ""}:${leg.stops?.join("|") ?? ""}`)
          .join(">"),
      )
      .digest("hex")
      .slice(0, 16);
    return normalizedRouteSchema.parse({
      id: `multimodal-${id}`,
      source: "MULTIMODAL",
      durationSeconds,
      distanceMeters,
      walkDistanceMeters,
      transitDistanceMeters: distanceMeters - walkDistanceMeters,
      transferCount: path.transferCount,
      waitingDurationSeconds,
      ridingDurationSeconds,
      isRealtime: legs
        .filter((leg) => leg.mode !== "WALK")
        .every((leg) => leg.timing?.isRealtime === true),
      isPartial: graph.topologyPartial,
      estimationNotes: [
        "버스·지하철을 요청 범위 멀티모달 그래프로 탐색했습니다.",
        "실시간 정보가 없거나 미래 탑승인 구간은 시간표·배차간격 기반 예상값을 사용합니다.",
      ],
      legs,
    });
  }

  public async getRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    const departureAt = new Date();
    const graph = await this.#requestGraph(request);
    const paths = findMultimodalPaths(
      graph,
      this.#config.transit.maxTransferCount,
      departureAt,
    );
    const settled = await Promise.allSettled(
      paths.slice(0, GRAPH_RESULT_LIMIT).map((path, index) =>
        this.#materialize(graph, path, index, request.signal),
      ),
    );
    const routes = settled
      .flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      )
      .sort(
        (first, second) => first.durationSeconds - second.durationSeconds,
      );
    const uniqueRoutes = [
      ...new Map(routes.map((route) => [route.id, route])).values(),
    ];
    if (paths.length > 0 && uniqueRoutes.length === 0) {
      throw new AggregateError(
        settled.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
        "멀티모달 후보 경로를 응답 모델로 변환하지 못했습니다.",
      );
    }
    return uniqueRoutes;
  }
}
