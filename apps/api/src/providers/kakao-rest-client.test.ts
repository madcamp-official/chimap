import { describe, expect, it } from "vitest";

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

describe("Kakao REST 오류와 재시도 경계", () => {
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
