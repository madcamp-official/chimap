import {
  haversineDistanceMeters,
  type Coordinate,
  type Recommendation,
  type RouteLeg,
} from "@chimap/contracts";

export type JourneyMapMarkerRole = "ORIGIN" | "TRANSFER" | "DESTINATION";

export type JourneyMapMarker = {
  coordinate: Coordinate;
  label: "출발" | "환승" | "도착";
  role: JourneyMapMarkerRole;
  title: string;
};

type TransitEndpoint = {
  coordinate: Coordinate;
  label: string;
  name: string;
};

function transitStart(leg: RouteLeg): TransitEndpoint | undefined {
  if (leg.mode === "BUS" && leg.bus !== undefined) {
    return {
      coordinate: {
        lat: leg.bus.boardingStop.latitude,
        lng: leg.bus.boardingStop.longitude,
      },
      label: `${leg.bus.routeNo}번`,
      name: leg.bus.boardingStop.name,
    };
  }
  if (leg.mode !== "SUBWAY") return undefined;
  const coordinate = leg.coordinates[0];
  if (coordinate === undefined) return undefined;
  return {
    coordinate,
    label: leg.name ?? "지하철",
    name: leg.stops?.[0] ?? "지하철역",
  };
}

function sameMarkerLocation(left: Coordinate, right: Coordinate): boolean {
  return haversineDistanceMeters(left, right) <= 15;
}

/**
 * 지도에는 전체 여정의 출발·환승·도착만 표시한다. 버스/지하철의 개별
 * 승차·하차 지점은 이동 단계에서 확인할 수 있으므로 지도 마커로 반복하지 않는다.
 */
export function buildJourneyMapMarkers(input: {
  route: Recommendation | null | undefined;
  origin: Coordinate | null | undefined;
  destination: Coordinate | null | undefined;
  originName?: string | undefined;
  destinationName?: string | undefined;
}): JourneyMapMarker[] {
  const markers: JourneyMapMarker[] = [];
  if (input.origin !== null && input.origin !== undefined) {
    markers.push({
      coordinate: input.origin,
      label: "출발",
      role: "ORIGIN",
      title: `${input.originName ?? "출발지"}에서 출발`,
    });
  }

  const transitLegs =
    input.route?.legs.flatMap((leg) => {
      const start = transitStart(leg);
      return start === undefined ? [] : [start];
    }) ?? [];
  const transferLimit = Math.min(
    input.route?.transferCount ?? 0,
    Math.max(0, transitLegs.length - 1),
  );
  for (let index = 1; index <= transferLimit; index += 1) {
    const previous = transitLegs[index - 1]!;
    const current = transitLegs[index]!;
    const duplicate = markers.some((marker) =>
      sameMarkerLocation(marker.coordinate, current.coordinate),
    );
    if (duplicate) continue;
    markers.push({
      coordinate: current.coordinate,
      label: "환승",
      role: "TRANSFER",
      title: `${current.name} · ${previous.label}에서 ${current.label}으로 환승`,
    });
  }

  if (input.destination !== null && input.destination !== undefined) {
    const duplicateTransferIndex = markers.findIndex(
      (marker) =>
        marker.role === "TRANSFER" &&
        sameMarkerLocation(marker.coordinate, input.destination!),
    );
    if (duplicateTransferIndex >= 0) markers.splice(duplicateTransferIndex, 1);
    markers.push({
      coordinate: input.destination,
      label: "도착",
      role: "DESTINATION",
      title: `${input.destinationName ?? "도착지"}에 도착`,
    });
  }
  return markers;
}
