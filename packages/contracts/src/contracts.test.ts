import { describe, expect, it } from "vitest";

import {
  coordinateSchema,
  haversineDistanceMeters,
  recommendationRequestSchema,
  routeLegSchema,
  storedPreferencesV1Schema,
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

  it("추천 입력의 걸음 수와 보폭 경계를 검증한다", () => {
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
      deadline: "2026-07-24T18:00:00+09:00",
      currentSteps: 5200,
      goalSteps: 8000,
      maxExtraMinutes: 25,
      strideLengthMeters: 0.7,
      safetyBufferMinutes: 3,
    };

    expect(recommendationRequestSchema.safeParse(baseRequest).success).toBe(
      true,
    );
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        strideLengthMeters: 0,
      }).success,
    ).toBe(false);
  });

  it("알 수 없는 localStorage 버전과 손상된 값을 거절한다", () => {
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

  it("KAIST와 대전역의 거리가 50m보다 멀다", () => {
    expect(
      haversineDistanceMeters(
        { lng: 127.3604, lat: 36.3723 },
        { lng: 127.4342, lat: 36.3321 },
      ),
    ).toBeGreaterThan(50);
  });
});
