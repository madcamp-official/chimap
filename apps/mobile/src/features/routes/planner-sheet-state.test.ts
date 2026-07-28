import { describe, expect, it } from "vitest";

import { plannerSheetTransition } from "./planner-sheet-state";

describe("planner sheet state", () => {
  it("신규 진입은 입력이 보이는 middle에서 시작한다", () => {
    expect(plannerSheetTransition("collapsed", { type: "NEW_ENTRY" })).toBe("middle");
  });

  it("검색·계산·오류·결과 상태는 expanded를 유지한다", () => {
    for (const type of ["SEARCH_FOCUS", "CALCULATING", "ERROR", "RESULT"] as const) {
      expect(plannerSheetTransition("middle", { type })).toBe("expanded");
    }
  });

  it("카드 선택과 동일 날짜 결과 복원 규칙을 분리한다", () => {
    expect(plannerSheetTransition("expanded", { type: "SELECT_ROUTE" })).toBe("collapsed");
    expect(plannerSheetTransition("expanded", { type: "RESTORE", hasSelectedRoute: true })).toBe("collapsed");
    expect(plannerSheetTransition("collapsed", { type: "RESTORE", hasSelectedRoute: false })).toBe("middle");
  });

  it("상단 탭은 collapsed와 middle 사이에서만 전환한다", () => {
    expect(plannerSheetTransition("collapsed", { type: "TOGGLE" })).toBe("middle");
    expect(plannerSheetTransition("middle", { type: "TOGGLE" })).toBe("collapsed");
    expect(plannerSheetTransition("expanded", { type: "TOGGLE" })).toBe("collapsed");
  });
});
