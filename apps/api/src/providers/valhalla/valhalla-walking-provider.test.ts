import type { Coordinate } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import type { ProviderError } from "../../errors.js";
import type { ValhallaRouteResult } from "./valhalla-client.js";
import { ValhallaClient } from "./valhalla-client.js";
import { ValhallaWalkingProvider } from "./valhalla-walking-provider.js";

function clientWith(result: ValhallaRouteResult): ValhallaClient {
  return {
    route: vi.fn(async () => result),
  } as unknown as ValhallaClient;
}

function routeResult(
  coordinates: Coordinate[],
  legCoordinates: Coordinate[][],
): ValhallaRouteResult {
  return {
    coordinates,
    legCoordinates,
    distanceMeters: 3_100,
    durationSeconds: 2_200,
  };
}

describe("ValhallaWalkingProvider", () => {
  it("via가 있으면 각 요청 구간의 직선거리 합으로 detour를 검증한다", async () => {
    const origin = { lat: 36.35, lng: 127.38 };
    const via = { lat: 36.36, lng: 127.39 };
    const destination = { lat: 36.35, lng: 127.381 };
    const provider = new ValhallaWalkingProvider(
      clientWith(routeResult(
        [origin, via, destination],
        [[origin, via], [via, destination]],
      )),
      { maxSnapDistanceMeters: 100, maxDetourRatio: 1.1 },
    );

    const route = await provider.getWalkingRoute({
      origin,
      vias: [via],
      destination,
    });
    expect(route).toMatchObject({
      source: "VALHALLA",
      distanceMeters: 3_100,
      walkDistanceMeters: 3_100,
    });
    expect(route.legs[0]).toMatchObject({
      mode: "WALK",
      geometryQuality: "DETAILED",
    });
  });

  it("via를 고려해도 geometry 우회율이 크면 거절한다", async () => {
    const origin = { lat: 36.35, lng: 127.38 };
    const via = { lat: 36.3505, lng: 127.3805 };
    const destination = { lat: 36.351, lng: 127.381 };
    const far = { lat: 36.37, lng: 127.4 };
    const provider = new ValhallaWalkingProvider(
      clientWith(routeResult(
        [origin, far, via, far, destination],
        [[origin, far, via], [via, far, destination]],
      )),
      { maxSnapDistanceMeters: 100, maxDetourRatio: 2 },
    );

    await expect(provider.getWalkingRoute({
      origin,
      vias: [via],
      destination,
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "NO_ROUTE" });
  });

  it("origin, via, destination 중 하나라도 snap 허용치를 넘으면 거절한다", async () => {
    const origin = { lat: 36.35, lng: 127.38 };
    const via = { lat: 36.351, lng: 127.381 };
    const destination = { lat: 36.352, lng: 127.382 };
    const wrongVia = { lat: 36.36, lng: 127.39 };
    const provider = new ValhallaWalkingProvider(
      clientWith(routeResult(
        [origin, via, wrongVia, destination],
        [[origin, via], [wrongVia, destination]],
      )),
      { maxSnapDistanceMeters: 100, maxDetourRatio: 20 },
    );

    await expect(provider.getWalkingRoute({
      origin,
      vias: [via],
      destination,
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "NO_ROUTE" });
  });

  it("보고 거리와 decoded geometry 거리가 크게 다르면 거절한다", async () => {
    const origin = { lat: 36.35, lng: 127.38 };
    const destination = { lat: 36.36, lng: 127.39 };
    const inconsistent = routeResult(
      [origin, destination],
      [[origin, destination]],
    );
    inconsistent.distanceMeters = 100_000;
    const provider = new ValhallaWalkingProvider(
      clientWith(inconsistent),
      { maxSnapDistanceMeters: 100, maxDetourRatio: 20 },
    );

    await expect(provider.getWalkingRoute({
      origin,
      destination,
    })).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "UPSTREAM",
      retryable: true,
    });
  });
});
