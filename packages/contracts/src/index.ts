import { z } from "zod";

export const coordinateSchema = z
  .object({
    lng: z.number().finite().min(-180).max(180),
    lat: z.number().finite().min(-90).max(90),
  })
  .strict();

export type Coordinate = z.infer<typeof coordinateSchema>;

export const placeSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(100),
    address: z.string().max(200).default(""),
    roadAddress: z.string().max(200).default(""),
    category: z.string().max(100).default(""),
    location: coordinateSchema,
  })
  .strict();

export type Place = z.infer<typeof placeSchema>;

export const busDataSourceSchema = z.enum(["csv", "tago", "database"]);
export type BusDataSource = z.infer<typeof busDataSourceSchema>;

export const busStopSchema = z
  .object({
    id: z.string().min(1).max(200),
    cityCode: z.string().min(1).max(20).nullable(),
    nodeId: z.string().min(1).max(100).nullable(),
    sourceStopNo: z.string().min(1).max(100).nullable(),
    arsId: z.string().min(1).max(100).nullable(),
    name: z.string().min(1).max(200),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    distanceMeters: z.number().int().nonnegative().optional(),
    source: busDataSourceSchema,
  })
  .strict();

export type BusStop = z.infer<typeof busStopSchema>;

export const busRouteSchema = z
  .object({
    id: z.string().min(1).max(200),
    cityCode: z.string().min(1).max(20),
    routeId: z.string().min(1).max(100),
    routeNo: z.string().min(1).max(100),
    routeName: z.string().min(1).max(200),
    routeType: z.string().max(100).nullable(),
    startStopName: z.string().max(200).nullable(),
    endStopName: z.string().max(200).nullable(),
    firstBusTime: z.string().max(20).nullable(),
    lastBusTime: z.string().max(20).nullable(),
    weekdayIntervalMinutes: z.number().int().positive().nullable(),
    weekendIntervalMinutes: z.number().int().positive().nullable(),
    source: z.enum(["tago", "database"]),
  })
  .strict();

export type BusRoute = z.infer<typeof busRouteSchema>;

export const busRouteStopSchema = z
  .object({
    routeId: z.string().min(1).max(100),
    stopId: z.string().min(1).max(200),
    nodeId: z.string().min(1).max(100),
    cityCode: z.string().min(1).max(20),
    stopName: z.string().min(1).max(200),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    nodeOrder: z.number().int().nonnegative(),
    direction: z.string().max(100).nullable(),
  })
  .strict();

export type BusRouteStop = z.infer<typeof busRouteStopSchema>;

