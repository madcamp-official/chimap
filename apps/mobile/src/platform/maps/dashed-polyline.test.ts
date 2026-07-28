import { describe, expect, it } from "vitest";

import { dashedPolylineSegments } from "./dashed-polyline";

describe("native approximate route dashes", () => {
  it("splits a long line into visible dash segments", () => {
    const segments = dashedPolylineSegments([
      { lat: 36.35, lng: 127.37 },
      { lat: 36.351, lng: 127.37 },
    ]);

    expect(segments.length).toBeGreaterThan(3);
    expect(segments.every((segment) => segment.length >= 2)).toBe(true);
    expect(segments[0]?.[0]).toEqual({ lat: 36.35, lng: 127.37 });
  });

  it("does not invent a line with fewer than two coordinates", () => {
    expect(dashedPolylineSegments([{ lat: 36.35, lng: 127.37 }])).toEqual([]);
  });
});
