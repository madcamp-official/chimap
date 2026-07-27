import {
  coordinateSchema,
  type Coordinate,
  type Place,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import { z } from "zod";

import { ProviderError } from "../errors.js";

const NAVER_MAPS_BASE_URL =
  "https://maps.apigw.ntruss.com";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const geocodeResponseSchema = z
  .object({
    status: z.string(),
    addresses: z
      .array(
        z
          .object({
            roadAddress: z.string().default(""),
            jibunAddress: z.string().default(""),
            x: z.string(),
            y: z.string(),
            addressElements: z
              .array(
                z
                  .object({
                    types: z.array(z.string()).default([]),
                    longName: z.string().default(""),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const reverseAreaSchema = z
  .object({ name: z.string().default("") })
  .passthrough()
  .optional();

const reverseResultSchema = z
  .object({
    name: z.string(),
    region: z
      .object({
        area1: reverseAreaSchema,
        area2: reverseAreaSchema,
        area3: reverseAreaSchema,
        area4: reverseAreaSchema,
      })
      .passthrough(),
    land: z
      .object({
        name: z.string().default(""),
        number1: z.string().default(""),
        number2: z.string().default(""),
        addition0: z
          .object({ value: z.string().default("") })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const reverseResponseSchema = z
  .object({
    status: z
      .object({ code: z.number().int() })
      .passthrough(),
    results: z.array(reverseResultSchema).default([]),
  })
  .passthrough();

function stableId(prefix: string, values: string[]): string {
  return `${prefix}:${createHash("sha256")
    .update(values.join("\u001f"))
    .digest("hex")
    .slice(0, 24)}`;
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

function regionText(result: z.infer<typeof reverseResultSchema>): string {
  return [
    result.region.area1?.name,
    result.region.area2?.name,
    result.region.area3?.name,
    result.region.area4?.name,
  ]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");
}

function landText(result: z.infer<typeof reverseResultSchema>): string {
  const land = result.land;
  if (land === undefined) {
    return "";
  }
  const number = [land.number1, land.number2]
    .filter((value) => value.length > 0)
    .join("-");
  return [land.name, number].filter((value) => value.length > 0).join(" ");
}

export function normalizeNaverGeocodeResponse(
  payload: unknown,
  limit = 8,
): Place[] {
  const response = geocodeResponseSchema.parse(payload);
  if (response.status !== "OK") {
    throw new ProviderError({
      kind: "UPSTREAM",
      message: `NAVER Geocoding 상태 오류: ${response.status}`,
    });
  }
  return response.addresses
    .slice(0, Math.min(Math.max(limit, 1), 10))
    .flatMap((address) => {
      const location = coordinateSchema.safeParse({
        lng: Number(address.x),
        lat: Number(address.y),
      });
      if (!location.success) {
        return [];
      }
      const buildingName =
        address.addressElements.find((element) =>
          element.types.includes("BUILDING_NAME"),
        )?.longName ?? "";
      const name =
        buildingName.trim() ||
        address.roadAddress ||
        address.jibunAddress;
      if (name.length === 0) {
        return [];
      }
      return [
        {
          id: stableId("naver:address", [
            address.roadAddress,
            address.jibunAddress,
            address.x,
            address.y,
          ]),
          name,
          address: address.jibunAddress,
          roadAddress: address.roadAddress,
          category: "NAVER 주소",
          location: location.data,
        },
      ];
    });
}

export function normalizeNaverReverseGeocodeResponse(
  payload: unknown,
  coordinate: Coordinate,
): Place | null {
  const response = reverseResponseSchema.parse(payload);
  if (response.status.code !== 0) {
    throw new ProviderError({
      kind: "UPSTREAM",
      message: `NAVER Reverse Geocoding 상태 오류: ${response.status.code}`,
    });
  }
  const road = response.results.find((result) => result.name === "roadaddr");
  const lot = response.results.find((result) => result.name === "addr");
  const region = response.results.find(
    (result) => result.name === "admcode" || result.name === "legalcode",
  );
  const selected = road ?? lot ?? region;
  if (selected === undefined) {
    return null;
  }
  const roadAddress =
    road === undefined
      ? ""
      : [regionText(road), landText(road)].filter(Boolean).join(" ");
  const address =
    lot === undefined
      ? regionText(selected)
      : [regionText(lot), landText(lot)].filter(Boolean).join(" ");
  const building = road?.land?.addition0?.value?.trim() ?? "";
  const name = building || roadAddress || address;
  if (name.length === 0) {
    return null;
  }
  return {
    id: stableId("naver:address", [
      address,
      roadAddress,
      coordinate.lng.toFixed(6),
      coordinate.lat.toFixed(6),
    ]),
    name,
    address,
    roadAddress,
    category: "NAVER 주소",
    location: coordinate,
  };
}

export class NaverGeocodingClient {
  readonly #keyId: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;

  public constructor(
    keyId: string,
    key: string,
    fetchImplementation = fetch,
  ) {
    if (keyId.trim().length === 0 || key.trim().length === 0) {
      throw new Error("NAVER Maps API Key ID와 API Key가 필요합니다.");
    }
    this.#keyId = keyId;
    this.#key = key;
    this.#fetch = fetchImplementation;
  }

  async #requestJson(
    path: string,
    parameters: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = new URL(path, NAVER_MAPS_BASE_URL);
    url.search = parameters.toString();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(3000);
      const requestSignal =
        signal === undefined
          ? timeoutSignal
          : AbortSignal.any([signal, timeoutSignal]);
      try {
        const response = await this.#fetch(url, {
          headers: {
            Accept: "application/json",
            "x-ncp-apigw-api-key-id": this.#keyId,
            "x-ncp-apigw-api-key": this.#key,
          },
          signal: requestSignal,
        });
        if (response.ok) {
          return (await response.json()) as unknown;
        }
        if (RETRYABLE_STATUSES.has(response.status) && attempt === 0) {
          await delay(100 + Math.floor(Math.random() * 100), signal);
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError({
            kind: "CONFIGURATION",
            message:
              "NAVER Maps Geocoding 권한과 API Key ID/API Key를 확인해 주세요.",
          });
        }
        if (response.status === 429) {
          throw new ProviderError({
            kind: "RATE_LIMIT",
            message: "NAVER Maps API 사용량 한도를 초과했습니다.",
            retryable: true,
          });
        }
        throw new ProviderError({
          kind: "UPSTREAM",
          message: `NAVER Maps API HTTP ${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        if (signal?.aborted === true) {
          throw new ProviderError({
            kind: "ABORTED",
            message: "NAVER Maps 요청이 취소되었습니다.",
            cause: error,
          });
        }
        if (timeoutSignal.aborted) {
          if (attempt === 0) {
            continue;
          }
          throw new ProviderError({
            kind: "TIMEOUT",
            message: "NAVER Maps 요청 시간이 초과되었습니다.",
            retryable: true,
            cause: error,
          });
        }
        if (attempt === 0) {
          await delay(100 + Math.floor(Math.random() * 100), signal);
          continue;
        }
        throw new ProviderError({
          kind: "UPSTREAM",
          message: "NAVER Maps 네트워크 요청에 실패했습니다.",
          retryable: true,
          cause: error,
        });
      }
    }
    throw new ProviderError({
      kind: "UPSTREAM",
      message: "NAVER Maps 요청이 완료되지 않았습니다.",
    });
  }

  public async geocode(
    query: string,
    limit = 8,
    signal?: AbortSignal,
  ): Promise<Place[]> {
    return normalizeNaverGeocodeResponse(
      await this.#requestJson(
        "/map-geocode/v2/geocode",
        new URLSearchParams({
          query,
          count: String(Math.min(Math.max(limit, 1), 10)),
        }),
        signal,
      ),
      limit,
    );
  }

  public async reverseGeocode(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<Place | null> {
    return normalizeNaverReverseGeocodeResponse(
      await this.#requestJson(
        "/map-reversegeocode/v2/gc",
        new URLSearchParams({
          coords: `${coordinate.lng},${coordinate.lat}`,
          sourcecrs: "EPSG:4326",
          targetcrs: "EPSG:4326",
          orders: "roadaddr,addr,admcode,legalcode",
          output: "json",
        }),
        signal,
      ),
      coordinate,
    );
  }
}
