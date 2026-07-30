import type { Coordinate } from "@chimap/contracts";

import { ProviderError } from "../../errors.js";
import type { WalkRouteRequest } from "../types.js";
import {
  decodePolyline6,
  joinCoordinateLegs,
} from "./valhalla-polyline.js";

type ValhallaLeg = {
  shape: string;
  summaryLengthKilometers?: number;
  summaryTimeSeconds?: number;
};

export type ValhallaRouteResult = {
  coordinates: Coordinate[];
  legCoordinates: Coordinate[][];
  distanceMeters: number;
  durationSeconds: number;
};

export type ValhallaRouteProviderObservation = {
  provider: "VALHALLA";
  operation: "WALK_GEOMETRY";
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
    | "PROVIDER";
  durationMilliseconds: number;
  httpStatus?: number;
};

export type ValhallaRouteProviderObserver = (
  observation: ValhallaRouteProviderObservation,
) => void;

type ValhallaClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  fetch?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonnegativeNumber(
  value: unknown,
  fieldPresent: boolean,
): number | undefined {
  if (!fieldPresent) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw malformedResponseError();
  }
  return value;
}

function malformedResponseError(): ProviderError {
  return new ProviderError({
    kind: "UPSTREAM",
    message: "Valhalla 경로 응답 형식이 올바르지 않습니다.",
    retryable: true,
  });
}

function noRouteError(): ProviderError {
  return new ProviderError({
    kind: "NO_ROUTE",
    message: "Valhalla에서 유효한 도보 경로를 찾지 못했습니다.",
  });
}

function clientAbortError(): ProviderError {
  return new ProviderError({
    kind: "ABORTED",
    message: "Valhalla 도보 경로 요청이 취소되었습니다.",
  });
}

function taggedTimeoutOrigin(
  signal: AbortSignal | undefined,
): "PLANNING" | "GEOMETRY" | undefined {
  const reason = signal?.reason;
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
}

function requestAbortError(signal: AbortSignal | undefined): ProviderError {
  return taggedTimeoutOrigin(signal) === undefined
    ? clientAbortError()
    : new ProviderError({
        kind: "TIMEOUT",
        message: "Valhalla 도보 경로 요청 단계의 시간이 초과되었습니다.",
      });
}

function providerTimeoutError(): ProviderError {
  return new ProviderError({
    kind: "TIMEOUT",
    message: "Valhalla 도보 경로 공급자 응답 시간이 초과되었습니다.",
    retryable: true,
  });
}

function safeNetworkCause(error: unknown): { errorName: string } {
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function providerHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof ProviderError) || !isRecord(error.cause)) {
    return undefined;
  }
  const httpStatus = error.cause.httpStatus;
  return typeof httpStatus === "number" && Number.isInteger(httpStatus)
    ? httpStatus
    : undefined;
}

function parseLeg(value: unknown): ValhallaLeg {
  if (
    !isRecord(value) ||
    typeof value.shape !== "string" ||
    value.shape.length === 0
  ) {
    throw malformedResponseError();
  }
  const summary = value.summary;
  if (summary !== undefined && !isRecord(summary)) {
    throw malformedResponseError();
  }
  const summaryLengthKilometers = optionalNonnegativeNumber(
    summary?.length,
    summary !== undefined && "length" in summary,
  );
  const summaryTimeSeconds = optionalNonnegativeNumber(
    summary?.time,
    summary !== undefined && "time" in summary,
  );
  return {
    shape: value.shape,
    ...(summaryLengthKilometers === undefined
      ? {}
      : { summaryLengthKilometers }),
    ...(summaryTimeSeconds === undefined ? {} : { summaryTimeSeconds }),
  };
}

function parsePayload(
  payload: unknown,
  expectedLegCount: number,
): ValhallaRouteResult {
  if (!isRecord(payload) || !isRecord(payload.trip)) {
    throw malformedResponseError();
  }
  const rawLegs = payload.trip.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
    throw noRouteError();
  }
  if (rawLegs.length !== expectedLegCount) {
    throw malformedResponseError();
  }
  const legs = rawLegs.map(parseLeg);
  let legCoordinates: Coordinate[][];
  let coordinates: Coordinate[];
  try {
    legCoordinates = legs.map((leg) => decodePolyline6(leg.shape));
    coordinates = joinCoordinateLegs(legCoordinates);
  } catch {
    throw malformedResponseError();
  }

  const summary = payload.trip.summary;
  if (summary !== undefined && !isRecord(summary)) {
    throw malformedResponseError();
  }
  const summaryLengthKilometers = optionalNonnegativeNumber(
    summary?.length,
    summary !== undefined && "length" in summary,
  );
  const summaryTimeSeconds = optionalNonnegativeNumber(
    summary?.time,
    summary !== undefined && "time" in summary,
  );
  if (
    summaryLengthKilometers === undefined &&
    legs.some((leg) => leg.summaryLengthKilometers === undefined)
  ) {
    throw malformedResponseError();
  }
  if (
    summaryTimeSeconds === undefined &&
    legs.some((leg) => leg.summaryTimeSeconds === undefined)
  ) {
    throw malformedResponseError();
  }
  const distanceKilometers = summaryLengthKilometers ?? legs.reduce(
    (total, leg) => total + (leg.summaryLengthKilometers ?? 0),
    0,
  );
  const duration = summaryTimeSeconds ?? legs.reduce(
    (total, leg) => total + (leg.summaryTimeSeconds ?? 0),
    0,
  );
  const distanceMeters = Math.round(distanceKilometers * 1_000);
  const durationSeconds = Math.round(duration);
  if (
    !Number.isSafeInteger(distanceMeters) ||
    !Number.isSafeInteger(durationSeconds) ||
    distanceMeters <= 0 ||
    durationSeconds <= 0
  ) {
    throw noRouteError();
  }

  return {
    coordinates,
    legCoordinates,
    distanceMeters,
    durationSeconds,
  };
}

