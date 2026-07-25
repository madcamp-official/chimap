import { describe, expect, it } from "vitest";

import { mapProviderError, ProviderError } from "./errors.js";

describe("대중교통 경로 오류 안내", () => {
  it("운행 정류장이 없으면 위치를 구체화하는 방법을 안내한다", () => {
    const error = mapProviderError(
      new ProviderError({
        kind: "NO_NEARBY_TRANSIT_STOP",
        message: "운행 정류장 없음",
      }),
    );

    expect(error.code).toBe("NO_TRANSIT_ROUTE");
    expect(error.status).toBe(404);
    expect(error.message).toContain("운행 노선이 있는 버스 정류장");
    expect(error.message).toContain("정문이나 도로명 주소");
  });

  it("운행 정류장은 있지만 연결이 없으면 환승 탐색 범위를 알린다", () => {
    const error = mapProviderError(
      new ProviderError({
        kind: "NO_TRANSIT_CONNECTION",
        message: "연결 없음",
      }),
    );

    expect(error.code).toBe("NO_TRANSIT_ROUTE");
    expect(error.status).toBe(404);
    expect(error.message).toContain("직행 또는 1회 환승");
  });
});
