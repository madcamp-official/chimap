import {
  haversineDistanceMeters,
  type Coordinate,
  type RouteLeg,
} from "@chimap/contracts";

export type RouteMarkerRole = "BOARD" | "TRANSFER" | "ALIGHT";

export type RouteMarker = {
  id: string;
  role: RouteMarkerRole;
  coordinate: Coordinate;
  label: string;
};

const duplicateDistanceMeters = 15;

function transitEndpoints(leg: RouteLeg): {
  boarding: Coordinate;
  boardingLabel: string;
  alighting: Coordinate;
  alightingLabel: string;
} | null {
  if (leg.mode === "BUS" && leg.bus !== undefined) {
    return {
      boarding: {
        lat: leg.bus.boardingStop.latitude,
        lng: leg.bus.boardingStop.longitude,
      },
      boardingLabel: leg.bus.boardingStop.name,
      alighting: {
        lat: leg.bus.alightingStop.latitude,
        lng: leg.bus.alightingStop.longitude,
      },
      alightingLabel: leg.bus.alightingStop.name,
    };
  }
  if (leg.mode === "SUBWAY" && leg.subway !== undefined) {
    return {
      boarding: leg.subway.boardingStation.location,
      boardingLabel: leg.subway.boardingStation.name,
      alighting: leg.subway.alightingStation.location,
      alightingLabel: leg.subway.alightingStation.name,
    };
  }
  return null;
}

export function deriveRouteMarkers(legs: readonly RouteLeg[]): RouteMarker[] {
  const transitLegs = legs
    .map((leg) => ({ leg, endpoints: transitEndpoints(leg) }))
    .filter(
      (
        item,
      ): item is {
        leg: RouteLeg;
        endpoints: NonNullable<ReturnType<typeof transitEndpoints>>;
      } => item.endpoints !== null,
    );

  const candidates = transitLegs.flatMap(({ leg, endpoints }, index) => {
    const lastIndex = transitLegs.length - 1;
    return [
      {
        id: `${leg.id}:board`,
        role: index === 0 ? ("BOARD" as const) : ("TRANSFER" as const),
        coordinate: endpoints.boarding,
        label: endpoints.boardingLabel,
      },
      {
        id: `${leg.id}:alight`,
        role:
          index === lastIndex ? ("ALIGHT" as const) : ("TRANSFER" as const),
        coordinate: endpoints.alighting,
        label: endpoints.alightingLabel,
      },
    ];
  });

  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (other) =>
          other.role === candidate.role &&
          haversineDistanceMeters(other.coordinate, candidate.coordinate) <=
            duplicateDistanceMeters,
      ) === index,
  );
}
