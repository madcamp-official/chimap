import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../errors.js";
import {
  KakaoRestClient,
  type KakaoRouteProviderObservation,
} from "./kakao-rest-client.js";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Kakao REST 오류와 재시도 경계", () => {
  it("도보 API의 Kakao -10 응답을 쿼터 소진으로 분류하고 회로를 연다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T12:00:00+09:00"));
    let calls = 0;
    const observations: KakaoRouteProviderObservation[] = [];
    const client = new KakaoRestClient("private-server-key", async () => {
      calls += 1;
      return response(400, {
        errorType: "BadRequest",
        message: "API limit has been exceeded.",
        code: -10,
        start_x: "sensitive-coordinate",
      });
    });
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    const request = () => client.requestJson(
      "/v2/routing/walk",
      new URLSearchParams({
        start_x: "127.37",
        start_y: "36.35",
      }),
      {
        timeoutMilliseconds: 1_000,
        operation: "WALK_GEOMETRY",
      },
    );

    await expect(request()).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "RATE_LIMIT",
      retryable: true,
      cause: {
        httpStatus: 400,
        providerCode: -10,
        providerReason: "QUOTA_EXHAUSTED",
        circuitState: "TRIPPED",
      },
    });
    await expect(request()).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "RATE_LIMIT",
      retryable: true,
      cause: {
        providerCode: -10,
        providerReason: "QUOTA_EXHAUSTED",
        circuitState: "OPEN",
      },
    });

    expect(calls).toBe(1);
    expect(observations).toEqual([
      expect.objectContaining({
        operation: "WALK_GEOMETRY",
        outcome: "RATE_LIMIT",
        httpStatus: 400,
        providerCode: -10,
        providerReason: "QUOTA_EXHAUSTED",
        circuitState: "TRIPPED",
      }),
      expect.objectContaining({
        operation: "WALK_GEOMETRY",
        outcome: "RATE_LIMIT",
        providerCode: -10,
        providerReason: "QUOTA_EXHAUSTED",
        circuitState: "OPEN",
      }),
    ]);
    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain("private-server-key");
    expect(serialized).not.toContain("127.37");
    expect(serialized).not.toContain("36.35");
    expect(serialized).not.toContain("API limit has been exceeded");
    expect(serialized).not.toContain("sensitive-coordinate");
  });

  it("도보 쿼터 회로가 열려도 다른 Kakao operation은 호출한다", async () => {
    let calls = 0;
    const client = new KakaoRestClient("server-key", async () => {
      calls += 1;
      return calls === 1
        ? response(400, { code: -10, message: "quota" })
        : response(200, { documents: [] });
    });

    await expect(client.requestJson(
      "/v2/routing/walk",
      new URLSearchParams(),
      {
        timeoutMilliseconds: 1_000,
        operation: "WALK_GEOMETRY",
      },
    )).rejects.toMatchObject({ kind: "RATE_LIMIT" });
    await expect(client.requestJson(
      "/v2/local/search/keyword.json",
      new URLSearchParams({ query: "대전역" }),
      {
        timeoutMilliseconds: 1_000,
        operation: "ROUTE_SEARCH",
      },
    )).resolves.toEqual({ documents: [] });

    expect(calls).toBe(2);
  });

  it("비도보 -10은 쿼터로 분류하되 열리지 않은 회로 상태를 기록하지 않는다", async () => {
    let calls = 0;
    const observations: KakaoRouteProviderObservation[] = [];
    const client = new KakaoRestClient("server-key", async () => {
      calls += 1;
      return calls === 1
        ? response(400, { code: -10, message: "quota" })
        : response(200, { documents: [] });
    });
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );
    const request = () => client.requestJson(
      "/v2/local/search/keyword.json",
      new URLSearchParams({ query: "대전역" }),
      {
        timeoutMilliseconds: 1_000,
        operation: "ROUTE_SEARCH",
      },
    );

    await expect(request()).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "RATE_LIMIT",
      cause: {
        httpStatus: 400,
        providerCode: -10,
        providerReason: "QUOTA_EXHAUSTED",
      },
    });
    expect((observations[0] as { circuitState?: unknown }).circuitState)
      .toBeUndefined();
    await expect(request()).resolves.toEqual({ documents: [] });
    expect(calls).toBe(2);
  });

  it("한국 시간 자정이 지나면 WALK 회로를 반개방해 한 번 다시 확인한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T23:59:00+09:00"));
    let calls = 0;
    let resolveProbe!: (value: Response) => void;
    const probeResponse = new Promise<Response>((resolve) => {
      resolveProbe = resolve;
    });
    const client = new KakaoRestClient("server-key", async () => {
      calls += 1;
      if (calls === 1) return response(400, { code: "-10" });
      if (calls === 2) return probeResponse;
      return response(200, { routes: ["normal"] });
    });
    const request = () => client.requestJson(
      "/v2/routing/walk",
      new URLSearchParams(),
      {
        timeoutMilliseconds: 1_000,
        operation: "WALK_GEOMETRY",
      },
    );

    await expect(request()).rejects.toMatchObject({ kind: "RATE_LIMIT" });
    vi.setSystemTime(new Date("2026-07-31T00:00:01+09:00"));
    const firstAfterReset = request();
    await vi.waitFor(() => expect(calls).toBe(2));
    const concurrentAfterReset = request();
    await Promise.resolve();
    expect(calls).toBe(2);

    resolveProbe(response(200, { routes: ["probe"] }));
    await expect(firstAfterReset).resolves.toEqual({ routes: ["probe"] });
    await expect(concurrentAfterReset).resolves.toEqual({
      routes: ["normal"],
    });
    expect(calls).toBe(3);
  });

  it("자정 후 단일 WALK probe의 내부 재시도가 끝날 때까지 다른 요청을 대기시킨다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T23:59:00+09:00"));
    let calls = 0;
    let rejectFirstProbe!: (reason?: unknown) => void;
    let resolveRetriedProbe!: (value: Response) => void;
    const firstProbe = new Promise<Response>((_resolve, reject) => {
      rejectFirstProbe = reject;
    });
    const retriedProbe = new Promise<Response>((resolve) => {
      resolveRetriedProbe = resolve;
    });
    const client = new KakaoRestClient("server-key", async () => {
      calls += 1;
      if (calls === 1) return response(400, { code: -10 });
      if (calls === 2) return firstProbe;
      if (calls === 3) return retriedProbe;
      return response(200, { routes: ["normal"] });
    });
    const request = () => client.requestJson(
      "/v2/routing/walk",
      new URLSearchParams(),
      {
        timeoutMilliseconds: 1_000,
        operation: "WALK_GEOMETRY",
      },
    );

    await expect(request()).rejects.toMatchObject({ kind: "RATE_LIMIT" });
    vi.setSystemTime(new Date("2026-07-31T00:00:01+09:00"));
    const probeRequest = request();
    await vi.waitFor(() => expect(calls).toBe(2));
    rejectFirstProbe(new TypeError("temporary network failure"));
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(calls).toBe(3));

    const concurrentRequest = request();
    await Promise.resolve();
    expect(calls).toBe(3);

    resolveRetriedProbe(response(200, { routes: ["probe"] }));
    await expect(probeRequest).resolves.toEqual({ routes: ["probe"] });
    await expect(concurrentRequest).resolves.toEqual({
      routes: ["normal"],
    });
    expect(calls).toBe(4);
  });

  it("401을 보완 가능한 장애로 숨기지 않고 설정 오류로 반환한다", async () => {
    let calls = 0;
    const observations: KakaoRouteProviderObservation[] = [];
    const client = new KakaoRestClient(
      "server-key",
      async () => {
        calls += 1;
        return response(401, { message: "unauthorized" });
      },
    );
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await expect(
      client.requestJson("/v2/local/search/keyword.json", new URLSearchParams({
        query: "한국과학기술원",
      }), {
        timeoutMilliseconds: 1000,
        operation: "WALK_GEOMETRY",
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "CONFIGURATION",
      retryable: false,
    });
    expect(calls).toBe(1);
    expect(observations).toEqual([
      expect.objectContaining({
        provider: "KAKAO",
        operation: "WALK_GEOMETRY",
        outcome: "HTTP_4XX",
        timeoutOrigin: "NONE",
      }),
    ]);
  });

  it("복구 가능한 503은 한 번만 재시도하고 정상 응답을 사용한다", async () => {
    let calls = 0;
    const client = new KakaoRestClient(
      "server-key",
      async () => {
        calls += 1;
        return calls === 1
          ? response(503, { message: "unavailable" })
          : response(200, { documents: [] });
      },
    );

    await expect(
      client.requestJson("/v2/local/search/keyword.json", new URLSearchParams({
        query: "대전역",
      }), {
        timeoutMilliseconds: 1000,
      }),
    ).resolves.toEqual({ documents: [] });
    expect(calls).toBe(2);
  });

  it.each([
    { status: 429, outcome: "RATE_LIMIT" as const },
    { status: 503, outcome: "HTTP_5XX" as const },
  ])("HTTP $status fail-open 원인을 실제 provider outcome으로 남긴다", async ({
    status,
    outcome,
  }) => {
    const observations: KakaoRouteProviderObservation[] = [];
    let calls = 0;
    const client = new KakaoRestClient("private-server-key", async () => {
      calls += 1;
      return response(status, { message: "provider failure" });
    });
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await expect(client.requestJson(
      "/v2/routing/walk",
      new URLSearchParams({ start_x: "127.37", start_y: "36.35" }),
      {
        timeoutMilliseconds: 1_000,
        operation: "WALK_GEOMETRY",
      },
    )).rejects.toBeInstanceOf(ProviderError);

    expect(calls).toBe(2);
    expect(observations).toEqual([
      expect.objectContaining({
        provider: "KAKAO",
        operation: "WALK_GEOMETRY",
        outcome,
        timeoutOrigin: "NONE",
      }),
    ]);
    expect(observations[0]?.durationMilliseconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(observations)).not.toContain("private-server-key");
    expect(JSON.stringify(observations)).not.toContain("127.37");
    expect(JSON.stringify(observations)).not.toContain("36.35");
  });

  it("사용자가 중단한 요청은 재시도하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort(new Error("user-aborted"));
    let calls = 0;
    const client = new KakaoRestClient(
      "server-key",
      async (_url, options) => {
        calls += 1;
        if (options?.signal?.aborted === true) {
          throw options.signal.reason;
        }
        return response(200, {});
      },
    );

    await expect(
      client.requestJson("/v2/local/search/keyword.json", new URLSearchParams({
        query: "대전역",
      }), {
        timeoutMilliseconds: 1000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "ABORTED",
    });
    expect(calls).toBe(1);
  });

  it("상위 시간 예산 만료는 사용자 취소가 아니라 timeout으로 분류한다", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("budget expired", "TimeoutError"));
    let calls = 0;
    const client = new KakaoRestClient(
      "server-key",
      async (_url, options) => {
        calls += 1;
        throw options?.signal?.reason;
      },
    );

    await expect(
      client.requestJson("/v2/routing/walk", new URLSearchParams(), {
        timeoutMilliseconds: 3_500,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "TIMEOUT",
      retryable: true,
    });
    expect(calls).toBe(1);
  });
});
