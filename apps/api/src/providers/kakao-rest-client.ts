import { ProviderError } from "../errors.js";

const KAKAO_BASE_URL = "https://dapi.kakao.com";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const KOREA_UTC_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export type KakaoRequestOptions = {
  timeoutMilliseconds: number;
  signal?: AbortSignal;
  operation?: KakaoRouteProviderOperation;
};

export type KakaoRouteProviderOperation =
  | "ROUTE_SEARCH"
  | "ROAD_GEOMETRY"
  | "WALK_GEOMETRY";

export type KakaoRouteProviderObservation = {
  provider: "KAKAO";
  operation: KakaoRouteProviderOperation;
  outcome:
    | "SUCCESS"
    | "ERROR"
    | "TIMEOUT"
    | "ABORTED"
    | "RATE_LIMIT"
    | "HTTP_4XX"
    | "HTTP_5XX";
  timeoutOrigin:
    | "NONE"
    | "CLIENT"
    | "PLANNING"
    | "GEOMETRY"
    | "PROVIDER"
    | "QUEUE";
  durationMilliseconds: number;
  httpStatus?: number;
  providerCode?: -10;
  providerReason?: "QUOTA_EXHAUSTED";
  circuitState?: "TRIPPED" | "OPEN";
};

type KakaoRouteProviderObserver = (
  observation: KakaoRouteProviderObservation,
) => void;

type KakaoRequestBody = {
  method: "POST";
  value: unknown;
};

function providerHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof ProviderError)) return undefined;
  const cause = error.cause;
  return typeof cause === "object" &&
      cause !== null &&
      "httpStatus" in cause &&
      typeof cause.httpStatus === "number"
    ? cause.httpStatus
    : undefined;
}

function providerCauseValue(
  error: unknown,
  key: "providerCode" | "providerReason" | "circuitState",
): unknown {
  if (!(error instanceof ProviderError)) return undefined;
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  return (cause as Record<PropertyKey, unknown>)[key];
}

function kakaoErrorCode(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) {
    return undefined;
  }
  return value.code === -10 || value.code === "-10" ? -10 : undefined;
}

async function responseErrorCode(
  response: Response,
): Promise<number | undefined> {
  try {
    return kakaoErrorCode(await response.json());
  } catch {
    return undefined;
  }
}

function nextKoreaQuotaResetMilliseconds(nowMilliseconds: number): number {
  const koreaDay = Math.floor(
    (nowMilliseconds + KOREA_UTC_OFFSET_MILLISECONDS) / MILLISECONDS_PER_DAY,
  );
  return (
    (koreaDay + 1) * MILLISECONDS_PER_DAY - KOREA_UTC_OFFSET_MILLISECONDS
  );
}

function quotaExhaustedError(
  options: {
    operation?: KakaoRouteProviderOperation;
    circuitState?: "TRIPPED" | "OPEN";
    httpStatus?: number;
  },
): ProviderError {
  return new ProviderError({
    kind: "RATE_LIMIT",
    message:
      options.operation === "WALK_GEOMETRY"
        ? "Kakao 도보 경로 API 일일 사용량 한도를 초과했습니다."
        : "Kakao API 사용량 한도를 초과했습니다.",
    retryable: true,
    cause: {
      ...(options.httpStatus === undefined
        ? {}
        : { httpStatus: options.httpStatus }),
      providerCode: -10,
      providerReason: "QUOTA_EXHAUSTED",
      ...(options.circuitState === undefined
        ? {}
        : { circuitState: options.circuitState }),
    },
  });
}

