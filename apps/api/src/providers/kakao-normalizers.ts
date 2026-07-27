import {
  coordinateSchema,
  type Coordinate,
  type NormalizedRoute,
  normalizedRouteSchema,
  type Place,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

import { ProviderError } from "../errors.js";

const kakaoPlaceDocumentSchema = z
  .object({
    id: z.string(),
    place_name: z.string(),
    category_name: z.string().optional(),
    category_group_name: z.string().optional(),
    address_name: z.string().optional(),
    road_address_name: z.string().optional(),
    x: z.string(),
    y: z.string(),
  })
  .passthrough();

const kakaoPlaceResponseSchema = z
  .object({
    documents: z.array(kakaoPlaceDocumentSchema).default([]),
  })
  .passthrough();

const kakaoAddressDetailsSchema = z
  .object({
    address_name: z.string(),
  })
  .passthrough();

const kakaoRoadAddressDetailsSchema = z
  .object({
    address_name: z.string(),
    building_name: z.string().optional(),
  })
  .passthrough();

const kakaoAddressDocumentSchema = z
  .object({
    address_name: z.string(),
    address_type: z.string(),
    x: z.string(),
    y: z.string(),
    address: kakaoAddressDetailsSchema.nullable().optional(),
    road_address: kakaoRoadAddressDetailsSchema.nullable().optional(),
  })
  .passthrough();

const kakaoAddressResponseSchema = z
  .object({
    documents: z.array(kakaoAddressDocumentSchema).default([]),
  })
  .passthrough();

const kakaoReverseDocumentSchema = z
  .object({
    address: kakaoAddressDetailsSchema.nullable().optional(),
    road_address: kakaoRoadAddressDetailsSchema.nullable().optional(),
  })
  .passthrough();

const kakaoReverseResponseSchema = z
  .object({
    documents: z.array(kakaoReverseDocumentSchema).default([]),
  })
  .passthrough();

const pathSchema = z
  .object({
    points: z.array(z.array(z.number()).min(2)).default([]),
  })
  .passthrough()
  .optional();

const transitStepSchema = z
  .object({
    properties: z
      .object({
        guidance: z.string().optional(),
        type: z.string(),
        distance: z.number().int().nonnegative(),
        time: z.number().int().nonnegative(),
        stops: z
          .array(z.object({ name: z.string() }).passthrough())
          .optional(),
        vehicles: z
          .array(
            z
              .object({
                name: z.string(),
                type: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    path: pathSchema,
  })
  .passthrough();

const transitRouteSchema = z
  .object({
    properties: z
      .object({
        type: z.string(),
        totalDistance: z.number().int().nonnegative(),
        totalTime: z.number().int().positive(),
        transfers: z.number().int().nonnegative(),
        fare: z
          .object({
            value: z.number().int().nonnegative().optional(),
            min: z.number().int().nonnegative().optional(),
            max: z.number().int().nonnegative().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    steps: z.array(transitStepSchema).default([]),
  })
  .passthrough();

const kakaoTransitResponseSchema = z
  .object({
    status: z.string(),
    routes: z.array(transitRouteSchema).optional(),
  })
  .passthrough();

const walkStepSchema = z
  .object({
    properties: z
      .object({
        distance: z.number().int().nonnegative(),
        guidance: z.string().optional(),
        time: z.number().int().nonnegative(),
        x: z.number().finite().optional(),
        y: z.number().finite().optional(),
      })
      .passthrough(),
    path: pathSchema,
  })
  .passthrough();

const walkLegSchema = z
  .object({
    properties: z
      .object({
        distance: z.number().int().nonnegative(),
        time: z.number().int().nonnegative(),
      })
      .passthrough(),
    steps: z.array(walkStepSchema).default([]),
  })
  .passthrough();

const kakaoWalkResponseSchema = z
  .object({
    status: z.string(),
    route: z
      .object({
        properties: z
          .object({
            totalDistance: z.number().int().nonnegative(),
            totalTime: z.number().int().positive(),
          })
          .passthrough(),
        legs: z.array(walkLegSchema).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const kakaoDrivingResponseSchema = z
  .object({
    routes: z
      .array(
        z
          .object({
            result_code: z.number().int(),
            result_msg: z.string(),
            sections: z
              .array(
                z
                  .object({
                    roads: z
                      .array(
                        z
                          .object({
                            vertexes: z.array(z.number().finite()),
                          })
                          .passthrough(),
                      )
                      .default([]),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

function parseCoordinates(
  points: ReadonlyArray<ReadonlyArray<number>>,
): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const point of points) {
    const lng = point[0];
    const lat = point[1];
    const parsed = coordinateSchema.safeParse({ lng, lat });
    if (parsed.success) {
      coordinates.push(parsed.data);
    }
  }
  return coordinates;
}

function pushUniqueCoordinate(
  coordinates: Coordinate[],
  coordinate: Coordinate,
): void {
  const previous = coordinates.at(-1);
  if (
    previous === undefined ||
    previous.lng !== coordinate.lng ||
    previous.lat !== coordinate.lat
  ) {
    coordinates.push(coordinate);
  }
}

function stablePlaceId(prefix: string, values: string[]): string {
  const digest = createHash("sha256")
    .update(values.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}:${digest}`;
}

function transitStatusError(status: string): ProviderError {
  if (status === "NO_RESULTS") {
    return new ProviderError({
      kind: "NO_ROUTE",
      message: "Kakao 대중교통 경로가 없습니다.",
    });
  }
  if (
    status === "STARTNODES_NULL" ||
    status === "ENDNODES_NULL" ||
    status === "EQUAL_POINTS" ||
    status === "INVALID_REQUEST"
  ) {
    return new ProviderError({
      kind: "INVALID_LOCATION",
      message: `Kakao 대중교통 위치 오류: ${status}`,
    });
  }
  return new ProviderError({
    kind: "UPSTREAM",
    message: `알 수 없는 Kakao 대중교통 상태: ${status}`,
  });
}

function walkStatusError(status: string): ProviderError {
  if (
    status === "SAME_POINT" ||
    status === "START_LINK_NOT_FOUND" ||
    status === "END_LINK_NOT_FOUND"
  ) {
    return new ProviderError({
      kind: "INVALID_LOCATION",
      message: `Kakao 도보 위치 오류: ${status}`,
    });
  }
  if (status === "TOO_FAR_AWAY" || status === "ROUTE_RESULT_NOT_FOUND") {
    return new ProviderError({
      kind: "NO_ROUTE",
      message: `Kakao 도보 경로가 없습니다: ${status}`,
    });
  }
  return new ProviderError({
    kind: "UPSTREAM",
    message: `알 수 없는 Kakao 도보 상태: ${status}`,
  });
}

export function normalizeKakaoPlaceResponse(input: unknown): Place[] {
  const response = kakaoPlaceResponseSchema.parse(input);
  const places: Place[] = [];

  for (const document of response.documents) {
    const lng = Number(document.x);
    const lat = Number(document.y);
    const coordinate = coordinateSchema.safeParse({ lng, lat });
    if (!coordinate.success) {
      continue;
    }

    places.push({
      id: `kakao:place:${document.id}`,
      name: document.place_name,
      address: document.address_name ?? "",
      roadAddress: document.road_address_name ?? "",
      category:
        document.category_group_name ?? document.category_name ?? "",
      location: coordinate.data,
    });
  }

  return places;
}

export function normalizeKakaoAddressResponse(input: unknown): Place[] {
  const response = kakaoAddressResponseSchema.parse(input);
  const places: Place[] = [];
  for (const document of response.documents) {
    const coordinate = coordinateSchema.safeParse({
      lng: Number(document.x),
      lat: Number(document.y),
    });
    if (!coordinate.success) {
      continue;
    }
    const address = document.address?.address_name ?? "";
    const roadAddress = document.road_address?.address_name ?? "";
    const name =
      document.road_address?.building_name?.trim() ||
      roadAddress ||
      address ||
      document.address_name;
    places.push({
      id: stablePlaceId("kakao:address", [
        document.address_name,
        document.x,
        document.y,
      ]),
      name,
      address,
      roadAddress,
      category: "주소",
      location: coordinate.data,
    });
  }
  return places;
}

export function normalizeKakaoReverseGeocodeResponse(
  input: unknown,
  coordinate: Coordinate,
): Place | null {
  const response = kakaoReverseResponseSchema.parse(input);
  const document = response.documents[0];
  if (document === undefined) {
    return null;
  }
  const address = document.address?.address_name ?? "";
  const roadAddress = document.road_address?.address_name ?? "";
  const name =
    document.road_address?.building_name?.trim() ||
    roadAddress ||
    address;
  if (name.length === 0) {
    return null;
  }
  return {
    id: stablePlaceId("kakao:address", [
      address,
      roadAddress,
      coordinate.lng.toFixed(6),
      coordinate.lat.toFixed(6),
    ]),
    name,
    address,
    roadAddress,
    category: "주소",
    location: coordinate,
  };
}

export function normalizeKakaoTransitResponse(
  input: unknown,
): NormalizedRoute[] {
  const response = kakaoTransitResponseSchema.parse(input);
  if (response.status !== "OK") {
    throw transitStatusError(response.status);
  }

  const normalized: NormalizedRoute[] = [];
  for (const [routeIndex, route] of (response.routes ?? []).entries()) {
    const legs = route.steps.flatMap((step, stepIndex) => {
      const mode =
        step.properties.type === "WALKING"
          ? ("WALK" as const)
          : step.properties.type === "BUS"
            ? ("BUS" as const)
            : step.properties.type === "SUBWAY"
              ? ("SUBWAY" as const)
              : undefined;
      if (mode === undefined) {
        return [];
      }

      const name = step.properties.vehicles?.[0]?.name;
      const guidance = step.properties.guidance?.trim();
      const stops = step.properties.stops
        ?.map((stop) => stop.name.trim())
        .filter(Boolean);
      return [
        {
          id: `kakao-transit-${routeIndex}-leg-${stepIndex}`,
          mode,
          ...(name === undefined || name.length === 0 ? {} : { name }),
          ...(guidance === undefined || guidance.length === 0
            ? {}
            : { guidance }),
          distanceMeters: step.properties.distance,
          durationSeconds: step.properties.time,
          ...(stops === undefined || stops.length === 0 ? {} : { stops }),
          coordinates: parseCoordinates(step.path?.points ?? []),
          isExerciseSegment: false,
        },
      ];
    });

    if (legs.length === 0) {
      continue;
    }

    const walkDistanceMeters = legs
      .filter((leg) => leg.mode === "WALK")
      .reduce((total, leg) => total + leg.distanceMeters, 0);
    const transitDistanceMeters = legs
      .filter((leg) => leg.mode !== "WALK")
      .reduce((total, leg) => total + leg.distanceMeters, 0);
    const fareWon =
      route.properties.fare?.value ??
      route.properties.fare?.min ??
      route.properties.fare?.max;

    const parsed = normalizedRouteSchema.safeParse({
      id: `kakao-transit-${routeIndex}`,
      source: "KAKAO",
      durationSeconds: route.properties.totalTime,
      distanceMeters: route.properties.totalDistance,
      walkDistanceMeters,
      transitDistanceMeters,
      transferCount: route.properties.transfers,
      ...(fareWon === undefined ? {} : { fareWon }),
      legs,
    });
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }

  if (normalized.length === 0) {
    throw new ProviderError({
      kind: "NO_ROUTE",
      message: "정규화할 수 있는 Kakao 대중교통 경로가 없습니다.",
    });
  }

  return normalized;
}

export function normalizeKakaoWalkResponse(
  input: unknown,
): NormalizedRoute {
  const response = kakaoWalkResponseSchema.parse(input);
  if (response.status !== "OK") {
    throw walkStatusError(response.status);
  }
  if (response.route === undefined) {
    throw new ProviderError({
      kind: "NO_ROUTE",
      message: "Kakao 도보 응답에 route가 없습니다.",
    });
  }

  const legs = response.route.legs.flatMap((leg, legIndex) => {
    if (leg.steps.length === 0) {
      return [
        {
          id: `kakao-walk-leg-${legIndex}`,
          mode: "WALK" as const,
          guidance: "도보로 이동",
          distanceMeters: leg.properties.distance,
          durationSeconds: leg.properties.time,
          coordinates: [],
          isExerciseSegment: false,
        },
      ];
    }

    return leg.steps.map((step, stepIndex) => {
      const pathCoordinates = parseCoordinates(step.path?.points ?? []);
      const fallbackCoordinate = coordinateSchema.safeParse({
        lng: step.properties.x,
        lat: step.properties.y,
      });
      const coordinates =
        pathCoordinates.length > 0
          ? pathCoordinates
          : fallbackCoordinate.success
            ? [fallbackCoordinate.data]
            : [];
      const guidance = step.properties.guidance?.trim();

      return {
        id: `kakao-walk-${legIndex}-step-${stepIndex}`,
        mode: "WALK" as const,
        ...(guidance === undefined || guidance.length === 0
          ? {}
          : { guidance }),
        distanceMeters: step.properties.distance,
        durationSeconds: step.properties.time,
        coordinates,
        isExerciseSegment: false,
      };
    });
  });

  if (legs.length === 0) {
    throw new ProviderError({
      kind: "NO_ROUTE",
      message: "정규화할 수 있는 Kakao 도보 구간이 없습니다.",
    });
  }

  return normalizedRouteSchema.parse({
    id: "kakao-walk",
    source: "KAKAO",
    durationSeconds: response.route.properties.totalTime,
    distanceMeters: response.route.properties.totalDistance,
    walkDistanceMeters: response.route.properties.totalDistance,
    transitDistanceMeters: 0,
    transferCount: 0,
    legs,
  });
}

export function normalizeKakaoDrivingSections(
  input: unknown,
): Coordinate[][] {
  const response = kakaoDrivingResponseSchema.parse(input);
  const route = response.routes[0];
  if (route === undefined || route.result_code !== 0) {
    throw new ProviderError({
      kind: "NO_ROUTE",
      message:
        route?.result_msg ?? "Kakao 도로 매칭 경로를 찾지 못했습니다.",
    });
  }

  const sections = route.sections.map((section) => {
    const coordinates: Coordinate[] = [];
    for (const road of section.roads) {
      for (let index = 0; index < road.vertexes.length - 1; index += 2) {
        const parsed = coordinateSchema.safeParse({
          lng: road.vertexes[index],
          lat: road.vertexes[index + 1],
        });
        if (parsed.success) {
          pushUniqueCoordinate(coordinates, parsed.data);
        }
      }
    }
    return coordinates;
  });
  if (!sections.some((coordinates) => coordinates.length >= 2)) {
    throw new ProviderError({
      kind: "NO_ROUTE",
      message: "Kakao 도로 매칭 응답에 표시할 좌표가 없습니다.",
    });
  }
  return sections;
}

export function normalizeKakaoDrivingGeometry(
  input: unknown,
): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const section of normalizeKakaoDrivingSections(input)) {
    for (const coordinate of section) {
      pushUniqueCoordinate(coordinates, coordinate);
    }
  }
  return coordinates;
}
