import type {
  Place,
  SubwayDeparturesResponse,
  SubwayStation,
} from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import { Clock3, TrainFront } from "lucide-react";
import { useMemo } from "react";

import {
  getNearbySubwayStations,
  getSubwayDepartures,
} from "../lib/api.js";
import { formatDistance, formatKstTime } from "../lib/time.js";

type NearbySearch = typeof getNearbySubwayStations;
type DepartureSearch = typeof getSubwayDepartures;
type EndpointKey = "origin" | "destination";
type Direction = "U" | "D";

type NearbyResult = Record<EndpointKey, SubwayStation[] | null>;
type DirectionResult = {
  response: SubwayDeparturesResponse | null;
  failed: boolean;
};
type StationSchedule = Record<Direction, DirectionResult>;

type NearbySubwayPanelProps = {
  origin: Place;
  destination: Place;
  searchNearby?: NearbySearch;
  searchDepartures?: DepartureSearch;
};

const endpointMeta: ReadonlyArray<{
  key: EndpointKey;
  label: string;
}> = [
  { key: "origin", label: "출발지 주변" },
  { key: "destination", label: "도착지 주변" },
];

function displayStationName(name: string): string {
  return name.endsWith("역") ? name : `${name}역`;
}

function primaryStation(stations: SubwayStation[] | null): SubwayStation | null {
  if (stations === null || stations.length === 0) {
    return null;
  }
  return stations.find((station) => station.mappingStatus === "MAPPED") ?? stations[0]!;
}

function DirectionDeparture({
  direction,
  result,
  loading,
}: {
  direction: Direction;
  result: DirectionResult | undefined;
  loading: boolean;
}) {
  const label = direction === "U" ? "상행" : "하행";
  if (loading) {
    return (
      <li>
        <span>{label}</span>
        <small>다음 시간표 확인 중…</small>
      </li>
    );
  }
  if (result === undefined || result.failed) {
    return (
      <li>
        <span>{label}</span>
        <small>시간표를 불러오지 못했어요.</small>
      </li>
    );
  }
  const departure = result.response?.items[0];
  if (departure === undefined) {
    return (
      <li>
        <span>{label}</span>
        <small>오늘 남은 출발편이 없어요.</small>
      </li>
    );
  }
  return (
    <li>
      <span>{label}</span>
      <strong>
        <time dateTime={departure.departureAt}>
          {formatKstTime(departure.departureAt)}
        </time>
        <small>{displayStationName(departure.terminalStationName)} 방면</small>
      </strong>
    </li>
  );
}