function waitForCompletion(
  pending: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(() => {
      cleanup();
      resolve();
    });
  });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export class KakaoRestClient {
  readonly #restApiKey: string;
  readonly #fetch: typeof fetch;
  #routeProviderObserver: KakaoRouteProviderObserver | undefined;
  #walkQuotaCircuitOpenUntilMilliseconds = 0;
  #walkQuotaProbeRequired = false;
  #walkQuotaProbe: Promise<void> | undefined;
  #resolveWalkQuotaProbe: (() => void) | undefined;

  public constructor(restApiKey: string, fetchImplementation = fetch) {
    if (restApiKey.trim().length === 0) {
      throw new Error("Kakao REST API 키가 필요합니다.");
    }
    this.#restApiKey = restApiKey;
    this.#fetch = fetchImplementation;
  }

  public setRouteProviderObserver(observer: KakaoRouteProviderObserver): void {
    this.#routeProviderObserver = observer;
  }

  #observeRouteProvider(observation: KakaoRouteProviderObservation): void {
    try {
      this.#routeProviderObserver?.(observation);
    } catch {
      // Observability must never change a provider request result.
    }
  }

  async #enterWalkQuotaCircuit(
    options: KakaoRequestOptions,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (options.operation !== "WALK_GEOMETRY") return false;
    while (true) {
      if (signal.aborted) throw signal.reason;
      if (Date.now() < this.#walkQuotaCircuitOpenUntilMilliseconds) {
        throw quotaExhaustedError({
          operation: options.operation,
          circuitState: "OPEN",
        });
      }
      if (!this.#walkQuotaProbeRequired) return false;
      if (this.#walkQuotaProbe !== undefined) {
        await waitForCompletion(this.#walkQuotaProbe, signal);
        continue;
      }
      let resolveProbe!: () => void;
      this.#walkQuotaProbe = new Promise<void>((resolve) => {
        resolveProbe = resolve;
      });
      this.#resolveWalkQuotaProbe = resolveProbe;
      return true;
    }
  }

  #finishWalkQuotaProbe(ownsProbe: boolean): void {
    if (!ownsProbe) return;
    if (Date.now() >= this.#walkQuotaCircuitOpenUntilMilliseconds) {
      this.#walkQuotaProbeRequired = false;
    }
    const resolveProbe = this.#resolveWalkQuotaProbe;
    this.#walkQuotaProbe = undefined;
    this.#resolveWalkQuotaProbe = undefined;
    resolveProbe?.();
  }

  #tripWalkQuotaCircuit(): void {
    this.#walkQuotaCircuitOpenUntilMilliseconds = Math.max(
      this.#walkQuotaCircuitOpenUntilMilliseconds,
      nextKoreaQuotaResetMilliseconds(Date.now()),
    );
    this.#walkQuotaProbeRequired = true;
  }

  public async requestJson(
    path: string,
    parameters: URLSearchParams,
    options: KakaoRequestOptions,
  ): Promise<unknown> {
    const url = new URL(path, KAKAO_BASE_URL);
    url.search = parameters.toString();
    return this.#requestJson(url, options);
  }

  public requestJsonBody(
    url: URL,
    body: unknown,
    options: KakaoRequestOptions,
  ): Promise<unknown> {
    return this.#requestJson(url, options, {
      method: "POST",
      value: body,
    });
  }

  async #requestJson(
    url: URL,
    options: KakaoRequestOptions,
    body?: KakaoRequestBody,
  ): Promise<unknown> {
    if (options.operation === undefined) {
      return this.#requestJsonUnobserved(url, options, body);
    }
    const startedAt = performance.now();
    try {
      const result = await this.#requestJsonUnobserved(url, options, body);
      this.#observeRouteProvider({
        provider: "KAKAO",
        operation: options.operation,
        outcome: "SUCCESS",
        timeoutOrigin: "NONE",
        durationMilliseconds: performance.now() - startedAt,
      });
      return result;
    } catch (error) {
      const taggedTimeoutOrigin = (() => {
        const reason = options.signal?.reason;
        if (
          typeof reason === "object" &&
          reason !== null &&
          "chimapTimeoutOrigin" in reason &&
          (reason.chimapTimeoutOrigin === "PLANNING" ||
            reason.chimapTimeoutOrigin === "GEOMETRY")
        ) {
          return reason.chimapTimeoutOrigin;
        }
        return undefined;
      })();
      const timeoutOrigin =
        error instanceof ProviderError && error.kind === "TIMEOUT"
          ? taggedTimeoutOrigin ?? "PROVIDER"
          : error instanceof ProviderError && error.kind === "ABORTED"
            ? taggedTimeoutOrigin ?? "CLIENT"
            : "NONE";
      const httpStatus = providerHttpStatus(error);
      const providerCode = providerCauseValue(error, "providerCode");
      const providerReason = providerCauseValue(error, "providerReason");
      const circuitState = providerCauseValue(error, "circuitState");
      this.#observeRouteProvider({
        provider: "KAKAO",
        operation: options.operation,
        outcome:
          error instanceof ProviderError && error.kind === "RATE_LIMIT"
            ? "RATE_LIMIT"
            : httpStatus !== undefined && httpStatus >= 500
              ? "HTTP_5XX"
              : httpStatus !== undefined && httpStatus >= 400
                ? "HTTP_4XX"
                : error instanceof ProviderError && error.kind === "TIMEOUT"
                  ? "TIMEOUT"
                  : error instanceof ProviderError && error.kind === "ABORTED"
                    ? "ABORTED"
                    : "ERROR",
        timeoutOrigin,
        durationMilliseconds: performance.now() - startedAt,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(providerCode === -10 ? { providerCode } : {}),
        ...(providerReason === "QUOTA_EXHAUSTED"
          ? { providerReason }
          : {}),
        ...(circuitState === "TRIPPED" || circuitState === "OPEN"
          ? { circuitState }
          : {}),
      });
      throw error;
    }
  }

  async #requestJsonUnobserved(
    url: URL,
    options: KakaoRequestOptions,
    body?: KakaoRequestBody,
  ): Promise<unknown> {
    let ownsWalkQuotaProbe = false;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(options.timeoutMilliseconds);
        const signal =
          options.signal === undefined
            ? timeoutSignal
            : AbortSignal.any([options.signal, timeoutSignal]);
        try {
          if (!ownsWalkQuotaProbe) {
            ownsWalkQuotaProbe = await this.#enterWalkQuotaCircuit(
              options,
              signal,
            );
          }
          const response = await this.#fetch(url, {
            method: body?.method ?? "GET",
            headers: {
              Authorization: `KakaoAK ${this.#restApiKey}`,
              Accept: "application/json",
              ...(body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
            ...(body === undefined
              ? {}
              : { body: JSON.stringify(body.value) }),
            signal,
          });

          if (response.ok) {
            return (await response.json()) as unknown;
          }
          if (
            response.status === 400 &&
            await responseErrorCode(response) === -10
          ) {
            if (options.operation === "WALK_GEOMETRY") {
              this.#tripWalkQuotaCircuit();
            }
            throw quotaExhaustedError({
              ...(options.operation === undefined
                ? {}
                : { operation: options.operation }),
              ...(options.operation === "WALK_GEOMETRY"
                ? { circuitState: "TRIPPED" as const }
                : {}),
              httpStatus: response.status,
            });
          }
          if (RETRYABLE_STATUSES.has(response.status) && attempt === 0) {
            await delay(100 + Math.floor(Math.random() * 100), options.signal);
            continue;
          }
          if (
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403
          ) {
            throw new ProviderError({
              kind: "CONFIGURATION",
              message:
                "Kakao Map 사용 설정, REST API 키, 호출 허용 IP를 확인해 주세요.",
              cause: { httpStatus: response.status },
            });
          }
          if (response.status === 429) {
            throw new ProviderError({
              kind: "RATE_LIMIT",
              message: "Kakao API 사용량 한도를 초과했습니다.",
              retryable: true,
              cause: { httpStatus: response.status },
            });
          }
          throw new ProviderError({
            kind: "UPSTREAM",
            message: `Kakao API HTTP ${response.status}`,
            retryable: RETRYABLE_STATUSES.has(response.status),
            cause: { httpStatus: response.status },
          });
        } catch (error) {
          if (error instanceof ProviderError) {
            throw error;
          }
          if (options.signal?.aborted === true) {
            const timedOut =
              options.signal.reason instanceof DOMException &&
              options.signal.reason.name === "TimeoutError";
            throw new ProviderError({
              kind: timedOut ? "TIMEOUT" : "ABORTED",
              message: timedOut
                ? "Kakao 요청 시간이 초과되었습니다."
                : "Kakao 요청이 취소되었습니다.",
              retryable: timedOut,
              cause: error,
            });
          }
          if (timeoutSignal.aborted) {
            if (attempt === 0) {
              continue;
            }
            throw new ProviderError({
              kind: "TIMEOUT",
              message: "Kakao 요청 시간이 초과되었습니다.",
              retryable: true,
              cause: error,
            });
          }
          if (attempt === 0) {
            await delay(100 + Math.floor(Math.random() * 100), options.signal);
            continue;
          }
          throw new ProviderError({
            kind: "UPSTREAM",
            message: "Kakao 네트워크 요청에 실패했습니다.",
            retryable: true,
            cause: error,
          });
        }
      }

      throw new ProviderError({
        kind: "UPSTREAM",
        message: "Kakao 요청이 완료되지 않았습니다.",
      });
    } finally {
      this.#finishWalkQuotaProbe(ownsWalkQuotaProbe);
    }
  }
}
