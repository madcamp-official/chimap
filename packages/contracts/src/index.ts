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

export const walkingRoleSchema = z.enum([
  "ACCESS",
  "TRANSFER",
  "GOAL_LATE_BOARDING",
  "GOAL_EARLY_ALIGHTING",
]);

export type WalkingRole = z.infer<typeof walkingRoleSchema>;

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
    walkingRole: walkingRoleSchema.optional(),
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
    if (leg.mode !== "WALK" && leg.walkingRole !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["walkingRole"],
        message: "도보 역할은 도보 구간에만 지정할 수 있습니다.",
      });
    }
    if (
      leg.walkingRole?.startsWith("GOAL_") === true &&
      !leg.isExerciseSegment
    ) {
      context.addIssue({
        code: "custom",
        path: ["isExerciseSegment"],
        message: "목표 도보 구간은 운동 구간으로 표시해야 합니다.",
      });
    }
  });

export type RouteLeg = z.infer<typeof routeLegSchema>;

export const routeSourceSchema = z.enum(["KAKAO", "TAGO"]);
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
    limit: z.coerce.number().int().min(1).max(10).default(8),
    scope: z.enum(["suggest", "resolve"]).default("resolve"),
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

export const placeSearchProviderSchema = z.enum(["KAKAO", "NAVER", "NONE"]);
export type PlaceSearchProvider = z.infer<
  typeof placeSearchProviderSchema
>;

export const placeSearchStrategySchema = z.enum([
  "KAKAO_KEYWORD",
  "KAKAO_KEYWORD_ADDRESS",
  "KAKAO_ADDRESS",
  "NAVER_GEOCODE",
  "NONE",
]);
export type PlaceSearchStrategy = z.infer<
  typeof placeSearchStrategySchema
>;

export const placeSearchMetaSchema = z
  .object({
    provider: placeSearchProviderSchema,
    strategy: placeSearchStrategySchema,
    fallbackUsed: z.boolean(),
    degraded: z.boolean(),
  })
  .strict();

export const placeSearchResponseSchema = z
  .object({
    items: z.array(placeSchema).max(10),
    meta: placeSearchMetaSchema,
  })
  .strict();

export type PlaceSearchResponse = z.infer<typeof placeSearchResponseSchema>;

export const reverseGeocodeQuerySchema = z
  .object({
    x: z.coerce.number().finite().min(-180).max(180),
    y: z.coerce.number().finite().min(-90).max(90),
  })
  .strict();

export type ReverseGeocodeQuery = z.infer<
  typeof reverseGeocodeQuerySchema
>;