export const busArrivalSchema = z
  .object({
    cityCode: z.string().min(1).max(20),
    nodeId: z.string().min(1).max(100),
    routeId: z.string().min(1).max(100),
    routeNo: z.string().min(1).max(100),
    routeType: z.string().max(100).nullable(),
    remainingStops: z.number().int().nonnegative().nullable(),
    arrivalSeconds: z.number().int().nonnegative(),
    arrivalMinutes: z.number().int().nonnegative(),
    vehicleType: z.string().max(100).nullable(),
    isRealtime: z.boolean(),
    fetchedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BusArrival = z.infer<typeof busArrivalSchema>;

export const busVehiclePositionSchema = z
  .object({
    cityCode: z.string().min(1).max(20),
    routeId: z.string().min(1).max(100),
    routeNo: z.string().min(1).max(100),
    vehicleNo: z.string().max(100).nullable(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    nodeId: z.string().max(100).nullable(),
    nodeName: z.string().max(200).nullable(),
    nodeOrder: z.number().int().nonnegative().nullable(),
    routeType: z.string().max(100).nullable(),
    fetchedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BusVehiclePosition = z.infer<typeof busVehiclePositionSchema>;

export const transitBusLegSchema = z
  .object({
    routeId: z.string().min(1).max(100),
    cityCode: z.string().min(1).max(20),
    routeNo: z.string().min(1).max(100),
    routeType: z.string().max(100).nullable(),
    boardingStop: busStopSchema,
    alightingStop: busStopSchema,
    stopCount: z.number().int().positive(),
    boardingNodeOrder: z.number().int().nonnegative(),
    alightingNodeOrder: z.number().int().nonnegative(),
    expectedArrivalSeconds: z.number().int().nonnegative(),
    expectedRideSeconds: z.number().int().nonnegative(),
    vehicleNo: z.string().max(100).nullable(),
    vehicleType: z.string().max(100).nullable(),
    isArrivalRealtime: z.boolean(),
    polyline: z.array(coordinateSchema).min(2),
    stops: z.array(busRouteStopSchema).min(2).max(500),
  })
  .strict();

export type TransitBusLeg = z.infer<typeof transitBusLegSchema>;

export const routeModeSchema = z.enum(["WALK", "BUS", "SUBWAY"]);
export type RouteMode = z.infer<typeof routeModeSchema>;

export const routeLegSchema = z
  .object({
    id: z.string().min(1).max(200),
    mode: routeModeSchema,
    name: z.string().min(1).max(100).optional(),
    guidance: z.string().min(1).max(500).optional(),
    distanceMeters: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
    stops: z.array(z.string().min(1).max(100)).max(200).optional(),
    coordinates: z.array(coordinateSchema),
    isExerciseSegment: z.boolean(),
    bus: transitBusLegSchema.optional(),
  })
  .strict()
  .superRefine((leg, context) => {
    if (leg.mode !== "WALK" && leg.isExerciseSegment) {
      context.addIssue({
        code: "custom",
        path: ["isExerciseSegment"],
        message: "운동 구간은 도보 구간에만 지정할 수 있습니다.",
      });
    }
  });

export type RouteLeg = z.infer<typeof routeLegSchema>;

export const routeSourceSchema = z.enum(["KAKAO", "TAGO", "MOCK"]);
export type RouteSource = z.infer<typeof routeSourceSchema>;

export const normalizedRouteSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: routeSourceSchema,
    durationSeconds: z.number().int().positive(),
    distanceMeters: z.number().int().nonnegative(),
    walkDistanceMeters: z.number().int().nonnegative(),
    transitDistanceMeters: z.number().int().nonnegative(),
    transferCount: z.number().int().nonnegative(),
    fareWon: z.number().int().nonnegative().optional(),
    waitingDurationSeconds: z.number().int().nonnegative().optional(),
    ridingDurationSeconds: z.number().int().nonnegative().optional(),
    isRealtime: z.boolean().optional(),
    isPartial: z.boolean().optional(),
    estimationNotes: z.array(z.string().min(1).max(300)).max(20).optional(),
    legs: z.array(routeLegSchema).min(1),
  })
  .strict();

export type NormalizedRoute = z.infer<typeof normalizedRouteSchema>;

export const placeSearchQuerySchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    x: z.coerce.number().finite().min(-180).max(180).optional(),
    y: z.coerce.number().finite().min(-90).max(90).optional(),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.x === undefined) !== (value.y === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["x"],
        message: "x와 y는 함께 제공해야 합니다.",
      });
    }
  });

export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;

export const placeSearchResponseSchema = z
  .object({
    items: z.array(placeSchema).max(10),
  })
  .strict();

export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>;

export const recommendationRequestSchema = z
  .object({
    origin: placeSchema,
    destination: placeSchema,
    deadline: z.iso.datetime({ offset: true }),
    currentSteps: z.number().int().min(0).max(100_000),
    goalSteps: z.number().int().min(1).max(100_000),
    maxExtraMinutes: z.number().int().min(0).max(120),
    strideLengthMeters: z.number().finite().min(0.3).max(1.2),
    safetyBufferMinutes: z.number().int().min(0).max(15).default(3),
  })
  .strict();

export type RecommendationRequest = z.infer<
  typeof recommendationRequestSchema
