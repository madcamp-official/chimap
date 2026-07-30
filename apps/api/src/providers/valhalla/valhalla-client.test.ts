import { describe, expect, it, vi } from "vitest";

import type { ProviderError } from "../../errors.js";
import {
  ValhallaClient,
  type ValhallaRouteProviderObservation,
} from "./valhalla-client.js";

const VALID_SHAPE = "??ACAC";

function routeResponse(legCount = 1): Response {
  return new Response(JSON.stringify({
    trip: {
      summary: { length: 1.234, time: 456 },
      legs: Array.from({ length: legCount }, () => ({ shape: VALID_SHAPE })),
    },
  }));
}

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("ValhallaClient", () => {
  it("pedestrian 요청에서 via 순서와 summary 거리/시간을 보존한다", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(init?.redirect).toBe("error");
      expect(body.costing).toBe("pedestrian");
      expect(body.locations).toEqual([
        { lat: 0.000001, lon: 0.000001 },
        { lat: 0.000002, lon: 0.000002 },
        { lat: 0.000003, lon: 0.000003 },
      ]);
      return routeResponse(2);
    });
    const result = await new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: fetchMock as typeof fetch,
    }).route({
      origin: { lat: 0.000001, lng: 0.000001 },
      vias: [{ lat: 0.000002, lng: 0.000002 }],
      destination: { lat: 0.000003, lng: 0.000003 },
    });
    expect(result).toMatchObject({
      distanceMeters: 1_234,
      durationSeconds: 456,
    });
    expect(result.legCoordinates).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("base URL의 path prefix를 보존해 route endpoint를 만든다", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.toString()).toBe(
        "http://valhalla.internal:8002/internal/valhalla/route",
      );
      return routeResponse();
    });

    await new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002/internal/valhalla",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: fetchMock as typeof fetch,
    }).route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("각 provider timeout 재시도에 새 signal을 사용하고 횟수를 제한한다", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return waitForAbort(signal);
    });
    const observations: ValhallaRouteProviderObservation[] = [];
    const client = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 5,
      retryCount: 1,
      fetch: fetchMock as typeof fetch,
    });
    client.setRouteProviderObserver((observation) => {
      observations.push(observation);
    });
    const request = client.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
    });
    await expect(request).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "TIMEOUT",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      outcome: "TIMEOUT",
      timeoutOrigin: "PROVIDER",
    });
  });

  it("client abort는 즉시 ABORTED로 끝내고 재시도하지 않는다", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: URL, init?: RequestInit) =>
      waitForAbort(init?.signal as AbortSignal)
    );
    const request = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 3,
      fetch: fetchMock as typeof fetch,
    }).route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
      signal: controller.signal,
    });
    controller.abort(new DOMException("client cancelled", "AbortError"));
    await expect(request).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "ABORTED",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("이미 취소된 client signal이면 공급자를 호출하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 3,
      fetch: fetchMock as typeof fetch,
    }).route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
      signal: controller.signal,
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "ABORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4xx는 retry하지 않고 5xx만 제한적으로 retry한다", async () => {
    const four = vi.fn(async () => new Response("", { status: 400 }));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal",
      timeoutMs: 1_000,
      retryCount: 2,
      fetch: four as typeof fetch,
    }).route({
      origin: { lat: 1, lng: 1 },
      destination: { lat: 2, lng: 2 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "NO_ROUTE" });
    expect(four).toHaveBeenCalledOnce();

    const five = vi.fn(async () => new Response("", { status: 503 }));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal",
      timeoutMs: 1_000,
      retryCount: 1,
      fetch: five as typeof fetch,
    }).route({
      origin: { lat: 1, lng: 1 },
      destination: { lat: 2, lng: 2 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });
    expect(five).toHaveBeenCalledTimes(2);
  });

  it("성공과 HTTP 실패를 좌표나 endpoint 없이 관측한다", async () => {
    const successObservations: ValhallaRouteProviderObservation[] = [];
    const successClient = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: vi.fn(async () => routeResponse()) as typeof fetch,
    });
    successClient.setRouteProviderObserver((observation) => {
      successObservations.push(observation);
    });
    await successClient.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
    });
    expect(successObservations).toHaveLength(1);
    expect(successObservations[0]).toMatchObject({
      provider: "VALHALLA",
      operation: "WALK_GEOMETRY",
      outcome: "SUCCESS",
      timeoutOrigin: "NONE",
    });
    expect(Object.keys(successObservations[0]!)).toEqual([
      "provider",
      "operation",
      "outcome",
      "timeoutOrigin",
      "durationMilliseconds",
    ]);

    const errorObservations: ValhallaRouteProviderObservation[] = [];
    const errorClient = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: vi.fn(async () => new Response("PRIVATE", { status: 503 })) as typeof fetch,
    });
    errorClient.setRouteProviderObserver((observation) => {
      errorObservations.push(observation);
    });
    await expect(errorClient.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });
    expect(errorObservations).toHaveLength(1);
    expect(errorObservations[0]).toMatchObject({
      provider: "VALHALLA",
      operation: "WALK_GEOMETRY",
      outcome: "HTTP_5XX",
      timeoutOrigin: "NONE",
      httpStatus: 503,
    });
    expect(JSON.stringify(errorObservations[0])).not.toContain("PRIVATE");
    expect(JSON.stringify(errorObservations[0])).not.toContain(
      "valhalla.internal",
    );
  });

  it("tagged phase timeout과 client abort의 origin을 구분한다", async () => {
    const phaseController = new AbortController();
    const phaseReason = new DOMException("geometry deadline", "TimeoutError") as
      DOMException & { chimapTimeoutOrigin: "GEOMETRY" };
    phaseReason.chimapTimeoutOrigin = "GEOMETRY";
    phaseController.abort(phaseReason);
    const phaseObservations: ValhallaRouteProviderObservation[] = [];
    const phaseClient = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: vi.fn() as typeof fetch,
    });
    phaseClient.setRouteProviderObserver((observation) => {
      phaseObservations.push(observation);
    });
    await expect(phaseClient.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
      signal: phaseController.signal,
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "TIMEOUT" });
    expect(phaseObservations[0]).toMatchObject({
      outcome: "TIMEOUT",
      timeoutOrigin: "GEOMETRY",
    });

    const clientController = new AbortController();
    clientController.abort();
    const clientObservations: ValhallaRouteProviderObservation[] = [];
    const client = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: vi.fn() as typeof fetch,
    });
    client.setRouteProviderObserver((observation) => {
      clientObservations.push(observation);
    });
    await expect(client.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
      signal: clientController.signal,
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "ABORTED" });
    expect(clientObservations[0]).toMatchObject({
      outcome: "ABORTED",
      timeoutOrigin: "CLIENT",
    });
  });

  it("observer 예외가 정상 경로 결과를 바꾸지 않는다", async () => {
    const client = new ValhallaClient({
      baseUrl: "http://valhalla.internal:8002",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: vi.fn(async () => routeResponse()) as typeof fetch,
    });
    client.setRouteProviderObserver(() => {
      throw new Error("observer failure");
    });
    await expect(client.route({
      origin: { lat: 36.35, lng: 127.38 },
      destination: { lat: 36.36, lng: 127.39 },
    })).resolves.toMatchObject({ distanceMeters: 1_234 });
  });

  it("잘못된 JSON, leg 수, geometry를 민감정보 없는 오류로 거절한다", async () => {
    const secret = "TOP_SECRET_RESPONSE_BODY";
    const malformedJson = vi.fn(async () => new Response(secret));
    let caught: unknown;
    try {
      await new ValhallaClient({
        baseUrl: "http://valhalla.internal",
        timeoutMs: 1_000,
        retryCount: 0,
        fetch: malformedJson as typeof fetch,
      }).route({
        origin: { lat: 1, lng: 1 },
        destination: { lat: 2, lng: 2 },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });
    expect((caught as Error).message).not.toContain(secret);
    expect((caught as Error).message).not.toContain("valhalla.internal");

    const wrongLegCount = vi.fn(async () => routeResponse(1));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: wrongLegCount as typeof fetch,
    }).route({
      origin: { lat: 1, lng: 1 },
      vias: [{ lat: 1.5, lng: 1.5 }],
      destination: { lat: 2, lng: 2 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });

    const partialLegSummaries = vi.fn(async () =>
      new Response(JSON.stringify({
        trip: {
          legs: [
            {
              shape: VALID_SHAPE,
              summary: { length: 0.5, time: 60 },
            },
            { shape: VALID_SHAPE },
          ],
        },
      }))
    );
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: partialLegSummaries as typeof fetch,
    }).route({
      origin: { lat: 1, lng: 1 },
      vias: [{ lat: 1.5, lng: 1.5 }],
      destination: { lat: 2, lng: 2 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });

    const badShape = vi.fn(async () => new Response(JSON.stringify({
      trip: {
        summary: { length: 1, time: 60 },
        legs: [{ shape: "~" }],
      },
    })));
    await expect(new ValhallaClient({
      baseUrl: "http://valhalla.internal",
      timeoutMs: 1_000,
      retryCount: 0,
      fetch: badShape as typeof fetch,
    }).route({
      origin: { lat: 1, lng: 1 },
      destination: { lat: 2, lng: 2 },
    })).rejects.toMatchObject<Partial<ProviderError>>({ kind: "UPSTREAM" });
  });
});
