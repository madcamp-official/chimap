import type {
  Coordinate,
  NormalizedRoute,
  Place,
} from "@chimap/contracts";

import type {
  RouteGeometryProfile,
  SubwayGeometryObservation,
} from "./subway-track-geometry.js";
import type { RouteGeometryObservation } from "./route-geometry.js";

export type WalkRouteMode = "BROAD_FIRST" | "SHORTEST" | "ACCESSIBLE";

export type PlaceSearchOptions = {
  center?: Coordinate;
  limit?: number;
  radiusMeters?: number;
  signal?: AbortSignal;
};

export type TransitRouteRequest = {
  origin: Place;
  destination: Place;
  signal?: AbortSignal;
  geometryProfile?: RouteGeometryProfile;
  observeSubwayGeometry?: (observation: SubwayGeometryObservation) => void;
  observeRouteGeometry?: (observation: RouteGeometryObservation) => void;
};

export type WalkRouteRequest = {
  origin: Coordinate;
  destination: Coordinate;
  vias?: Coordinate[];
  routeMode?: WalkRouteMode;
  signal?: AbortSignal;
};

export type RoadRouteRequest = {
  points: Coordinate[];
  signal?: AbortSignal;
};

export type RoadRouteSectionsRequest = RoadRouteRequest;

export type RoadRouteSectionsResult = {
  sections: Coordinate[][];
};

export interface RoadGeometryProvider {
  getRoadRouteGeometry(request: RoadRouteRequest): Promise<Coordinate[]>;
  getRoadRouteSections(
    request: RoadRouteSectionsRequest,
  ): Promise<RoadRouteSectionsResult>;
}

export interface WalkingRouteProvider {
  readonly source: "KAKAO" | "VALHALLA";
  getWalkingRoute(request: WalkRouteRequest): Promise<NormalizedRoute>;
}

export interface MobilityProvider {
  readonly source: "KAKAO" | "TAGO";

  searchPlaces(
    query: string,
    options?: PlaceSearchOptions,
  ): Promise<Place[]>;

  getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]>;

  getWalkingRoute(request: WalkRouteRequest): Promise<NormalizedRoute>;
}
