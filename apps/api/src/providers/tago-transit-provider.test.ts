import { describe, expect, it } from "vitest";

import { routeSearchRadii } from "./tago-transit-provider.js";

describe("TAGO 승하차 정류장 확장 탐색", () => {
  it("500m, 800m, 1.2km 순서로 중복 없이 확장한다", () => {
    expect(routeSearchRadii(500, 1200)).toEqual([500, 800, 1200]);
  });

  it("설정된 상한을 넘는 중간 단계를 만들지 않는다", () => {
    expect(routeSearchRadii(500, 700)).toEqual([500, 700]);
  });
});