function httpError(response: Response): ProviderError {
  const httpStatus = response.status;
  if (httpStatus === 429) {
    return new ProviderError({
      kind: "RATE_LIMIT",
      message: "Valhalla 경로 공급자의 요청 한도를 초과했습니다.",
      cause: { httpStatus },
    });
  }
  if (httpStatus >= 500) {
    return new ProviderError({
      kind: "UPSTREAM",
      message: "Valhalla 경로 공급자가 일시적인 오류를 반환했습니다.",
      retryable: true,
      cause: { httpStatus },
    });
  }
  return new ProviderError({
    kind: "NO_ROUTE",
    message: "Valhalla에서 요청한 도보 경로를 제공할 수 없습니다.",
    cause: { httpStatus },
  });
}

export class ValhallaClient {
  readonly #routeUrl: URL;
  readonly #timeoutMs: number;
  readonly #retryCount: number;
  readonly #fetch: typeof fetch;
  #routeProviderObserver: ValhallaRouteProviderObserver | undefined;

  public constructor(options: ValhallaClientOptions) {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new ProviderError({
        kind: "CONFIGURATION",
        message: "Valhalla 요청 제한 시간이 올바르지 않습니다.",
      });
    }
    if (!Number.isInteger(options.retryCount) || options.retryCount < 0) {
      throw new ProviderError({
        kind: "CONFIGURATION",
        message: "Valhalla 재시도 횟수가 올바르지 않습니다.",
      });
    }
    try {
      const baseUrl = new URL(options.baseUrl);
      if (
        (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
        baseUrl.username.length > 0 ||
        baseUrl.password.length > 0 ||
        baseUrl.search.length > 0 ||
        baseUrl.hash.length > 0
      ) {
        throw new TypeError("unsupported URL");
      }
      const basePath = baseUrl.pathname.replace(/\/+$/u, "");
      baseUrl.pathname = `${basePath}/route`;
      this.#routeUrl = baseUrl;
    } catch {
      throw new ProviderError({
        kind: "CONFIGURATION",
        message: "Valhalla endpoint 설정이 올바르지 않습니다.",
      });
    }
    this.#timeoutMs = options.timeoutMs;
    this.#retryCount = options.retryCount;
    this.#fetch = options.fetch ?? fetch;
  }

  public setRouteProviderObserver(
    observer: ValhallaRouteProviderObserver,
  ): void {
    this.#routeProviderObserver = observer;
  }

  #observeRouteProvider(observation: ValhallaRouteProviderObservation): void {
    try {
      this.#routeProviderObserver?.(observation);
    } catch {
      // Observability must never change a provider request result.
    }
  }

  public async route(request: WalkRouteRequest): Promise<ValhallaRouteResult> {
    const startedAt = performance.now();
    try {
      const result = await this.#routeUnobserved(request);
      this.#observeRouteProvider({
        provider: "VALHALLA",
        operation: "WALK_GEOMETRY",
        outcome: "SUCCESS",
        timeoutOrigin: "NONE",
        durationMilliseconds: performance.now() - startedAt,
      });
      return result;
    } catch (error) {
      const httpStatus = providerHttpStatus(error);
      const phaseTimeoutOrigin = taggedTimeoutOrigin(request.signal);
      const timeoutOrigin =
        error instanceof ProviderError && error.kind === "TIMEOUT"
          ? phaseTimeoutOrigin ?? "PROVIDER"
          : error instanceof ProviderError && error.kind === "ABORTED"
            ? phaseTimeoutOrigin ?? "CLIENT"
            : "NONE";
      this.#observeRouteProvider({
        provider: "VALHALLA",
        operation: "WALK_GEOMETRY",
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
      });
      throw error;
    }
  }

  async #routeUnobserved(
    request: WalkRouteRequest,
  ): Promise<ValhallaRouteResult> {
    if (signalAborted(request.signal)) {
      throw requestAbortError(request.signal);
    }
    const locations = [
      request.origin,
      ...(request.vias ?? []),
      request.destination,
    ].map(({ lat, lng }) => ({ lat, lon: lng }));

    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt <= this.#retryCount; attempt += 1) {
      if (signalAborted(request.signal)) {
        throw requestAbortError(request.signal);
      }
      const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
      const signal = request.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([request.signal, timeoutSignal]);
      try {
        const response = await this.#fetch(this.#routeUrl, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locations,
            costing: "pedestrian",
            units: "kilometers",
            directions_options: { units: "kilometers" },
          }),
          signal,
        });
        if (!response.ok) throw httpError(response);

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw malformedResponseError();
        }
        return parsePayload(payload, locations.length - 1);
      } catch (error) {
        const mapped = signalAborted(request.signal)
          ? requestAbortError(request.signal)
          : error instanceof ProviderError
            ? error
            : timeoutSignal.aborted
              ? providerTimeoutError()
              : new ProviderError({
                  kind: "UPSTREAM",
                  message: "Valhalla 도보 경로 요청에 실패했습니다.",
                  retryable: true,
                  cause: safeNetworkCause(error),
                });
        if (mapped.kind === "ABORTED") throw mapped;
        lastError = mapped;
        if (!mapped.retryable || attempt === this.#retryCount) throw mapped;
      }
    }
    throw lastError ?? new ProviderError({
      kind: "UPSTREAM",
      message: "Valhalla 도보 경로 요청에 실패했습니다.",
    });
  }
}
