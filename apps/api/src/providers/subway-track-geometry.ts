import {
  haversineDistanceMeters,
  type Coordinate,
} from "@chimap/contracts";

export type RouteGeometryProfile = "TRACK_V1" | "TRANSIT_V2";

export function usesTrackGeometry(
  profile?: RouteGeometryProfile,
): boolean {
  return profile === "TRACK_V1" || profile === "TRANSIT_V2";
}

export type SubwayGeometryFallbackReason =
  | "PROFILE_DISABLED"
  | "MISSING_GEOMETRY"
  | "MISSING_DISTANCE"
  | "ENDPOINT_MISMATCH"
  | "CONTINUITY_GAP";

export type SubwayGeometrySourceCategory =
  | "OFFICIAL"
  | "OSM"
  | "MIXED"
  | "UNKNOWN";

export type SubwayGeometryObservation = {
  outcome: "track" | "fallback";
  reason: SubwayGeometryFallbackReason | "NONE";
  source: SubwayGeometrySourceCategory;
  vertexCount: number;
};

export type SubwayRideGeometryEdge = {
  from: Coordinate;
  to: Coordinate;
  straightDistanceMeters: number;
  trackCoordinates: readonly Coordinate[] | null;
  trackDistanceMeters: number | null;
  geometrySource: string | null;
};

export type SubwayRideGeometry = {
  coordinates: Coordinate[];
  distanceMeters: number;
  usedTrackGeometry: boolean;
  observation: SubwayGeometryObservation;
};

const ENDPOINT_TOLERANCE_METERS = 250;
const CONTINUITY_TOLERANCE_METERS = 75;

function fallback(
  edges: readonly SubwayRideGeometryEdge[],
  stationCoordinates: readonly Coordinate[],
  reason: SubwayGeometryFallbackReason,
): SubwayRideGeometry {
  return {
    coordinates: [...stationCoordinates],
    distanceMeters: edges.reduce(
      (total, edge) => total + edge.straightDistanceMeters,
      0,
    ),
    usedTrackGeometry: false,
    observation: {
      outcome: "fallback",
      reason,
      source: "UNKNOWN",
      vertexCount: stationCoordinates.length,
    },
  };
}

function sourceCategory(source: string): Exclude<
  SubwayGeometrySourceCategory,
  "MIXED"
> {
  const normalized = source.toLocaleUpperCase();
  if (normalized.includes("OPENSTREETMAP") || normalized.includes("OSM")) {
    return "OSM";
  }
  if (
    normalized.includes("GTFS") ||
    normalized.includes("OFFICIAL") ||
    normalized.includes("공식")
  ) {
    return "OFFICIAL";
  }
  return "UNKNOWN";
}

function orient(
  coordinates: readonly Coordinate[],
  from: Coordinate,
  to: Coordinate,
): Coordinate[] | null {
  if (coordinates.length < 2) {
    return null;
  }
  const first = coordinates[0]!;
  const last = coordinates.at(-1)!;
  const forward =
    haversineDistanceMeters(first, from) +
    haversineDistanceMeters(last, to);
  const reverse =
    haversineDistanceMeters(first, to) +
    haversineDistanceMeters(last, from);
  const result = reverse < forward ? [...coordinates].reverse() : [...coordinates];
  if (
    haversineDistanceMeters(result[0]!, from) > ENDPOINT_TOLERANCE_METERS ||
    haversineDistanceMeters(result.at(-1)!, to) > ENDPOINT_TOLERANCE_METERS
  ) {
    return null;
  }
  return result;
}

export function assembleSubwayRideGeometry(input: {
  profile?: RouteGeometryProfile;
  edges: readonly SubwayRideGeometryEdge[];
  stationCoordinates: readonly Coordinate[];
}): SubwayRideGeometry {
  if (!usesTrackGeometry(input.profile)) {
    return fallback(input.edges, input.stationCoordinates, "PROFILE_DISABLED");
  }
  if (input.edges.some((edge) => edge.trackCoordinates === null)) {
    return fallback(input.edges, input.stationCoordinates, "MISSING_GEOMETRY");
  }
  if (input.edges.some((edge) => edge.trackDistanceMeters === null)) {
    return fallback(input.edges, input.stationCoordinates, "MISSING_DISTANCE");
  }

  const result: Coordinate[] = [];
  const categories = new Set<SubwayGeometrySourceCategory>();
  for (const edge of input.edges) {
    const coordinates = orient(edge.trackCoordinates!, edge.from, edge.to);
    if (coordinates === null) {
      return fallback(input.edges, input.stationCoordinates, "ENDPOINT_MISMATCH");
    }
    const source = edge.geometrySource;
    categories.add(source === null ? "UNKNOWN" : sourceCategory(source));
    if (result.length === 0) {
      result.push(...coordinates);
      continue;
    }
    const gap = haversineDistanceMeters(result.at(-1)!, coordinates[0]!);
    if (gap > CONTINUITY_TOLERANCE_METERS) {
      return fallback(input.edges, input.stationCoordinates, "CONTINUITY_GAP");
    }
    result.push(...coordinates.slice(gap <= 1 ? 1 : 0));
  }
  const source =
    categories.size === 1
      ? [...categories][0]!
      : categories.size > 1
        ? "MIXED"
        : "UNKNOWN";
  return {
    coordinates: result,
    distanceMeters: input.edges.reduce(
      (total, edge) => total + edge.trackDistanceMeters!,
      0,
    ),
    usedTrackGeometry: true,
    observation: {
      outcome: "track",
      reason: "NONE",
      source,
      vertexCount: result.length,
    },
  };
}
