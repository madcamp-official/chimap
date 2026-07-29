import { describe, expect, it } from "vitest";

import {
  androidKeyboardAvoidanceInset,
  clampPlannerSheetPosition,
  nearestPlannerSheetSnap,
  plannerSheetOffsets,
} from "./planner-sheet-snap";

describe("planner bottom sheet snap", () => {
  const offsets = plannerSheetOffsets(720, 34);

  it("Home Indicator 위에 최소화 높이를 남기고 세 단계 위치를 만든다", () => {
    expect(offsets).toEqual({ expanded: 0, middle: 310, collapsed: 614 });
  });

  it("큰 글자에서는 최소화된 요약 영역도 잘리지 않게 높이를 늘린다", () => {
    expect(plannerSheetOffsets(720, 34, 112)).toEqual({
      expanded: 0,
      middle: 310,
      collapsed: 574,
    });
  });

  it("놓은 위치와 진행 속도에 가장 가까운 단계로 자석처럼 붙는다", () => {
    expect(nearestPlannerSheetSnap(offsets, 300, 0)).toBe("middle");
    expect(nearestPlannerSheetSnap(offsets, 520, -1.4)).toBe("middle");
    expect(nearestPlannerSheetSnap(offsets, 400, 1.4)).toBe("collapsed");
  });

  it("드래그가 펼침과 최소화 범위를 벗어나지 않는다", () => {
    expect(clampPlannerSheetPosition(offsets, -80)).toBe(0);
    expect(clampPlannerSheetPosition(offsets, 800)).toBe(614);
  });

  it("Android 키보드가 창을 덮을 때 상태 표시줄과 여유 공간을 포함한다", () => {
    expect(androidKeyboardAvoidanceInset(707, 418, 24)).toBe(329);
    expect(androidKeyboardAvoidanceInset(418, 418, 24)).toBe(0);
    expect(androidKeyboardAvoidanceInset(707, 418, -1)).toBe(305);
  });
});
