import { ProviderError } from "../errors.js";

const KAKAO_BASE_URL = "https://dapi.kakao.com";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export type KakaoRequestOptions = {
  timeoutMilliseconds: number;
  signal?: AbortSignal;
};

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

  public constructor(restApiKey: string, fetchImplementation = fetch) {
    if (restApiKey.trim().length === 0) {
      throw new Error("Kakao REST API 키가 필요합니다.");
    }
    this.#restApiKey = restApiKey;
    this.#fetch = fetchImplementation;
  }

  public async requestJson(
    path: string,
    parameters: URLSearchParams,
    options: KakaoRequestOptions,
  ): Promise<unknown> {
    const url = new URL(path, KAKAO_BASE_URL);
    url.search = parameters.toString();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(options.timeoutMilliseconds);
      const signal =
        options.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      try {
        const response = await this.#fetch(url, {
          method: "GET",
          headers: {
            Authorization: `KakaoAK ${this.#restApiKey}`,
            Accept: "application/json",
          },
          signal,
        });

        if (response.ok) {
          return (await response.json()) as unknown;
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
          });
        }
        if (response.status === 429) {
          throw new ProviderError({
            kind: "RATE_LIMIT",
            message: "Kakao API 사용량 한도를 초과했습니다.",
            retryable: true,
          });
        }
        throw new ProviderError({
          kind: "UPSTREAM",
          message: `Kakao API HTTP ${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        if (options.signal?.aborted === true) {
          throw new ProviderError({
            kind: "ABORTED",
            message: "Kakao 요청이 취소되었습니다.",
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
  }
}