>;

export const baselineSummarySchema = z
  .object({
    durationSeconds: z.number().int().positive(),
    arrivalAt: z.iso.datetime({ offset: true }),
    walkDistanceMeters: z.number().int().nonnegative(),
    estimatedSteps: z.number().int().nonnegative(),
  })
  .strict();

export type BaselineSummary = z.infer<typeof baselineSummarySchema>;

export const recommendationTypeSchema = z.enum([
  "FAST",
  "BALANCED",
  "GOAL",
]);

export type RecommendationType = z.infer<typeof recommendationTypeSchema>;

export const recommendationSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: recommendationTypeSchema,
    title: z.string().min(1).max(50),
    reason: z.string().min(1).max(300),
    durationSeconds: z.number().int().positive(),
    arrivalAt: z.iso.datetime({ offset: true }),
    extraMinutes: z.number().int(),
    walkDistanceMeters: z.number().int().nonnegative(),
    estimatedSteps: z.number().int().nonnegative(),
    expectedTotalSteps: z.number().int().nonnegative(),
    dailyGoalCompletionRate: z.number().finite().min(0).max(1),
    shortfallCoverageRate: z.number().finite().min(0).max(1),
    transferCount: z.number().int().nonnegative(),
    fareWon: z.number().int().nonnegative().optional(),
    waitingDurationSeconds: z.number().int().nonnegative().optional(),
    ridingDurationSeconds: z.number().int().nonnegative().optional(),
    isRealtime: z.boolean().optional(),
    isPartial: z.boolean().optional(),
    estimationNotes: z.array(z.string().min(1).max(300)).max(20).optional(),
    legs: z.array(routeLegSchema).min(1),
  })
  .strict();

export type Recommendation = z.infer<typeof recommendationSchema>;

export const transitRecommendationSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum(["bus", "mixed"]),
    totalDurationSeconds: z.number().int().positive(),
    walkingDurationSeconds: z.number().int().nonnegative(),
    waitingDurationSeconds: z.number().int().nonnegative(),
    ridingDurationSeconds: z.number().int().nonnegative(),
    transferDurationSeconds: z.number().int().nonnegative(),
    walkingDistanceMeters: z.number().int().nonnegative(),
    transferCount: z.number().int().nonnegative(),
    score: z.number().finite(),
    isRealtime: z.boolean(),
    estimationNotes: z.array(z.string().min(1).max(300)).max(20),
    legs: z.array(transitBusLegSchema).min(1).max(2),
  })
  .strict();

export type TransitRecommendation = z.infer<
  typeof transitRecommendationSchema
>;

export const warningCodeSchema = z.enum([
  "ESTIMATED_STEPS",
  "DEMO_DATA",
  "PARTIAL_CANDIDATE_FAILURE",
  "GOAL_UNREACHABLE_WITHIN_CONSTRAINTS",
  "LIMITED_ROUTE_VARIETY",
  "CURRENT_TIME_ESTIMATE",
  "REALTIME_UNAVAILABLE",
  "PARTIAL_TRANSIT_DATA",
]);

export type WarningCode = z.infer<typeof warningCodeSchema>;

export const apiWarningSchema = z
  .object({
    code: warningCodeSchema,
    message: z.string().min(1).max(500),
  })
  .strict();

export type ApiWarning = z.infer<typeof apiWarningSchema>;

