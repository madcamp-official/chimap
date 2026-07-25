import type {
  Coordinate,
  NormalizedRoute,
  Place,
} from "@chimap/contracts";

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
};

export type WalkRouteRequest = {
  origin: Coordinate;
  destination: Coordinate;
  vias?: Coordinate[];
  routeMode?: WalkRouteMode;
  signal?: AbortSignal;
};

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
