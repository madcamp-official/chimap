import { describe, expect, it, vi } from "vitest";
import { ValhallaClient } from "./valhalla-client.js";

describe("ValhallaClient", () => {
  it("pedestrian 요청에서 via 순서와 summary 거리/시간을 보존한다", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.costing).toBe("pedestrian");
      expect(body.locations).toEqual([
        { lat: 0.000001, lon: 0.000001 },
        { lat: 0.000002, lon: 0.000002 },
        { lat: 0.000003, lon: 0.000003 },
      ]);
      return new Response(JSON.stringify({
        trip: {
          summary: { length: 1.234, time: 456 },
          legs: [{ shape: "AAACAC" }],
        },
      }));
    });
    const result = await new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1000,
      retryCount: 0,
      fetch: fetchMock as typeof fetch,
    }).route({
      origin: { lat: 0.000001, lng: 0.000001 },
      vias: [{ lat: 0.000002, lng: 0.000002 }],
      destination: { lat: 0.000003, lng: 0.000003 },
    });
    expect(result).toMatchObject({ distanceMeters: 1234, durationSeconds: 456 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("4xx는 retry하지 않고 5xx만 제한적으로 retry한다", async () => {
    const four = vi.fn(async () => new Response("", { status: 400 }));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal", timeoutMs: 1000, retryCount: 2,
      fetch: four as typeof fetch,
    }).route({ origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 } }))
      .rejects.toMatchObject({ kind: "NO_ROUTE" });
    expect(four).toHaveBeenCalledTimes(1);

    const five = vi.fn(async () => new Response("", { status: 503 }));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal", timeoutMs: 1000, retryCount: 1,
      fetch: five as typeof fetch,
    }).route({ origin: { lat: 1, lng: 1 }, destination: { lat: 2, lng: 2 } }))
      .rejects.toMatchObject({ kind: "UPSTREAM" });
    expect(five).toHaveBeenCalledTimes(2);
  });
});