export const reverseGeocodeResponseSchema = z
  .object({
    place: placeSchema.nullable(),
    meta: z
      .object({
        provider: placeSearchProviderSchema,
        fallbackUsed: z.boolean(),
        degraded: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ReverseGeocodeResponse = z.infer<
  typeof reverseGeocodeResponseSchema
>;

export const biologicalSexSchema = z.enum(["MALE", "FEMALE"]);
export type BiologicalSex = z.infer<typeof biologicalSexSchema>;

export const walkingProfileSchema = z
  .object({
    birthYear: z.number().int().min(1900).max(2100),
    heightCm: z.number().finite().min(120).max(220),
    weightKg: z.number().finite().min(30).max(200),
    biologicalSex: biologicalSexSchema,
  })
  .strict();

export type WalkingProfile = z.infer<typeof walkingProfileSchema>;

export const walkingMetricSchema = z
  .object({
    stepLengthMeters: z.number().finite().min(0.3).max(1.2),
    source: z.literal("RESEARCH_ESTIMATE"),
    modelVersion: z.literal("HAN_2026_V1"),
  })
  .strict();

export type WalkingMetric = z.infer<typeof walkingMetricSchema>;

export const HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND = 128.35;

export function estimatePersonalizedStepLengthMeters(
  profile: WalkingProfile,
  currentYear = new Date().getFullYear(),
): number {
  const parsed = walkingProfileSchema.parse(profile);
  const age = currentYear - parsed.birthYear;
  if (age < 18 || age > 90) {
    throw new RangeError("보폭 연구식은 만 18~90세에 적용할 수 있습니다.");
  }
  const sexCode = parsed.biologicalSex === "FEMALE" ? 1 : 0;
  const stepLengthCentimeters =
    -16.14 -
    0.06 * age +
    0.31 * parsed.heightCm -
    0.04 * parsed.weightKg +
    0.02 * sexCode +
    0.3 * HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND;
  return Math.round((stepLengthCentimeters / 100) * 10_000) / 10_000;
}

const recommendationRequestBaseShape = {
  origin: placeSchema,
  destination: placeSchema,
  currentSteps: z.number().int().min(0).max(100_000),
  goalSteps: z.number().int().min(1).max(100_000),
  walkingMetric: walkingMetricSchema,
};

export const automaticRecommendationRequestSchema = z
  .object(recommendationRequestBaseShape)
  .strict();

export type AutomaticRecommendationRequest = z.infer<
  typeof automaticRecommendationRequestSchema
>;

export const legacyRecommendationRequestSchema = z
  .object({
    ...recommendationRequestBaseShape,
    deadline: z.iso.datetime({ offset: true }),
    maxExtraMinutes: z.number().int().min(0).max(120),
    safetyBufferMinutes: z.number().int().min(0).max(15).default(3),
  })
  .strict();

export type LegacyRecommendationRequest = z.infer<
  typeof legacyRecommendationRequestSchema
>;

export const recommendationRequestSchema = z.union([
  automaticRecommendationRequestSchema,
  legacyRecommendationRequestSchema,
]);

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
    stepDifference: z.number().int(),
    goalFit: z.enum(["WITHIN_TOLERANCE", "UNDER", "OVER"]),
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
  "PARTIAL_CANDIDATE_FAILURE",
  "GOAL_UNREACHABLE_WITHIN_CONSTRAINTS",
  "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET",
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

export const walkingGoalSchema = z
  .object({
    remainingSteps: z.number().int().nonnegative(),
    targetWalkDistanceMeters: z.number().int().nonnegative(),
    toleranceSteps: z.number().int().nonnegative(),
    effectiveStepLengthMeters: z.number().finite().min(0.3).max(1.2),
    source: z.literal("RESEARCH_ESTIMATE"),
  })
  .strict();

export type WalkingGoal = z.infer<typeof walkingGoalSchema>;

export const recommendationResponseSchema = z
  .object({
    requestId: z.uuid(),
    generatedAt: z.iso.datetime({ offset: true }),
    departureAt: z.iso.datetime({ offset: true }),
    baseline: baselineSummarySchema,
    walkingGoal: walkingGoalSchema,
    primaryRecommendationId: z.string().min(1).max(200),
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
    if (
      !response.recommendations.some(
        (recommendation) =>
          recommendation.id === response.primaryRecommendationId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryRecommendationId"],
        message: "기본 추천 ID는 추천 목록에 포함돼야 합니다.",
      });
    }
  });

export type RecommendationResponse = z.infer<
  typeof recommendationResponseSchema
>;

export const plannerUiStateSchema = z.enum([
  "idle",
  "editing-place",
  "ready",
  "calculating",
  "results",
  "route-selected",
  "error",
]);

export type PlannerUiState = z.infer<typeof plannerUiStateSchema>;

export const experienceModeSchema = z.enum(["guided", "compact"]);
export type ExperienceMode = z.infer<typeof experienceModeSchema>;

export const uiEventPayloadSchema = z
  .object({
    version: z.literal("route-pulse-v1"),
    event: z.enum([
      "planner_viewed",
      "place_search_started",
      "place_selected",
      "recommendation_started",
      "recommendation_succeeded",
      "recommendation_failed",
      "route_selected",
      "route_details_opened",
      "experience_mode_changed",
    ]),
    uiState: plannerUiStateSchema,
    experienceMode: experienceModeSchema,
    outcome: z.enum(["success", "empty", "error", "cancelled"]).optional(),
    durationBucket: z
      .enum(["lt1s", "1to3s", "3to8s", "gt8s"])
      .optional(),
  })
  .strict();

export type UiEventPayload = z.infer<typeof uiEventPayloadSchema>;

export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    timestamp: z.iso.datetime({ offset: true }),
    database: z
      .object({
        connected: z.boolean(),
        postgis: z.boolean(),
        migrationsCurrent: z.boolean(),
      })
      .strict(),
    providers: z
      .object({
        kakao: z.boolean(),
        naver: z.boolean(),
        tago: z.boolean(),
      })
      .strict(),
    transit: z
      .object({
        stops: z.number().int().nonnegative(),
        linkedStops: z.number().int().nonnegative(),
        routes: z.number().int().nonnegative(),
        routeStops: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

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
  "SERVICE_NOT_READY",
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

export const storedPreferencesV2Schema = z
  .object({
    version: z.literal(2),
    dailyGoalSteps: z.number().int().min(1).max(100_000),
    walkingProfile: walkingProfileSchema,
    maxExtraMinutes: z.number().int().min(0).max(120),
    safetyBufferMinutes: z.number().int().min(0).max(15),
    lastOrigin: placeSchema.optional(),
    lastDestination: placeSchema.optional(),
  })
  .strict();

export type StoredPreferencesV2 = z.infer<
  typeof storedPreferencesV2Schema
>;

export const storedPreferencesV3Schema = z
  .object({
    version: z.literal(3),
    dailyGoalSteps: z.number().int().min(1).max(100_000),
    walkingProfile: walkingProfileSchema,
    currentSteps: z.number().int().min(0).max(100_000),
    currentStepsDate: z.iso.date(),
    lastOrigin: placeSchema.optional(),
    lastDestination: placeSchema.optional(),
  })
  .strict();

export type StoredPreferencesV3 = z.infer<
  typeof storedPreferencesV3Schema
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
