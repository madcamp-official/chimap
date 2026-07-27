import type { NormalizedRoute } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { rebuildRoute } from "./candidate-generator.js";

describe("대중교통 목표 걸음 경로 재구성", () => {
  it("시간표 기반 지하철의 비실시간 상태와 시간 합계를 보존한다", () => {
    const base: NormalizedRoute = {
      id: "mixed-base",
      source: "TAGO",
      durationSeconds: 600,
      distanceMeters: 1_500,
      walkDistanceMeters: 0,
      transitDistanceMeters: 1_500,
      transferCount: 1,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
      isRealtime: false,
      estimationNotes: ["TAGO 시간표 기반 예상"],
      legs: [
        {
          id: "subway",
          mode: "SUBWAY",
          name: "대전 1호선",
          distanceMeters: 1_000,
          durationSeconds: 400,
          coordinates: [
            { lat: 36.35, lng: 127.38 },
            { lat: 36.33, lng: 127.42 },
          ],
          isExerciseSegment: false,
        },
        {
          id: "bus",
          mode: "BUS",
          name: "501",
          distanceMeters: 500,
          durationSeconds: 200,
          coordinates: [
            { lat: 36.33, lng: 127.42 },
            { lat: 36.33, lng: 127.43 },
          ],
          isExerciseSegment: false,
        },
      ],
    };

    const rebuilt = rebuildRoute(
      base,
      base.legs,
      "mixed-adjusted",
      "EARLY_ALIGHT",
    );

    expect(rebuilt).toMatchObject({
      isRealtime: false,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
    });
  });
});
