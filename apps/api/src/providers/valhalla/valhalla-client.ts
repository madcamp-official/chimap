import { ProviderError } from "../../errors.js";
import type { WalkRouteRequest } from "../types.js";
import { joinLegShapes } from "./valhalla-polyline.js";

type ValhallaResponse = {
  trip?: {
    summary?: { length?: number; time?: number };
    legs?: Array<{ shape?: string; summary?: { length?: number; time?: number } }>;
  };
};

export class ValhallaClient {
  public constructor(private readonly options: {
    baseUrl: string;
    timeoutMs: number;
    retryCount: number;
    fetch?: typeof fetch;
  }) {}

  public async route(request: WalkRouteRequest) {
    const locations = [request.origin, ...(request.vias ?? []), request.destination]
      .map(({ lat, lng }) => ({ lat, lon: lng }));
    const signal = request.signal === undefined
      ? AbortSignal.timeout(this.options.timeoutMs)
      : AbortSignal.any([request.signal, AbortSignal.timeout(this.options.timeoutMs)]);
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.retryCount; attempt += 1) {
      try {
        const response = await (this.options.fetch ?? fetch)(
          new URL("/route", this.options.baseUrl),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              locations,
              costing: "pedestrian",
              units: "kilometers",
              directions_options: { units: "kilometers" },
            }),
            signal,
          },
        );
        if (!response.ok) {
          throw new ProviderError({
            kind: response.status >= 500 ? "UPSTREAM" : "NO_ROUTE",
            message: `Valhalla HTTP ${response.status}`,
            retryable: response.status >= 500,
          });
        }
        let payload: ValhallaResponse;
        try {
          payload = await response.json() as ValhallaResponse;
        } catch (cause) {
          throw new ProviderError({ kind: "UPSTREAM", message: "Valhalla JSON 응답이 잘못됐습니다.", cause });
        }
        const legs = payload.trip?.legs;
        if (legs === undefined || legs.length === 0) {
          throw new ProviderError({ kind: "NO_ROUTE", message: "Valhalla 경로가 비어 있습니다." });
        }
        const coordinates = joinLegShapes(legs.map((leg) => leg.shape ?? ""));
        const distanceMeters = Math.round(
          (payload.trip?.summary?.length ??
            legs.reduce((sum, leg) => sum + (leg.summary?.length ?? 0), 0)) * 1000,
        );
        const durationSeconds = Math.round(
          payload.trip?.summary?.time ??
            legs.reduce((sum, leg) => sum + (leg.summary?.time ?? 0), 0),
        );
        if (distanceMeters <= 0 || durationSeconds <= 0) {
          throw new ProviderError({ kind: "NO_ROUTE", message: "Valhalla 거리 또는 시간이 유효하지 않습니다." });
        }
        return { coordinates, distanceMeters, durationSeconds };
      } catch (error) {
        const aborted = signal.aborted;
        const mapped = aborted
          ? new ProviderError({
              kind: request.signal?.aborted === true ? "ABORTED" : "TIMEOUT",
              message: "Valhalla 요청이 취소되거나 시간 초과됐습니다.",
              retryable: request.signal?.aborted !== true,
              cause: error,
            })
          : error instanceof ProviderError
            ? error
            : new ProviderError({ kind: "UPSTREAM", message: "Valhalla 요청에 실패했습니다.", retryable: true, cause: error });
        lastError = mapped;
        if (!(mapped instanceof ProviderError) || !mapped.retryable || attempt === this.options.retryCount || aborted) throw mapped;
      }
    }
    throw lastError;
  }
}
