import { describe, expect, it } from "vitest";

import { sumStepRecords } from "./steps-contract";

describe("sumStepRecords", () => {
  it("returns zero when Health Connect is installed but has no records", () => {
    expect(sumStepRecords([])).toBe(0);
    expect(sumStepRecords(undefined)).toBe(0);
  });

  it("sums valid records without turning malformed records into an error", () => {
    expect(sumStepRecords([{ count: 120 }, {}, { count: 80 }])).toBe(200);
  });
});