export function NearbySubwayPanel({
  origin,
  destination,
  searchNearby = getNearbySubwayStations,
  searchDepartures = getSubwayDepartures,
}: NearbySubwayPanelProps) {
  const nearbyQuery = useQuery({
    queryKey: [
      "nearby-subway-stations",
      origin.location.lat,
      origin.location.lng,
      destination.location.lat,
      destination.location.lng,
    ],
    queryFn: async ({ signal }): Promise<NearbyResult> => {
      const results = await Promise.allSettled([
        searchNearby({ coordinate: origin.location, signal }),
        searchNearby({ coordinate: destination.location, signal }),
      ]);
      return {
        origin: results[0].status === "fulfilled" ? results[0].value.items : null,
        destination:
          results[1].status === "fulfilled" ? results[1].value.items : null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const endpointStations = useMemo(
    () => ({
      origin: primaryStation(nearbyQuery.data?.origin ?? null),
      destination: primaryStation(nearbyQuery.data?.destination ?? null),
    }),
    [nearbyQuery.data],
  );
  const mappedStationIds = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(endpointStations)
            .filter(
              (station): station is SubwayStation =>
                station?.mappingStatus === "MAPPED" &&
                station.tagoStationId !== null,
            )
            .map((station) => station.id),
        ),
      ),
    [endpointStations],
  );

  const departuresQuery = useQuery({
    queryKey: ["nearby-subway-departures", ...mappedStationIds],
    queryFn: async ({ signal }): Promise<Record<string, StationSchedule>> => {
      const requests = mappedStationIds.flatMap((stationId) =>
        (["U", "D"] as const).map((direction) => ({
          stationId,
          direction,
          request: searchDepartures({
            stationId,
            direction,
            limit: 2,
            signal,
          }),
        })),
      );
      const results = await Promise.allSettled(
        requests.map((request) => request.request),
      );
      const schedules: Record<string, StationSchedule> = {};
      requests.forEach((request, index) => {
        schedules[request.stationId] ??= {
          U: { response: null, failed: true },
          D: { response: null, failed: true },
        };
        const result = results[index]!;
        schedules[request.stationId]![request.direction] =
          result.status === "fulfilled"
            ? { response: result.value, failed: false }
            : { response: null, failed: true };
      });
      return schedules;
    },
    enabled: mappedStationIds.length > 0,
    staleTime: 60 * 1000,
  });

  return (
    <section className="nearby-subway-panel" aria-labelledby="nearby-subway-title">
      <header>
        <span className="subway-panel-icon" aria-hidden="true">
          <TrainFront />
        </span>
        <span>
          <small>주변 지하철</small>
          <h2 id="nearby-subway-title">역과 다음 출발 시간</h2>
        </span>
      </header>
      <p className="subway-schedule-notice">
        <Clock3 aria-hidden="true" />
        <strong>TAGO 시간표 기반 예상</strong>
        <span>실시간 지연 미반영</span>
      </p>

      {nearbyQuery.isPending ? (
        <p className="subway-panel-status" role="status">
          출발·도착 주변 역을 찾고 있어요…
        </p>
      ) : (
        <div className="subway-endpoint-grid">
          {endpointMeta.map(({ key, label }) => {
            const stations = nearbyQuery.data?.[key] ?? null;
            const station = endpointStations[key];
            if (stations === null) {
              return (
                <article key={key} className="subway-endpoint-card is-unavailable">
                  <small>{label}</small>
                  <strong>주변 역 조회 실패</strong>
                  <p>경로 추천은 그대로 이용할 수 있어요.</p>
                </article>
              );
            }
            if (station === null) {
              return (
                <article key={key} className="subway-endpoint-card is-unavailable">
                  <small>{label}</small>
                  <strong>2km 안에 등록된 역 없음</strong>
                </article>
              );
            }
            const alternatives = stations.filter(
              (candidate) => candidate.id !== station.id,
            );
            const schedule = departuresQuery.data?.[station.id];
            return (
              <article key={key} className="subway-endpoint-card">
                <small>{label}</small>
                <h3>{displayStationName(station.name)}</h3>
                <p className="subway-station-meta">
                  <span>{station.lineName}</span>
                  {station.distanceMeters === undefined ? null : (
                    <span>{formatDistance(station.distanceMeters)}</span>
                  )}
                </p>
                {station.mappingStatus === "MAPPED" ? (
                  <ul aria-label={`${displayStationName(station.name)} 다음 출발 시간표`}>
                    <DirectionDeparture
                      direction="U"
                      result={schedule?.U}
                      loading={departuresQuery.isPending}
                    />
                    <DirectionDeparture
                      direction="D"
                      result={schedule?.D}
                      loading={departuresQuery.isPending}
                    />
                  </ul>
                ) : (
                  <p className="subway-mapping-pending">
                    TAGO 역 매핑 전이라 시간표를 제공하지 못해요.
                  </p>
                )}
                {alternatives.length === 0 ? null : (
                  <p className="subway-nearby-alternatives">
                    인근: {alternatives.map((item) => displayStationName(item.name)).join(" · ")}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="subway-routing-boundary">
        현재 추천 소요시간에는 지하철 시간표가 합산되지 않습니다.
      </p>
    </section>
  );
}
