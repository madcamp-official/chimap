import {
  chimapColors,
  chimapCssVariables,
  routeColors,
  statusColors,
} from "@chimap/design-tokens";
import { describe, expect, it } from "vitest";

describe("shared CHIMap design tokens", () => {
  it("웹 CSS 변수와 semantic token 값을 일치시킨다", () => {
    expect(chimapCssVariables["--navy"]).toBe(chimapColors.navy);
    expect(chimapCssVariables["--teal"]).toBe(chimapColors.teal);
    expect(chimapCssVariables["--bus-blue"]).toBe(routeColors.bus);
    expect(chimapCssVariables["--purple"]).toBe(routeColors.subway);
    expect(chimapCssVariables["--status-realtime-text"]).toBe(statusColors.realtimeText);
    expect(statusColors.dangerSurface).not.toBe(statusColors.warningSurface);
  });
});
