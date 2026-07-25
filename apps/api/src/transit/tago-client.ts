import {
  haversineDistanceMeters,
  type BusArrival,
  type BusRoute,
  type BusRouteStop,
  type BusStop,
  type BusVehiclePosition,
  type Coordinate,
} from "@chimap/contracts";

import type {
  AppConfig,
  TagoServiceKind,
} from "../config.js";

type JsonRecord = Record<string, unknown>;
type TagoParameters = Record<
  string,
  string | number | boolean | null | undefined
>;

type TagoResponsePage = {
  items: JsonRecord[];
  totalCount: number;
  resultCode: string;
};

export type TagoCityCode = {
  cityCode: string;
  cityName: string;
};

const SERVICE_PATHS: Record<TagoServiceKind, string> = {
  stop: "BusSttnInfoInqireService",
  route: "BusRouteInfoInqireService",
  arrival: "ArvlInfoInqireService",
  location: "BusLcInfoInqireService",
};

const SUCCESS_RESULT_CODES = new Set(["00", "0", "0000"]);
const RETRYABLE_HTTP_STATUSES = new Set([500, 502, 503, 504]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeItems<T>(
  item: T | T[] | null | undefined,
): T[] {
  if (item === null || item === undefined) {
    return [];
  }
  return Array.isArray(item) ? item : [item];
}

function rawValue(item: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function textValue(
  item: JsonRecord,
  ...keys: string[]
): string | undefined {
  const value = rawValue(item, ...keys);
  if (value === undefined) {
    return undefined;
  }
  const result = String(value).trim();
  return result.length === 0 ? undefined : result;
}

function numberValue(
  item: JsonRecord,
  ...keys: string[]
): number | undefined {
  const value = rawValue(item, ...keys);
  if (value === undefined) {
    return undefined;
  }
  const result =
    typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(result) ? result : undefined;
}

function integerValue(
  item: JsonRecord,
  ...keys: string[]
): number | undefined {
  const value = numberValue(item, ...keys);
  return value === undefined ? undefined : Math.max(0, Math.round(value));
}

function nullableText(item: JsonRecord, ...keys: string[]): string | null {
  return textValue(item, ...keys) ?? null;
}

function nullablePositiveInteger(
  item: JsonRecord,
  ...keys: string[]
): number | null {
  const value = integerValue(item, ...keys);
  return value === undefined || value <= 0 ? null : value;
}

function requireText(
  item: JsonRecord,
  fieldName: string,
  ...keys: string[]
): string {
  const value = textValue(item, ...keys);
  if (value === undefined) {
    throw new Error(`TAGO 응답에 ${fieldName} 필드가 없습니다.`);
  }
  return value;
}

function requireCoordinate(
  item: JsonRecord,
  fieldName: string,
  ...keys: string[]
): number {
  const value = numberValue(item, ...keys);
  if (value === undefined) {
    throw new Error(`TAGO 응답에 ${fieldName} 좌표가 없습니다.`);
  }
  return value;
}

function operationTimestamp(): string {
  return new Date().toISOString();
}

function encodedServiceKey(key: string): string {
  return /%[0-9a-f]{2}/iu.test(key) ? key : encodeURIComponent(key);
}

function redactedMessage(message: string, secrets: string[]): string {
  let safe = message.replace(/serviceKey=[^&\s]+/giu, "serviceKey=[REDACTED]");
  for (const secret of secrets) {
    if (secret.length > 0) {
      safe = safe.split(secret).join("[REDACTED]");
      try {
        safe = safe.split(decodeURIComponent(secret)).join("[REDACTED]");
      } catch {
        // 이미 decoding key인 경우 그대로 비교한 결과만 사용한다.
      }
    }
  }
  return safe.slice(0, 500);
}

export class TagoApiError extends Error {
  public readonly service: TagoServiceKind;
  public readonly operation: string;
  public readonly resultCode: string;
  public readonly safeMessage: string;
  public readonly retryable: boolean;
  public readonly occurredAt: string;

  public constructor(options: {
    service: TagoServiceKind;
    operation: string;
    resultCode: string;
    safeMessage: string;
    retryable: boolean;
    cause?: unknown;
  }) {
    super(options.safeMessage, { cause: options.cause });
    this.name = "TagoApiError";
    this.service = options.service;
    this.operation = options.operation;
    this.resultCode = options.resultCode;
    this.safeMessage = options.safeMessage;
    this.retryable = options.retryable;
    this.occurredAt = operationTimestamp();
  }
}

export function parseTagoResponsePage(
  input: unknown,
  context: {
    service: TagoServiceKind;
    operation: string;
    secrets?: string[];
  },
): TagoResponsePage {
  const outer = isRecord(input) ? input : {};
  const response = isRecord(outer.response) ? outer.response : outer;
  const header = isRecord(response.header) ? response.header : {};
  const body = isRecord(response.body) ? response.body : {};
  const resultCode = String(header.resultCode ?? "").trim();
  const resultMessage = String(header.resultMsg ?? "TAGO API 오류").trim();

  if (!SUCCESS_RESULT_CODES.has(resultCode)) {
    throw new TagoApiError({
      service: context.service,
      operation: context.operation,
      resultCode: resultCode || "INVALID_RESPONSE",
      safeMessage: redactedMessage(
        resultMessage || "TAGO API가 오류를 반환했습니다.",
        context.secrets ?? [],
      ),
      retryable: false,
    });
  }

  const itemsContainer = body.items;
  const item = isRecord(itemsContainer)
    ? itemsContainer.item
    : itemsContainer === "" || itemsContainer === null
      ? undefined
      : itemsContainer;
  const items = normalizeItems(item).filter(isRecord);
  const parsedTotalCount = Number(body.totalCount ?? items.length);

  return {
    items,
    totalCount: Number.isFinite(parsedTotalCount)
      ? Math.max(0, Math.round(parsedTotalCount))
      : items.length,
    resultCode,
  };
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

export class TagoClient {
  readonly #config: AppConfig;
  readonly #fetch: typeof fetch;

  public constructor(config: AppConfig, fetchImplementation = fetch) {
    this.#config = config;
    this.#fetch = fetchImplementation;
  }

  public hasServiceKey(service: TagoServiceKind): boolean {
    return (
      this.#config.tagoServiceKeys[service] !== undefined ||
      this.#config.dataGoKrServiceKey !== undefined
    );
  }

  #serviceKey(service: TagoServiceKind, operation: string): string {
    const key =
      this.#config.tagoServiceKeys[service] ??
      this.#config.dataGoKrServiceKey;
    if (key === undefined) {
      throw new TagoApiError({
        service,
        operation,
        resultCode: "CONFIGURATION_ERROR",
        safeMessage: `${service} TAGO 서비스 인증키가 설정되지 않았습니다.`,
        retryable: false,
      });
    }
    return key;
  }

  #buildUrl(
    service: TagoServiceKind,
    operation: string,
    parameters: TagoParameters,
    key: string,
  ): string {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null) {
        search.set(name, String(value));
      }
    }
    search.set("_type", this.#config.tagoResponseType);
    const suffix = search.toString();
    return `${this.#config.tagoBaseUrl}/${SERVICE_PATHS[service]}/${operation}?serviceKey=${encodedServiceKey(key)}${suffix.length === 0 ? "" : `&${suffix}`}`;
  }

  async #requestPage(
    service: TagoServiceKind,
    operation: string,
    parameters: TagoParameters,
    signal?: AbortSignal,
  ): Promise<TagoResponsePage> {
    const key = this.#serviceKey(service, operation);
    const url = this.#buildUrl(service, operation, parameters, key);
    const maxAttempts = this.#config.tagoHttpRetryCount + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(
        this.#config.tagoHttpTimeoutMs,
      );
      const requestSignal =
        signal === undefined
          ? timeoutSignal
          : AbortSignal.any([signal, timeoutSignal]);
      try {
        const response = await this.#fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: requestSignal,
        });
        if (!response.ok) {
          const retryable = RETRYABLE_HTTP_STATUSES.has(response.status);
          if (retryable && attempt + 1 < maxAttempts) {
            await delay(100 * 2 ** attempt, signal);
            continue;
          }
          throw new TagoApiError({
            service,
            operation,
            resultCode: `HTTP_${response.status}`,
            safeMessage: `TAGO API HTTP ${response.status} 오류`,
            retryable,
          });
        }

        let payload: unknown;
        try {
          payload = (await response.json()) as unknown;
        } catch (error) {
          throw new TagoApiError({
            service,
            operation,
            resultCode: "INVALID_JSON",
            safeMessage: "TAGO API가 JSON이 아닌 응답을 반환했습니다.",
            retryable: false,
            cause: error,
          });
        }
        return parseTagoResponsePage(payload, {
          service,
          operation,
          secrets: [key, encodedServiceKey(key)],
        });
      } catch (error) {
        if (error instanceof TagoApiError) {
          throw error;
        }
        if (signal?.aborted === true) {
          throw new TagoApiError({
            service,
            operation,
            resultCode: "ABORTED",
            safeMessage: "TAGO API 요청이 취소되었습니다.",
            retryable: false,
            cause: error,
          });
        }
        if (attempt + 1 < maxAttempts) {
          await delay(100 * 2 ** attempt, signal);
          continue;
        }
        const timedOut = timeoutSignal.aborted;
        throw new TagoApiError({
          service,
          operation,
          resultCode: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
          safeMessage: timedOut
            ? "TAGO API 요청 시간이 초과되었습니다."
            : "TAGO API 네트워크 요청에 실패했습니다.",
          retryable: true,
          cause: error,
        });
      }
    }

    throw new TagoApiError({
      service,
      operation,
      resultCode: "UNKNOWN",
      safeMessage: "TAGO API 요청을 완료하지 못했습니다.",
      retryable: false,
    });
  }

  async #requestAllPages(
    service: TagoServiceKind,
    operation: string,
    parameters: TagoParameters,
    signal?: AbortSignal,
  ): Promise<JsonRecord[]> {
    const numOfRows = 1000;
    const first = await this.#requestPage(
      service,
      operation,
      { ...parameters, pageNo: 1, numOfRows },
      signal,
    );
    const result = [...first.items];
    const pageCount = Math.min(100, Math.ceil(first.totalCount / numOfRows));
    for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
      const page = await this.#requestPage(
        service,
        operation,
        { ...parameters, pageNo, numOfRows },
        signal,
      );
      result.push(...page.items);
    }
    return result;
  }

  public async getCityCodes(
    service: TagoServiceKind = "stop",
    signal?: AbortSignal,
  ): Promise<TagoCityCode[]> {
    const items = await this.#requestAllPages(
      service,
      "getCtyCodeList",
      {},
      signal,
    );
    return items.flatMap((item) => {
      const cityCode = textValue(item, "citycode", "cityCode");
      const cityName = textValue(item, "cityname", "cityName");
      return cityCode === undefined || cityName === undefined
        ? []
        : [{ cityCode, cityName }];
    });
  }

  public async getNearbyStops(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<BusStop[]> {
    const items = await this.#requestAllPages(
      "stop",
      "getCrdntPrxmtSttnList",
      {
        gpsLati: coordinate.lat,
        gpsLong: coordinate.lng,
      },
      signal,
    );
    return items
      .map((item): BusStop => {
        const cityCode = requireText(
          item,
          "도시코드",
          "citycode",
          "cityCode",
        );
        const nodeId = requireText(
          item,
          "정류소 ID",
          "nodeid",
          "nodeId",
        );
        const latitude = requireCoordinate(
          item,
          "위도",
          "gpslati",
          "gpsLati",
        );
        const longitude = requireCoordinate(
          item,
          "경도",
          "gpslong",
          "gpsLong",
        );
        return {
          id: `${cityCode}:${nodeId}`,
          cityCode,
          nodeId,
          sourceStopNo: null,
          arsId: nullableText(item, "arsno", "arsId", "nodeno"),
          name: requireText(item, "정류소명", "nodenm", "nodeNm"),
          latitude,
          longitude,
          distanceMeters: Math.round(
            haversineDistanceMeters(coordinate, {
              lat: latitude,
              lng: longitude,
            }),
          ),
          source: "tago",
        };
      })
      .sort(
        (first, second) =>
          (first.distanceMeters ?? 0) - (second.distanceMeters ?? 0),
      );
  }

  public async getRoutesByStop(
    cityCode: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<BusRoute[]> {
    const items = await this.#requestAllPages(
      "stop",
      "getSttnThrghRouteList",
      { cityCode, nodeId },
      signal,
    );
    return items.map((item) =>
      this.#mapRoute(item, cityCode, "tago"),
    );
  }

  public async getRouteList(
    cityCode: string,
    routeNo?: string,
    signal?: AbortSignal,
  ): Promise<BusRoute[]> {
    const items = await this.#requestAllPages(
      "route",
      "getRouteNoList",
      { cityCode, routeNo },
      signal,
    );
    return items.map((item) =>
      this.#mapRoute(item, cityCode, "tago"),
    );
  }

  public async getRouteInfo(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusRoute> {
    const page = await this.#requestPage(
      "route",
      "getRouteInfoIem",
      { cityCode, routeId },
      signal,
    );
    const item = page.items[0];
    if (item === undefined) {
      throw new TagoApiError({
        service: "route",
        operation: "getRouteInfoIem",
        resultCode: "EMPTY_RESULT",
        safeMessage: "TAGO에서 노선 기본정보를 찾지 못했습니다.",
        retryable: false,
      });
    }
    return this.#mapRoute(item, cityCode, "tago");
  }

  #mapRoute(
    item: JsonRecord,
    cityCode: string,
    source: "tago" | "database",
  ): BusRoute {
    const routeId = requireText(
      item,
      "노선 ID",
      "routeid",
      "routeId",
    );
    const routeNo = requireText(
      item,
      "노선번호",
      "routeno",
      "routeNo",
      "routenm",
    );
    return {
      id: `${cityCode}:${routeId}`,
      cityCode,
      routeId,
      routeNo,
      routeName:
        textValue(item, "routenm", "routeName", "routeno") ?? routeNo,
      routeType: nullableText(item, "routetp", "routeType"),
      startStopName: nullableText(item, "startnodenm", "startNodeName"),
      endStopName: nullableText(item, "endnodenm", "endNodeName"),
      firstBusTime: nullableText(item, "startvehicletime", "firstBusTime"),
      lastBusTime: nullableText(item, "endvehicletime", "lastBusTime"),
      weekdayIntervalMinutes: nullablePositiveInteger(
        item,
        "intervaltime",
        "weekdayIntervalMinutes",
      ),
      weekendIntervalMinutes: nullablePositiveInteger(
        item,
        "intervalsattime",
        "intervalsuntime",
        "weekendIntervalMinutes",
      ),
      source,
    };
  }

  public async getRouteStops(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusRouteStop[]> {
    const items = await this.#requestAllPages(
      "route",
      "getRouteAcctoThrghSttnList",
      { cityCode, routeId },
      signal,
    );
    return items
      .map((item, index): BusRouteStop => {
        const nodeId = requireText(
          item,
          "정류소 ID",
          "nodeid",
          "nodeId",
        );
        return {
          routeId,
          stopId: `${cityCode}:${nodeId}`,
          nodeId,
          cityCode,
          stopName: requireText(
            item,
            "정류소명",
            "nodenm",
            "nodeName",
          ),
          latitude: requireCoordinate(
            item,
            "위도",
            "gpslati",
            "gpsLati",
          ),
          longitude: requireCoordinate(
            item,
            "경도",
            "gpslong",
            "gpsLong",
          ),
          nodeOrder:
            integerValue(item, "nodeord", "nodeOrder") ?? index + 1,
          direction: nullableText(item, "updowncd", "direction"),
        };
      })
      .sort((first, second) => first.nodeOrder - second.nodeOrder);
  }

  public async getArrivals(
    cityCode: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    return this.#getArrivalsByOperation(
      "getSttnAcctoArvlPrearngeInfoList",
      cityCode,
      nodeId,
      undefined,
      signal,
    );
  }

  public async getArrivalsForRoute(
    cityCode: string,
    nodeId: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    return this.#getArrivalsByOperation(
      "getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList",
      cityCode,
      nodeId,
      routeId,
      signal,
    );
  }

  async #getArrivalsByOperation(
    operation: string,
    cityCode: string,
    nodeId: string,
    routeId?: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    const fetchedAt = operationTimestamp();
    const items = await this.#requestAllPages(
      "arrival",
      operation,
      { cityCode, nodeId, routeId },
      signal,
    );
    return items.flatMap((item): BusArrival[] => {
      const itemRouteId = textValue(item, "routeid", "routeId");
      const routeNo = textValue(item, "routeno", "routeNo");
      const arrivalSeconds = integerValue(
        item,
        "arrtime",
        "arrivalSeconds",
      );
      if (
        itemRouteId === undefined ||
        routeNo === undefined ||
        arrivalSeconds === undefined
      ) {
        return [];
      }
      return [
        {
          cityCode,
          nodeId,
          routeId: itemRouteId,
          routeNo,
          routeType: nullableText(item, "routetp", "routeType"),
          remainingStops:
            integerValue(
              item,
              "arrprevstationcnt",
              "remainingStops",
            ) ?? null,
          arrivalSeconds,
          arrivalMinutes: Math.ceil(arrivalSeconds / 60),
          vehicleType: nullableText(item, "vehicletp", "vehicleType"),
          isRealtime: true,
          fetchedAt,
        },
      ];
    });
  }

  public async getVehiclePositions(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusVehiclePosition[]> {
    const fetchedAt = operationTimestamp();
    const items = await this.#requestAllPages(
      "location",
      "getRouteAcctoBusLcList",
      { cityCode, routeId },
      signal,
    );
    return items.flatMap((item): BusVehiclePosition[] => {
      const latitude = numberValue(item, "gpslati", "gpsLati");
      const longitude = numberValue(item, "gpslong", "gpsLong");
      if (latitude === undefined || longitude === undefined) {
        return [];
      }
      return [
        {
          cityCode,
          routeId,
          routeNo:
            textValue(item, "routenm", "routeno", "routeNo") ?? routeId,
          vehicleNo: nullableText(item, "vehicleno", "vehicleNo"),
          latitude,
          longitude,
          nodeId: nullableText(item, "nodeid", "nodeId"),
          nodeName: nullableText(item, "nodenm", "nodeName"),
          nodeOrder:
            integerValue(item, "nodeord", "nodeOrder") ?? null,
          routeType: nullableText(item, "routetp", "routeType"),
          fetchedAt,
        },
      ];
    });
  }
}
