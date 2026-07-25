import type {
  Place,
  Recommendation,
  RecommendationResponse,
} from "@chimap/contracts";

export const kaistPlace: Place = {
  id: "kaist",
  name: "한국과학기술원 KAIST",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "교육 > 대학교",
  location: { lng: 127.3604, lat: 36.3723 },
};

export const daejeonStationPlace: Place = {
  id: "daejeon-station",
  name: "대전역",
  address: "대전 동구 정동 1-1",
  roadAddress: "대전 동구 중앙로 215",
  category: "교통 > 기차역",
  location: { lng: 127.4342, lat: 36.3321 },
};

function recommendation(
  type: "FAST" | "BALANCED" | "GOAL",
  index: number,
): Recommendation {
  const meta = {
    FAST: {
      title: "빠른 경로",
      reason: "마감시간을 지키면서 가장 빠르게 도착해요.",
    },
    BALANCED: {
      title: "균형 경로",
      reason: "추가시간과 부족한 걸음을 균형 있게 맞췄어요.",
    },
    GOAL: {
      title: "목표 달성 경로",
      reason: "남은 걸음 수에 가장 가까운 경로예요.",
    },
  }[type];
  const walkDistance = 500 + index * 600;
  const estimatedSteps = Math.round(walkDistance / 0.7);
  return {
    id: `route-${type.toLocaleLowerCase()}`,
    type,
    title: meta.title,
    reason: meta.reason,
    durationSeconds: 2400 + index * 360,
    arrivalAt: new Date(
      Date.UTC(2026, 6, 24, 8, 40 + index * 6),
    ).toISOString(),
    extraMinutes: index * 6,
    walkDistanceMeters: walkDistance,
    estimatedSteps,
    expectedTotalSteps: 5200 + estimatedSteps,
    dailyGoalCompletionRate: Math.min((5200 + estimatedSteps) / 8000, 1),
    shortfallCoverageRate: Math.min(estimatedSteps / 2800, 1),
    transferCount: index === 1 ? 0 : 1,
    fareWon: 1550,
    legs: [
      {
        id: `${type}-walk`,
        mode: "WALK",
        guidance: "정류장까지 걸어서 이동",
        distanceMeters: 300,
        durationSeconds: 240,
        coordinates: [
          { lng: 127.3604, lat: 36.3723 },
          { lng: 127.37 + index * 0.001, lat: 36.365 },
        ],
        isExerciseSegment: false,
      },
      {
        id: `${type}-transit`,
        mode: index === 2 ? "SUBWAY" : "BUS",
        name: index === 2 ? "대전 1호선" : "104",
        guidance: "대중교통으로 이동",
        distanceMeters: 6000,
        durationSeconds: 1600,
        stops: ["출발 정류장", "도착 정류장"],
        coordinates: [
          { lng: 127.37 + index * 0.001, lat: 36.365 },
          { lng: 127.42, lat: 36.335 + index * 0.001 },
        ],
        isExerciseSegment: false,
      },
      {
        id: `${type}-exercise`,
        mode: "WALK",
        guidance: "목적지까지 건강하게 걸어요",
        distanceMeters: Math.max(200, walkDistance - 300),
        durationSeconds: 600 + index * 240,
        coordinates: [
          { lng: 127.42, lat: 36.335 + index * 0.001 },
          { lng: 127.4342, lat: 36.3321 },
        ],
        isExerciseSegment: index > 0,
      },
    ],
  };
}

export function recommendationFixture(
  count: 1 | 2 | 3 = 3,
): RecommendationResponse {
  const recommendations = [
    recommendation("FAST", 0),
    recommendation("BALANCED", 1),
    recommendation("GOAL", 2),
  ].slice(0, count);
  return {
    requestId: "11111111-1111-4111-8111-111111111111",
    mode: "mock",
    generatedAt: "2026-07-24T08:00:01.000Z",
    departureAt: "2026-07-24T08:00:00.000Z",
    baseline: {
      durationSeconds: 2400,
      arrivalAt: "2026-07-24T08:40:00.000Z",
      walkDistanceMeters: 430,
      estimatedSteps: 614,
    },
    recommendations,
    warnings: [
      {
        code: "ESTIMATED_STEPS",
        message: "걸음 수와 도착시간은 예상값입니다.",
      },
      {
        code: "DEMO_DATA",
        message: "카카오 REST API 키를 연결하면 실제 장소와 경로를 조회합니다.",
      },
      ...(count < 3
        ? [
            {
              code: "LIMITED_ROUTE_VARIETY" as const,
              message: `충분히 다른 경로가 ${count}개뿐이에요.`,
            },
          ]
        : []),
    ],
  };
}
