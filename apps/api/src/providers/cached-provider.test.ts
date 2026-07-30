import type { NormalizedRoute, Place } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "../services/cache.js";
import {
  CachedMobilityProvider,
  CachedWalkingProvider,
} from "./cached-provider.js";
import type { MobilityProvider, WalkingRouteProvider } from "./types.js";

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

  it("첫 waiter 취소가 공유 cache fill과 다른 waiter를 취소하지 않는다", async () => {
    let resolveLoad: ((routes: NormalizedRoute[]) => void) | undefined;
    const getTransitRoutes = vi.fn(
      () => new Promise<NormalizedRoute[]>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const provider = {
      source: "TAGO",
      getTransitRoutes,
    } as unknown as MobilityProvider;
    const cached = new CachedMobilityProvider(provider, new MemoryCache());
    const firstController = new AbortController();

    const first = cached.getTransitRoutes({
      origin,
      destination,
      signal: firstController.signal,
    });
    const second = cached.getTransitRoutes({ origin, destination });
    firstController.abort();
    resolveLoad?.([route("shared")]);

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual([route("shared")]);
    await expect(
      cached.getTransitRoutes({ origin, destination }),
    ).resolves.toEqual([route("shared")]);
    expect(getTransitRoutes).toHaveBeenCalledOnce();
  });

  it("동일한 도보 geometry 요청은 in-flight 결과와 성공 캐시를 공유한다", async () => {
    let resolveLoad: ((walkingRoute: NormalizedRoute) => void) | undefined;
    const getWalkingRoute = vi.fn(
      () => new Promise<NormalizedRoute>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const provider = {
      source: "TAGO",
      getWalkingRoute,
    } as unknown as MobilityProvider;
    const cached = new CachedMobilityProvider(provider, new MemoryCache());
    const cacheStates: Array<"FRESH" | "SHARED" | "MISS"> = [];

    const first = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      routeMode: "BROAD_FIRST",
      observeCacheState: (state) => cacheStates.push(state),
    });
    const second = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      routeMode: "BROAD_FIRST",
      observeCacheState: (state) => cacheStates.push(state),
    });
    resolveLoad?.(route("shared-walk"));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const cachedResult = await cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      routeMode: "BROAD_FIRST",
      observeCacheState: (state) => cacheStates.push(state),
    });

    expect(firstResult).toBe(secondResult);
    expect(cachedResult).toBe(firstResult);
    expect(getWalkingRoute).toHaveBeenCalledOnce();
    expect(cacheStates).toEqual(["MISS", "SHARED", "FRESH"]);
  });

  it("첫 도보 waiter 취소가 공유 cache fill과 다른 waiter를 취소하지 않는다", async () => {
    let resolveLoad: ((walkingRoute: NormalizedRoute) => void) | undefined;
    const getWalkingRoute = vi.fn(
      () => new Promise<NormalizedRoute>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const provider = {
      source: "TAGO",
      getWalkingRoute,
    } as unknown as MobilityProvider;
    const cached = new CachedMobilityProvider(provider, new MemoryCache());
    const firstController = new AbortController();

    const first = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      routeMode: "BROAD_FIRST",
      signal: firstController.signal,
    });
    const second = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      routeMode: "BROAD_FIRST",
    });
    firstController.abort();
    resolveLoad?.(route("shared-walk"));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toEqual(route("shared-walk"));
    await expect(
      cached.getWalkingRoute({
        origin: origin.location,
        destination: destination.location,
        routeMode: "BROAD_FIRST",
      }),
    ).resolves.toEqual(route("shared-walk"));
    expect(getWalkingRoute).toHaveBeenCalledOnce();
  });

  it("별도 Valhalla walking cache도 waiter 취소와 cache 상태를 격리한다", async () => {
    let resolveLoad: ((walkingRoute: NormalizedRoute) => void) | undefined;
    const getWalkingRoute = vi.fn(
      () => new Promise<NormalizedRoute>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const provider: WalkingRouteProvider = {
      source: "VALHALLA",
      getWalkingRoute,
    };
    const cached = new CachedWalkingProvider(
      provider,
      30 * 60 * 1_000,
      new MemoryCache(),
    );
    const firstController = new AbortController();
    const states: Array<"FRESH" | "SHARED" | "MISS"> = [];

    const first = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      signal: firstController.signal,
      observeCacheState: (state) => states.push(state),
    });
    const second = cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      observeCacheState: (state) => states.push(state),
    });
    firstController.abort();
    resolveLoad?.({ ...route("valhalla-shared"), source: "VALHALLA" });

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({
      id: "valhalla-shared",
      source: "VALHALLA",
    });
    await cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      observeCacheState: (state) => states.push(state),
    });
    expect(getWalkingRoute).toHaveBeenCalledOnce();
    expect(states).toEqual(["MISS", "SHARED", "FRESH"]);
  });

  it("이미 취소된 Valhalla waiter는 cache load를 시작하지 않는다", async () => {
    const getWalkingRoute = vi.fn();
    const cached = new CachedWalkingProvider(
      { source: "VALHALLA", getWalkingRoute },
      30 * 60 * 1_000,
      new MemoryCache(),
    );
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(cached.getWalkingRoute({
      origin: origin.location,
      destination: destination.location,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(getWalkingRoute).not.toHaveBeenCalled();
  });

  it("공유 cache에서도 Kakao와 Valhalla walking namespace를 분리한다", async () => {
    const cache = new MemoryCache();
    const kakaoRoute = { ...route("kakao-walk"), source: "KAKAO" as const };
    const valhallaRoute = {
      ...route("valhalla-walk"),
      source: "VALHALLA" as const,
    };
    const kakaoLoad = vi.fn(async () => kakaoRoute);
    const valhallaLoad = vi.fn(async () => valhallaRoute);
    const kakao = new CachedWalkingProvider(
      { source: "KAKAO", getWalkingRoute: kakaoLoad },
      30 * 60 * 1_000,
      cache,
    );
    const valhalla = new CachedWalkingProvider(
      { source: "VALHALLA", getWalkingRoute: valhallaLoad },
      30 * 60 * 1_000,
      cache,
    );
    const request = {
      origin: origin.location,
      destination: destination.location,
    };

    await expect(kakao.getWalkingRoute(request)).resolves.toBe(kakaoRoute);
    await expect(valhalla.getWalkingRoute(request)).resolves.toBe(valhallaRoute);
    await expect(kakao.getWalkingRoute(request)).resolves.toBe(kakaoRoute);
    await expect(valhalla.getWalkingRoute(request)).resolves.toBe(valhallaRoute);
    expect(kakaoLoad).toHaveBeenCalledOnce();
    expect(valhallaLoad).toHaveBeenCalledOnce();
  });
});
