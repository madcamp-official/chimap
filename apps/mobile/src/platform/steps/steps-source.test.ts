import { beforeEach, describe, expect, it, vi } from "vitest";

const healthConnect = vi.hoisted(() => ({
  aggregateRecord: vi.fn(
    async (): Promise<{ COUNT_TOTAL: number; dataOrigins: string[] }> => ({
      COUNT_TOTAL: 0,
      dataOrigins: [],
    }),
  ),
  getSdkStatus: vi.fn(async () => 3),
  initialize: vi.fn(async () => true),
  getGrantedPermissions: vi.fn(async () => [
    { accessType: "read", recordType: "Steps" },
  ]),
  openHealthConnectSettings: vi.fn(),
  requestPermission: vi.fn(async () => [
    { accessType: "read", recordType: "Steps" },
  ]),
}));

vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn(async () => undefined) },
}));

vi.mock("react-native-health-connect", () => ({
  ...healthConnect,
  SdkAvailabilityStatus: {
    SDK_UNAVAILABLE: 1,
    SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
    SDK_AVAILABLE: 3,
  },
}));

import {
  normalizeAggregatedSteps,
  startOfLocalDay,
} from "./steps-contract";
import { HealthConnectStepsSource } from "./steps-source.android";

describe("Health Connect steps source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    healthConnect.getSdkStatus.mockResolvedValue(3);
    healthConnect.initialize.mockResolvedValue(true);
    healthConnect.getGrantedPermissions.mockResolvedValue([
      { accessType: "read", recordType: "Steps" },
    ]);
    healthConnect.requestPermission.mockResolvedValue([
      { accessType: "read", recordType: "Steps" },
    ]);
    healthConnect.aggregateRecord.mockResolvedValue({
      COUNT_TOTAL: 0,
      dataOrigins: [],
    });
  });

  it("uses aggregateRecord from local midnight through now", async () => {
    const source = new HealthConnectStepsSource();
    const now = new Date(2026, 6, 26, 12, 34, 56);
    healthConnect.aggregateRecord.mockResolvedValue({
      COUNT_TOTAL: 12_345.4,
      dataOrigins: ["com.sec.android.app.shealth", "another.origin"],
    });

    await expect(source.readTodaySteps({ now })).resolves.toBe(12_345);
    expect(healthConnect.aggregateRecord).toHaveBeenCalledWith({
      recordType: "Steps",
      timeRangeFilter: {
        operator: "between",
        startTime: startOfLocalDay(now).toISOString(),
        endTime: now.toISOString(),
      },
    });
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -10])(
    "normalizes a missing or invalid COUNT_TOTAL (%s) to zero",
    (value) => {
      expect(normalizeAggregatedSteps(value)).toBe(0);
    },
  );

  it("does not open a permission dialog during automatic reads", async () => {
    const source = new HealthConnectStepsSource();
    healthConnect.getGrantedPermissions.mockResolvedValue([]);

    await expect(
      source.readTodaySteps({ requestPermission: false }),
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      recoveryAction: "OPEN_SETTINGS",
    });
    expect(healthConnect.requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission only for an explicit user refresh", async () => {
    const source = new HealthConnectStepsSource();
    healthConnect.getGrantedPermissions.mockResolvedValue([]);

    await expect(
      source.readTodaySteps({ requestPermission: true }),
    ).resolves.toBe(0);
    expect(healthConnect.requestPermission).toHaveBeenCalledWith([
      { accessType: "read", recordType: "Steps" },
    ]);
  });

  it("distinguishes a provider update from an unavailable provider", async () => {
    const source = new HealthConnectStepsSource();
    healthConnect.getSdkStatus.mockResolvedValue(2);

    await expect(source.readTodaySteps()).rejects.toMatchObject({
      code: "PROVIDER_UPDATE_REQUIRED",
      recoveryAction: "OPEN_PROVIDER_UPDATE",
    });
  });
});
