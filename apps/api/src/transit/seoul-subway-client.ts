import { get as httpGet } from "node:http";

import type { AppConfig } from "../config.js";

type JsonRecord = Record<string, unknown>;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type JsonHttpResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
};

function nodeHttpJsonRequest(
  url: string,
  signal: AbortSignal,
): Promise<JsonHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        Connection: "close",
        "User-Agent": "CHIMap/1.0",
      },
      signal,
    }, (response) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("서울 지하철 API 응답이 너무 큽니다."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("error", reject);
      response.on("end", () => {
        const ok = response.statusCode !== undefined &&
          response.statusCode >= 200 && response.statusCode < 300;
        try {
          resolve({
            ok,
            status: response.statusCode ?? 0,
            payload: ok
              ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
              : undefined,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

export type SeoulSubwayArrival = {
  subwayId: string;
  stationId: string;
  stationName: string;
  directionName: string;
  trainLineName: string;
  remainingSeconds: number;
  receivedAt: string;
  arrivalMessage: string;
  trainNo: string | null;
  trainStatus: string | null;
};

export type SeoulSubwayPosition = {
  subwayId: string;
  stationId: string;
  stationName: string;
  trainNo: string;
  directionName: string;
  destinationName: string | null;
  trainStatus: string | null;
  expressCode: string | null;
  lastTrainCode: string | null;
  receivedAt: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  const result = String(value).trim();
  return result.length === 0 ? undefined : result;
}

function kstTimestamp(value: string): number | null {
  const normalized = value.trim().replace(" ", "T");
  const timestamp = Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/u.test(normalized)
      ? normalized
      : `${normalized}+09:00`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function adjustedSeoulWaitSeconds(
  rawSeconds: number,
  receivedAt: string,
  now: Date,
): number {
  const received = kstTimestamp(receivedAt);
  const ageSeconds =
    received === null
      ? 0
      : Math.max(0, Math.floor((now.getTime() - received) / 1_000));
  return Math.max(0, Math.round(rawSeconds) - ageSeconds);
}

export class SeoulSubwayApiError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "SeoulSubwayApiError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class SeoulSubwayClient {
  readonly #config: AppConfig["seoulSubway"];
  readonly #fetch: typeof fetch | undefined;
  #quotaDate = "";
  #requestCount = 0;

  public constructor(config: AppConfig, fetchImplementation?: typeof fetch) {
    this.#config = config.seoulSubway;
    this.#fetch = fetchImplementation;
  }

  public get enabled(): boolean {
    return this.#config.enabled && this.#config.apiKey !== undefined;
  }

  #consumeRequestQuota(): void {
    const quotaDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (this.#quotaDate !== quotaDate) {
      this.#quotaDate = quotaDate;
      this.#requestCount = 0;
    }
    if (this.#requestCount >= this.#config.dailyRequestLimit) {
      throw new SeoulSubwayApiError(
        "DAILY_REQUEST_LIMIT",
        "서울 지하철 API 일일 요청 한도에 도달했습니다.",
        false,
      );
    }
    this.#requestCount += 1;
  }

  async #request(
    operation: "realtimeStationArrival" | "realtimePosition",
    query: string,
    end: number,
    signal?: AbortSignal,
  ): Promise<JsonRecord[]> {
    if (!this.enabled || this.#config.apiKey === undefined) {
      throw new SeoulSubwayApiError(
        "CONFIGURATION_ERROR",
        "서울 지하철 실시간 API가 활성화되지 않았습니다.",
        false,
      );
    }
    const path = [
      "api",
      "subway",
      encodeURIComponent(this.#config.apiKey),
      "json",
      operation,
      "0",
      String(end),
      encodeURIComponent(query),
    ].join("/");
    const url = `${this.#config.baseUrl}/${path}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeout = AbortSignal.timeout(this.#config.timeoutMs);
      const requestSignal = signal === undefined
        ? timeout
        : AbortSignal.any([signal, timeout]);
      try {
        this.#consumeRequestQuota();
        const response = this.#fetch !== undefined ||
            new URL(url).protocol === "https:"
          ? await (this.#fetch ?? fetch)(url, {
              headers: { Accept: "application/json" },
              signal: requestSignal,
              redirect: "error",
              cache: "no-store",
              referrerPolicy: "no-referrer",
            }).then(async (result): Promise<JsonHttpResponse> => {
              const response: JsonHttpResponse = {
                ok: result.ok,
                status: result.status,
                payload: undefined,
              };
              if (result.ok) {
                response.payload = await result.json() as unknown;
              }
              return response;
            })
          : await nodeHttpJsonRequest(url, requestSignal);
        if (!response.ok) {
          const retryable = response.status >= 500;
          if (retryable && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
            continue;
          }
          throw new SeoulSubwayApiError(
            `HTTP_${response.status}`,
            `서울 지하철 API HTTP ${response.status} 오류`,
            retryable,
          );
        }
        const payload = response.payload;
        if (!isRecord(payload)) {
          throw new SeoulSubwayApiError(
            "INVALID_RESPONSE",
            "서울 지하철 API 응답 형식이 올바르지 않습니다.",
            false,
          );
        }
        const status = isRecord(payload.errorMessage)
          ? textValue(payload.errorMessage, "status")
          : undefined;
        if (status !== undefined && status !== "200") {
          throw new SeoulSubwayApiError(
            textValue(payload.errorMessage as JsonRecord, "code") ?? "API_ERROR",
            "서울 지하철 API가 오류를 반환했습니다.",
            status === "500",
          );
        }
        const list = payload[
          operation === "realtimeStationArrival"
            ? "realtimeArrivalList"
            : "realtimePositionList"
        ];
        return Array.isArray(list) ? list.filter(isRecord) : [];
      } catch (error) {
        if (error instanceof SeoulSubwayApiError) {
          if (error.retryable && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
            continue;
          }
          throw error;
        }
        if (signal?.aborted === true) {
          throw new SeoulSubwayApiError(
            "ABORTED",
            "서울 지하철 API 요청이 취소되었습니다.",
            false,
          );
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
          continue;
        }
        throw new SeoulSubwayApiError(
          timeout.aborted ? "TIMEOUT" : "NETWORK_ERROR",
          timeout.aborted
            ? "서울 지하철 API 요청 시간이 초과되었습니다."
            : "서울 지하철 API 네트워크 요청에 실패했습니다.",
          true,
        );
      }
    }
    return [];
  }

  public async getArrivals(
    stationName: string,
    signal?: AbortSignal,
  ): Promise<SeoulSubwayArrival[]> {
    const rows = await this.#request(
      "realtimeStationArrival",
      stationName,
      20,
      signal,
    );
    return rows.flatMap((row): SeoulSubwayArrival[] => {
      const subwayId = textValue(row, "subwayId");
      const stationId = textValue(row, "statnId");
      const parsedStationName = textValue(row, "statnNm");
      const directionName = textValue(row, "updnLine");
      const trainLineName = textValue(row, "trainLineNm");
      const receivedAt = textValue(row, "recptnDt");
      const seconds = Number(textValue(row, "barvlDt"));
      if (
        subwayId === undefined || stationId === undefined ||
        parsedStationName === undefined || directionName === undefined ||
        trainLineName === undefined || receivedAt === undefined ||
        !Number.isFinite(seconds)
      ) {
        return [];
      }
      return [{
        subwayId,
        stationId,
        stationName: parsedStationName,
        directionName,
        trainLineName,
        remainingSeconds: Math.max(0, Math.round(seconds)),
        receivedAt,
        arrivalMessage: textValue(row, "arvlMsg2") ?? "",
        trainNo: textValue(row, "btrainNo") ?? null,
        trainStatus: textValue(row, "btrainSttus") ?? null,
      }];
    });
  }

  public async getPositions(
    lineName: string,
    signal?: AbortSignal,
  ): Promise<SeoulSubwayPosition[]> {
    const rows = await this.#request("realtimePosition", lineName, 200, signal);
    return rows.flatMap((row): SeoulSubwayPosition[] => {
      const subwayId = textValue(row, "subwayId");
      const stationId = textValue(row, "statnId");
      const stationName = textValue(row, "statnNm");
      const trainNo = textValue(row, "trainNo");
      const directionName = textValue(row, "updnLine");
      const receivedAt = textValue(row, "recptnDt");
      if (
        subwayId === undefined || stationId === undefined ||
        stationName === undefined || trainNo === undefined ||
        directionName === undefined || receivedAt === undefined
      ) {
        return [];
      }
      return [{
        subwayId,
        stationId,
        stationName,
        trainNo,
        directionName,
        destinationName: textValue(row, "statnTnm") ?? null,
        trainStatus: textValue(row, "trainSttus") ?? null,
        expressCode: textValue(row, "directAt") ?? null,
        lastTrainCode: textValue(row, "lstcarAt") ?? null,
        receivedAt,
      }];
    });
  }
}
