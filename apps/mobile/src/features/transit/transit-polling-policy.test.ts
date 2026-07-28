import { describe, expect, it } from "vitest";

import { shouldPollRouteVehicles } from "./transit-polling-policy";

describe("vehicle polling policy", () => {
  it("활성 앱의 버스 경로에서만 polling한다", () => {
    expect(shouldPollRouteVehicles({ appActive: true, hasBusLeg: true })).toBe(true);
    expect(shouldPollRouteVehicles({ appActive: false, hasBusLeg: true })).toBe(false);
    expect(shouldPollRouteVehicles({ appActive: true, hasBusLeg: false })).toBe(false);
    expect(shouldPollRouteVehicles({ appActive: false, hasBusLeg: false })).toBe(false);
  });
});
