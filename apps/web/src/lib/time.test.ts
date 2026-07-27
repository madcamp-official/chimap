import { describe, expect, it } from "vitest";

import {
  formatKstTime,
  kstDateKey,
  kstDateTimeLocalToIso,
  millisecondsUntilNextKstDay,
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

  it("한국 날짜 키와 다음 자정까지 남은 시간을 계산한다", () => {
    const date = new Date("2026-07-24T14:59:00.000Z");
    expect(kstDateKey(date)).toBe("2026-07-24");
    expect(millisecondsUntilNextKstDay(date)).toBe(60_000);
  });
});
