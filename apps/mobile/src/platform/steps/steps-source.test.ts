import { describe, expect, it, vi } from "vitest";

const healthConnect = vi.hoisted(() => ({
  getSdkStatus: vi.fn(async () => 1),
  initialize: vi.fn(async () => true),
  getGrantedPermissions: vi.fn(async () => [
    { accessType: "read", recordType: "Steps" },
  ]),
  requestPermission: vi.fn(async () => []),
  readRecords: vi.fn(async () => ({ records: [] })),
}));

vi.mock("react-native-health-connect", () => ({
  ...healthConnect,
  SdkAvailabilityStatus: { SDK_AVAILABLE: 1 },
}));

import { sumStepRecords } from "./steps-contract";
import { HealthConnectStepsSource } from "./steps-source.android";

describe("sumStepRecords", () => {
  it("returns zero when Health Connect is installed but has no records", () => {
    expect(sumStepRecords([])).toBe(0);
    expect(sumStepRecords(undefined)).toBe(0);
  });

  it("returns zero through the Android adapter when permission exists but records are empty", async () => {
    const source = new HealthConnectStepsSource();

    await expect(source.readTodaySteps(new Date("2026-07-26T12:00:00+09:00"))).resolves.toBe(
      0,
    );
    expect(healthConnect.readRecords).toHaveBeenCalledWith(
      "Steps",
      expect.objectContaining({ timeRangeFilter: expect.any(Object) }),
    );
  });

  it("sums valid records without turning malformed records into an error", () => {
    expect(sumStepRecords([{ count: 120 }, {}, { count: 80 }])).toBe(200);
  });
});
