import { createHash, timingSafeEqual } from "node:crypto";

import {
  parkRouteSnapshotSchema,
  type ParkRouteSnapshot,
} from "@chimap/contracts";

import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ParkRouteRepository } from "./park-route-repository.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function calculateParkRouteDatasetChecksum(
  snapshot: Omit<ParkRouteSnapshot, "datasetChecksum">,
): string {
  return createHash("sha256").update(stableJson(snapshot)).digest("hex");
}

export class ParkRouteImportService {
  public constructor(
    private readonly config: AppConfig["parkRoutes"],
    private readonly repository: ParkRouteRepository,
  ) {}

  public authenticate(token: string | undefined): void {
    if (!this.config.importEnabled) {
      throw new AppError({
        code: "SERVICE_NOT_READY",
        message: "공원 경로 Import API가 비활성 상태입니다.",
        status: 503,
      });
    }
    const expected = this.config.importToken;
    if (token === undefined || expected === undefined) {
      throw new AppError({
        code: "PARK_IMPORT_UNAUTHORIZED",
        message: "유효한 공원 경로 Import token이 필요합니다.",
        status: 401,
      });
    }
    const suppliedBuffer = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    const valid =
      suppliedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!valid) {
      throw new AppError({
        code: "PARK_IMPORT_UNAUTHORIZED",
        message: "유효한 공원 경로 Import token이 필요합니다.",
        status: 401,
      });
    }
  }

  public async import(input: {
    body: unknown;
    idempotencyKey: string | undefined;
  }) {
    const snapshot = parkRouteSnapshotSchema.parse(input.body);
    if (input.idempotencyKey !== snapshot.datasetId) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Idempotency-Key와 datasetId가 일치해야 합니다.",
        status: 400,
      });
    }
    const { datasetChecksum: _declaredChecksum, ...checksumInput } =
      snapshot;
    const calculatedChecksum =
      calculateParkRouteDatasetChecksum(checksumInput);
    if (calculatedChecksum !== snapshot.datasetChecksum) {
      throw new AppError({
        code: "PARK_ROUTE_NOT_DEPLOYABLE",
        message: "datasetChecksum 검증에 실패했습니다.",
        status: 422,
      });
    }
    try {
      return {
        snapshot,
        result: await this.repository.importSnapshot(snapshot),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PARK_DATASET_CONFLICT"
      ) {
        throw new AppError({
          code: "PARK_DATASET_CONFLICT",
          message: "동일 datasetId에 다른 checksum이 이미 존재합니다.",
          status: 409,
          cause: error,
        });
      }
      throw error;
    }
  }
}
