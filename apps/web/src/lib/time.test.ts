import { describe, expect, it } from "vitest";

import {
  formatKstTime,
  kstDateTimeLocalToIso,
  toKstDateTimeLocal,
} from "./time.js";

describe("KST 시간 처리", () => {
  it("UTC 시각을 Asia/Seoul 입력/표시 형식으로 변환한다", () => {
    const date = new Date("2026-07-24T08:00:00.000Z");
    expect(toKstDateTimeLocal(date)).toBe("2026-07-24T17:00");
    expect(formatKstTime(date)).toBe("17:00");
  });

  it("KST datetime-local 값을 ISO UTC로 변환한다", () => {
    expect(kstDateTimeLocalToIso("2026-07-24T18:00")).toBe(
      "2026-07-24T09:00:00.000Z",
    );
  });
});
