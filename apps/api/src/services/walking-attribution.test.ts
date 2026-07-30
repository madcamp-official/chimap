import type { RouteLeg, WalkingRole } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { hasExactInsertedWalkingAttribution } from "./walking-attribution.js";

function walk(
  id: string,
  distanceMeters: number,
  walkingRole: WalkingRole,
  isExerciseSegment: boolean,
): RouteLeg {
  return {
    id,
    mode: "WALK",
    distanceMeters,
    durationSeconds: distanceMeters,
    coordinates: [
      { lng: 127.3, lat: 36.3 },
      { lng: 127.31, lat: 36.31 },
    ],
    geometryQuality: "DETAILED",
    walkingRole,
    isExerciseSegment,
  };
}

describe("운동 도보 거리 귀속", () => {
  const parentAccess = walk("parent-access", 700, "ACCESS", false);
  const insertedExercise = walk(
    "early-alighting-exercise",
    25,
    "GOAL_EARLY_ALIGHTING",
    true,
  );

  it("동일 부모 경로에 삽입한 운동 도보만큼만 늘어난 후보를 허용한다", () => {
    expect(hasExactInsertedWalkingAttribution({
      parentLegs: [parentAccess],
      childLegs: [parentAccess, insertedExercise],
      insertedLegs: [insertedExercise],
    })).toBe(true);
  });

  it("일반 ACCESS 증가분을 삽입한 운동 도보에 귀속하지 않는다", () => {
    const inflatedAccess = walk("inflated-access", 1_880, "ACCESS", false);

    expect(hasExactInsertedWalkingAttribution({
      parentLegs: [parentAccess],
      childLegs: [inflatedAccess, insertedExercise],
      insertedLegs: [insertedExercise],
    })).toBe(false);
  });
});
