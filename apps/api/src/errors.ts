import type { ErrorCode } from "@chimap/contracts";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly fieldErrors?: Record<string, string[]>;

  public constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    cause?: unknown;
    fieldErrors?: Record<string, string[]>;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = options.status;
    if (options.fieldErrors !== undefined) {
      this.fieldErrors = options.fieldErrors;
    }
  }
}

export type ProviderErrorKind =
  | "NO_ROUTE"
  | "NO_NEARBY_TRANSIT_STOP"
  | "NO_TRANSIT_CONNECTION"
  | "INVALID_LOCATION"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "UPSTREAM"
  | "CONFIGURATION"
  | "UNSUPPORTED_CITY"
  | "ABORTED";

export class ProviderError extends Error {
  public readonly kind: ProviderErrorKind;
  public readonly retryable: boolean;

  public constructor(options: {
    kind: ProviderErrorKind;
    message: string;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
  }
}

export function mapProviderError(error: ProviderError): AppError {
  switch (error.kind) {
    case "NO_NEARBY_TRANSIT_STOP":
      return new AppError({
        code: "NO_TRANSIT_ROUTE",
        message:
          "출발지 또는 목적지 주변에서 운행 노선이 있는 버스 정류장을 찾지 못했어요. 장소의 정문이나 도로명 주소를 선택해 주세요.",
        status: 404,
        cause: error,
      });
    case "NO_TRANSIT_CONNECTION":
      return new AppError({
        code: "NO_TRANSIT_ROUTE",
        message:
          "주변 운행 정류장은 찾았지만 직행 또는 1회 환승으로 연결되는 경로가 없어요.",
        status: 404,
        cause: error,
      });
    case "NO_ROUTE":
      return new AppError({
        code: "NO_TRANSIT_ROUTE",
        message: "출발지와 목적지 사이의 대중교통 경로를 찾지 못했어요.",
        status: 404,
        cause: error,
      });
    case "INVALID_LOCATION":
      return new AppError({
        code: "INVALID_LOCATION",
        message: "출발지 또는 목적지 주변에서 경로를 찾을 수 없어요.",
        status: 400,
        cause: error,
      });
    case "TIMEOUT":
      return new AppError({
        code: "UPSTREAM_TIMEOUT",
        message: "외부 경로 조회 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.",
        status: 504,
        cause: error,
      });
    case "RATE_LIMIT":
      return new AppError({
        code: "UPSTREAM_RATE_LIMIT",
        message: "외부 지도 서비스 사용량이 많아요. 잠시 후 다시 시도해 주세요.",
        status: 429,
        cause: error,
      });
    case "ABORTED":
      return new AppError({
        code: "UPSTREAM_TIMEOUT",
        message: "경로 조회 요청이 취소됐어요.",
        status: 408,
        cause: error,
      });
    case "CONFIGURATION":
      return new AppError({
        code: "SERVICE_NOT_READY",
        message: error.message,
        status: 503,
        cause: error,
      });
    case "UNSUPPORTED_CITY":
      return new AppError({
        code: "UNSUPPORTED_CITY",
        message: error.message,
        status: 422,
        cause: error,
      });
    case "UPSTREAM":
      return new AppError({
        code: "UPSTREAM_ERROR",
        message: "외부 지도 서비스에서 경로를 불러오지 못했어요.",
        status: 502,
        cause: error,
      });
  }
}
