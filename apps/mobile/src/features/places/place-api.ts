import {
  placeSearchResponseSchema,
  reverseGeocodeResponseSchema,
  type Coordinate,
  type Place,
} from "@chimap/contracts";

import { mobileClientHeaders } from "../api/client-metadata";
import { fetchWithTimeout } from "../api/fetch-with-timeout";

export async function searchPlaces(input: {
  apiBaseUrl: string;
  query: string;
  center?: Coordinate;
  signal?: AbortSignal;
}): Promise<Place[]> {
  const url = new URL("/api/v1/places", input.apiBaseUrl);
  url.searchParams.set("query", input.query);
  url.searchParams.set("scope", "resolve");
  url.searchParams.set("limit", "8");
  if (input.center !== undefined) {
    url.searchParams.set("x", String(input.center.lng));
    url.searchParams.set("y", String(input.center.lat));
  }
  const response = await fetchWithTimeout(
    url,
    {
      headers: mobileClientHeaders(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
    8_000,
  );
  if (!response.ok) {
    throw new Error("장소를 검색하지 못했습니다.");
  }
  return placeSearchResponseSchema.parse(await response.json()).items;
}

export async function reverseGeocode(input: {
  apiBaseUrl: string;
  coordinate: Coordinate;
  fallbackName?: string;
  signal?: AbortSignal;
}): Promise<Place> {
  const url = new URL("/api/v1/places/reverse", input.apiBaseUrl);
  url.searchParams.set("x", String(input.coordinate.lng));
  url.searchParams.set("y", String(input.coordinate.lat));
  const response = await fetchWithTimeout(
    url,
    {
      headers: mobileClientHeaders(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
    8_000,
  );
  if (!response.ok) {
    throw new Error(`${input.fallbackName ?? "선택한 위치"}의 주소를 찾지 못했습니다.`);
  }
  const place = reverseGeocodeResponseSchema.parse(await response.json()).place;
  return (
    place ?? {
      id: `coordinate:${input.coordinate.lat},${input.coordinate.lng}`,
      name: input.fallbackName ?? "선택한 위치",
      address: "",
      roadAddress: "",
      category: input.fallbackName ?? "선택한 위치",
      location: input.coordinate,
    }
  );
}
