import type { NormalizedRoute, Place } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "../services/cache.js";
import { CachedMobilityProvider } from "./cached-provider.js";
import type { MobilityProvider } from "./types.js";

const origin: Place = {
  id: "origin",
  name: "출발",
  address: "",
  roadAddress: "",
  category: "",
  location: { lat: 36.35, lng: 127.38 },
};
const destination: Place = {
  ...origin,
  id: "destination",
  name: "도착",
  location: { lat: 36.34, lng: 127.4 },
};

function route(id: string): NormalizedRoute {
  return {
    id,
    source: "TAGO",
    durationSeconds: 60,
    distanceMeters: 900,
    walkDistanceMeters: 0,
    transitDistanceMeters: 900,
    transferCount: 0,
    legs: [],
  };
}

describe("대중교통 geometry profile cache", () => {
  it("기존 직선과 track-v1 응답을 서로 다른 namespace에 저장한다", async () => {
    const getTransitRoutes = vi
      .fn()
      .mockResolvedValueOnce([route("legacy")])
      .mockResolvedValueOnce([route("track")]);
    const provider = {
      source: "TAGO",
      getTransitRoutes,
    } as unknown as MobilityProvider;
    const cached = new CachedMobilityProvider(provider, new MemoryCache());

    const legacy = await cached.getTransitRoutes({ origin, destination });
    const track = await cached.getTransitRoutes({
      origin,
      destination,
      geometryProfile: "TRACK_V1",
    });
    const legacyAgain = await cached.getTransitRoutes({ origin, destination });
    const trackAgain = await cached.getTransitRoutes({
      origin,
      destination,
      geometryProfile: "TRACK_V1",
    });

    expect(legacy[0]?.id).toBe("legacy");
    expect(track[0]?.id).toBe("track");
    expect(legacyAgain).toBe(legacy);
    expect(trackAgain).toBe(track);
    expect(getTransitRoutes).toHaveBeenCalledTimes(2);
  });
});
