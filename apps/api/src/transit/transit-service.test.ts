import type { BusStop } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { TagoApiError, type TagoClient } from "./tago-client.js";
import type { TransitRepository } from "./transit-repository.js";
import { TransitService } from "./transit-service.js";

const kaistNorthGate: BusStop = {
  id: "46278",
  cityCode: "25",
  nodeId: "DJB8007520",
  sourceStopNo: "DJB8007520",
  arsId: "41620",
  name: "한국과학기술원북문",
  latitude: 36.3751,
  longitude: 127.363884,
  distanceMeters: 441,
  source: "csv",
};

const kaistMainBuilding: BusStop = {
  id: "46284",
  cityCode: null,
  nodeId: null,
  sourceStopNo: "DJB8007527",
  arsId: null,
  name: "한국과학기술원본관",
  latitude: 36.37007,
  longitude: 127.360664,
  distanceMeters: 249,
  source: "csv",
};

const linkedMainBuilding: BusStop = {
  ...kaistMainBuilding,
  id: "25:DJB8007527",
  cityCode: "25",
  nodeId: "DJB8007527",
  sourceStopNo: null,
  source: "tago",
};

function serviceWith(input: {
  databaseStops: BusStop[];
  providerStops?: BusStop[];
  providerError?: Error;
}) {
  const getNearbyStops =
    input.providerError === undefined
      ? vi.fn().mockResolvedValue(input.providerStops ?? [])
      : vi.fn().mockRejectedValue(input.providerError);
  const repository = {
    findNearbyStops: vi.fn().mockResolvedValue(input.databaseStops),
    reconcileTagoStop: vi.fn(async (stop: BusStop) => ({
      status: "matched" as const,
      stop,
    })),
  } as unknown as TransitRepository;
  const client = {
    getNearbyStops,
  } as unknown as TagoClient;
  const config = loadConfig({ NODE_ENV: "test" });
  return {
    getNearbyStops,
    repository,
    service: new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client,
    }),
  };
}

describe("TransitService 주변 정류장 보강", () => {
  it("연결된 정류장이 일부 있어도 TAGO를 조회해 나머지 정류장을 연결한다", async () => {
    const context = serviceWith({
      databaseStops: [kaistMainBuilding, kaistNorthGate],
      providerStops: [linkedMainBuilding, kaistNorthGate],
    });

    const result = await context.service.getNearbyStops(
      { lat: 36.3723, lng: 127.3604 },
      500,
    );

    expect(context.getNearbyStops).toHaveBeenCalledOnce();
    expect(context.repository.reconcileTagoStop).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.items.map((stop) => stop.nodeId)).toEqual([
      "DJB8007527",
      "DJB8007520",
    ]);
  });

  it("TAGO가 일시 실패하면 기존 실제 정류장을 유지하고 일부 결과임을 표시한다", async () => {
    const context = serviceWith({
      databaseStops: [kaistNorthGate],
      providerError: new TagoApiError({
        service: "stop",
        operation: "getCrdntPrxmtSttnList",
        resultCode: "HTTP_503",
        safeMessage: "TAGO 정류장 조회가 일시 지연되었습니다.",
        retryable: true,
      }),
    });

    const result = await context.service.getNearbyStops(
      { lat: 36.3723, lng: 127.3604 },
      500,
    );

    expect(result).toEqual({
      items: [kaistNorthGate],
      partial: true,
    });
  });
});
