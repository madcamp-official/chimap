import { describe, expect, it } from "vitest";

import {
  coordinateSchema,
  estimatePersonalizedStepLengthMeters,
  haversineDistanceMeters,
  recommendationRequestSchema,
  routeLegSchema,
  storedPreferencesV1Schema,
  storedPreferencesV2Schema,
  storedPreferencesV3Schema,
  uiEventPayloadSchema,
} from "./index.js";

describe("공유 계약", () => {
  it("유효한 좌표를 허용하고 범위 밖 좌표를 거절한다", () => {
    expect(
      coordinateSchema.parse({ lng: 127.3604, lat: 36.3723 }),
    ).toEqual({ lng: 127.3604, lat: 36.3723 });
    expect(
      coordinateSchema.safeParse({ lng: 181, lat: 36.3723 }).success,
    ).toBe(false);
    expect(
      coordinateSchema.safeParse({ lng: 127, lat: Number.NaN }).success,
    ).toBe(false);
  });

  it("비도보 구간을 운동 구간으로 표시하지 못하게 한다", () => {
    const result = routeLegSchema.safeParse({
      id: "bus-1",
      mode: "BUS",
      name: "104",
      distanceMeters: 1000,
      durationSeconds: 600,
      coordinates: [],
      isExerciseSegment: true,
    });

    expect(result.success).toBe(false);
  });

  it("추천 입력의 걸음 수와 개인화 한 걸음 길이 경계를 검증한다", () => {
    const baseRequest = {
      origin: {
        id: "kaist",
        name: "KAIST",
        address: "",
        roadAddress: "",
        category: "교육",
        location: { lng: 127.3604, lat: 36.3723 },
      },
      destination: {
        id: "daejeon",
        name: "대전역",
        address: "",
        roadAddress: "",
        category: "교통",
        location: { lng: 127.4342, lat: 36.3321 },
      },
      currentSteps: 5200,
      goalSteps: 8000,
      walkingMetric: {
        stepLengthMeters: 0.69,
        source: "RESEARCH_ESTIMATE",
        modelVersion: "HAN_2026_V1",
      },
    };

    expect(recommendationRequestSchema.safeParse(baseRequest).success).toBe(
      true,
    );
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        walkingMetric: {
          ...baseRequest.walkingMetric,
          stepLengthMeters: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        unknownConstraint: 30,
      }).success,
    ).toBe(false);
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        deadline: "2026-07-24T18:00:00+09:00",
        maxExtraMinutes: 25,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(true);
  });

  it("연구식으로 필수 신체정보를 개인화 한 걸음 길이로 환산한다", () => {
    expect(
      estimatePersonalizedStepLengthMeters(
        {
          birthYear: 1976,
          heightCm: 170.73,
          weightKg: 72.92,
          biologicalSex: "FEMALE",
        },
        2026,
      ),
    ).toBeCloseTo(0.694, 3);
    expect(() =>
      estimatePersonalizedStepLengthMeters(
        {
          birthYear: 2010,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "MALE",
        },
        2026,
      ),
    ).toThrow(/18~90세/u);
  });

  it("v2 설정에서 생물학적 성별을 필수로 검증한다", () => {
    expect(
      storedPreferencesV2Schema.safeParse({
        version: 2,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
        },
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(false);
    expect(
      storedPreferencesV1Schema.safeParse({
        version: 2,
        dailyGoalSteps: 8000,
        strideLengthMeters: 0.7,
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(false);
  });

  it("v3 설정은 당일 현재 걸음과 프로필만 저장한다", () => {
    expect(
      storedPreferencesV3Schema.safeParse({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate: "2026-07-26",
      }).success,
    ).toBe(true);
    expect(
      storedPreferencesV3Schema.safeParse({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate: "2026-07-26",
        maxExtraMinutes: 20,
      }).success,
    ).toBe(false);
  });

  it("KAIST와 대전역의 거리가 50m보다 멀다", () => {
    expect(
      haversineDistanceMeters(
        { lng: 127.3604, lat: 36.3723 },
        { lng: 127.4342, lat: 36.3321 },
      ),
    ).toBeGreaterThan(50);
  });

  it("익명 UI 이벤트는 허용된 enum만 받고 위치·검색·식별 정보는 거절한다", () => {
    const event = {
      version: "route-pulse-v1",
      event: "recommendation_succeeded",
      uiState: "results",
      experienceMode: "guided",
      outcome: "success",
      durationBucket: "1to3s",
    };

    expect(uiEventPayloadSchema.safeParse(event).success).toBe(true);
    expect(
      uiEventPayloadSchema.safeParse({
        ...event,
        query: "대전역",
        coordinates: { lat: 36.3, lng: 127.4 },
        sessionId: "private-session",
      }).success,
    ).toBe(false);
  });
});