export const recommendationResponseSchema = z
  .object({
    requestId: z.uuid(),
    mode: z.enum(["mock", "live"]),
    generatedAt: z.iso.datetime({ offset: true }),
    departureAt: z.iso.datetime({ offset: true }),
    baseline: baselineSummarySchema,
    recommendations: z.array(recommendationSchema).min(1).max(3),
    warnings: z.array(apiWarningSchema),
  })
  .strict()
  .superRefine((response, context) => {
    const routeIds = new Set<string>();
    const routeTypes = new Set<RecommendationType>();
    response.recommendations.forEach((recommendation, index) => {
      if (routeIds.has(recommendation.id)) {
        context.addIssue({
          code: "custom",
          path: ["recommendations", index, "id"],
          message: "추천 경로 ID는 중복될 수 없습니다.",
        });
      }
      if (routeTypes.has(recommendation.type)) {
        context.addIssue({
          code: "custom",
          path: ["recommendations", index, "type"],
          message: "추천 타입은 중복될 수 없습니다.",
        });
      }
      routeIds.add(recommendation.id);
      routeTypes.add(recommendation.type);
    });
  });

export type RecommendationResponse = z.infer<
  typeof recommendationResponseSchema
>;

export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    mode: z.enum(["mock", "live"]),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorCodeSchema = z.enum([
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "LOCATIONS_TOO_CLOSE",
  "PLACE_NOT_FOUND",
  "NO_TRANSIT_ROUTE",
  "NO_ROUTE_WITHIN_DEADLINE",
  "INVALID_LOCATION",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_RATE_LIMIT",
  "UPSTREAM_ERROR",
  "TRANSIT_NOT_CONFIGURED",
  "UNSUPPORTED_CITY",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(500),
        requestId: z.uuid(),
        fieldErrors: z
          .record(z.string(), z.array(z.string().min(1)))
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const nearbyBusStopsResponseSchema = z
  .object({
    items: z.array(busStopSchema).max(100),
    partial: z.boolean(),
  })
  .strict();

export type NearbyBusStopsResponse = z.infer<
  typeof nearbyBusStopsResponseSchema
>;

export const busRoutesResponseSchema = z
  .object({
    items: z.array(busRouteSchema).max(1000),
    source: z.enum(["database", "tago"]),
  })
  .strict();

export type BusRoutesResponse = z.infer<typeof busRoutesResponseSchema>;

export const busArrivalsResponseSchema = z
  .object({
    items: z.array(busArrivalSchema).max(1000),
    realtimeAvailable: z.boolean(),
    fetchedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BusArrivalsResponse = z.infer<
  typeof busArrivalsResponseSchema
>;

export const busRouteStopsResponseSchema = z
  .object({
    items: z.array(busRouteStopSchema).max(1000),
  })
  .strict();

export type BusRouteStopsResponse = z.infer<
  typeof busRouteStopsResponseSchema
>;

export const busVehiclesResponseSchema = z
  .object({
    items: z.array(busVehiclePositionSchema).max(1000),
    realtimeAvailable: z.boolean(),
    fetchedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BusVehiclesResponse = z.infer<
  typeof busVehiclesResponseSchema
>;

export const storedPreferencesV1Schema = z
  .object({
    version: z.literal(1),
    dailyGoalSteps: z.number().int().min(1).max(100_000),
    strideLengthMeters: z.number().finite().min(0.3).max(1.2),
    maxExtraMinutes: z.number().int().min(0).max(120),
    safetyBufferMinutes: z.number().int().min(0).max(15),
    lastOrigin: placeSchema.optional(),
    lastDestination: placeSchema.optional(),
  })
  .strict();

export type StoredPreferencesV1 = z.infer<
  typeof storedPreferencesV1Schema
>;

export const storedTripV1Schema = z
  .object({
    version: z.literal(1),
    selectedAt: z.iso.datetime({ offset: true }),
    originName: z.string().min(1).max(100),
    destinationName: z.string().min(1).max(100),
    routeType: recommendationTypeSchema,
    expectedSteps: z.number().int().nonnegative(),
    expectedArrivalAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type StoredTripV1 = z.infer<typeof storedTripV1Schema>;

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistanceMeters(
  first: Coordinate,
  second: Coordinate,
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const firstLatitude = toRadians(first.lat);
  const secondLatitude = toRadians(second.lat);
  const latitudeDelta = toRadians(second.lat - first.lat);
  const longitudeDelta = toRadians(second.lng - first.lng);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}
