import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseTagoResponsePage } from "./tago-client.js";

const source = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/tago-responses-20260725.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  provider: string;
  capturedAt: string;
  documentationCheckedAt: string;
  captures: Array<{
    api: string;
    request: string;
    checksum: string;
    response: unknown;
  }>;
};

describe("실제 TAGO 응답 parser", () => {
  it("출처와 checksum을 검증하고 단일 item을 배열로 정규화한다", () => {
    expect(source.provider).toBe("TAGO");
    expect(Date.parse(source.capturedAt)).not.toBeNaN();
    expect(source.documentationCheckedAt).toBe("2026-07-25");
    for (const item of source.captures) {
      expect(
        createHash("sha256")
          .update(JSON.stringify(item.response))
          .digest("hex"),
      ).toBe(item.checksum);
    }
    const capture = source.captures[0]!;
    expect(capture.request).toContain("nodeid=DJB9002737");

    const page = parseTagoResponsePage(capture.response, {
      service: "stop",
      operation: "getSttnThrghRouteList",
    });
    expect(page.resultCode).toBe("00");
    expect(page.totalCount).toBe(1);
    expect(page.items).toEqual([
      {
        endnodenm: "충대농대종점",
        routeid: "DJB30300043",
        routeno: 108,
        routetp: "간선버스",
        startnodenm: "낭월공영차고지기점",
      },
    ]);
  });

  it("실제 108번 노선 정류장 배열과 순서를 읽는다", () => {
    const capture = source.captures.find((item) =>
      item.api.includes("getRouteAcctoThrghSttnList"),
    );
    expect(capture).toBeDefined();
    const page = parseTagoResponsePage(capture?.response, {
      service: "route",
      operation: "getRouteAcctoThrghSttnList",
    });
    expect(page.totalCount).toBe(89);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.nodeord)).toEqual([1, 2]);
    expect(page.items.map((item) => item.nodeid)).toEqual([
      "DJB8003109",
      "DJB9005538",
    ]);
  });
});
