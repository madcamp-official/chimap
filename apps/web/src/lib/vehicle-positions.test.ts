import {
  busVehiclesResponseSchema,
  type BusArrival,
  type BusVehiclePosition,
  type TransitBusLeg,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { selectRelevantVehiclePositions } from "./vehicle-positions.js";

const captureSchema = z.object({
  provider: z.literal("TAGO"),
  capturedAt: z.iso.datetime({ offset: true }),
  api: z.string().min(1),
  providerOperation: z.string().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  response: busVehiclesResponseSchema,
});

const capture = captureSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test-data/tago-vehicle-positions-20260725.json"),
      "utf8",
    ),
  ),
);

function busLeg(
  overrides: Partial<TransitBusLeg> = {},
): TransitBusLeg {
  const stop = {
    id: "stop-27",
    cityCode: "25",
    nodeId: "DJB8002729",
    sourceStopNo: null,
    arsId: null,
    name: "나라키움청사/3.8기념관",
    latitude: 36.33,
    longitude: 127.42,
    source: "database" as const,
  };
  return {
    routeId: "DJB30300070",
    cityCode: "25",
    routeNo: "603",
    routeType: "간선버스",
    boardingStop: stop,
    alightingStop: { ...stop, id: "stop-30", nodeId: "DJB8002730" },
    stopCount: 3,
    boardingNodeOrder: 27,
    alightingNodeOrder: 30,
    expectedArrivalSeconds: 300,
    expectedRideSeconds: 600,
    vehicleNo: null,
    vehicleType: null,
    isArrivalRealtime: true,
    polyline: [
      { lat: 36.33, lng: 127.42 },
      { lat: 36.34, lng: 127.43 },
    ],
    stops: [
      {
        routeId: "DJB30300070",
        stopId: "stop-27",
        nodeId: "DJB8002729",
        cityCode: "25",
        stopName: "나라키움청사/3.8기념관",
        latitude: 36.33,
        longitude: 127.42,
        nodeOrder: 27,
        direction: null,
      },
      {
        routeId: "DJB30300070",
        stopId: "stop-30",
        nodeId: "DJB8002730",
        cityCode: "25",
        stopName: "목적 정류장",
        latitude: 36.34,
        longitude: 127.43,
        nodeOrder: 30,
        direction: null,
      },
    ],
    ...overrides,
  };
}

function arrival(arrivalSeconds: number): BusArrival {
  return {
    cityCode: "25",
    nodeId: "DJB8002729",
    routeId: "DJB30300070",
    routeNo: "603",
    routeType: "간선버스",
    remainingStops: 6,
    arrivalSeconds,
    arrivalMinutes: Math.ceil(arrivalSeconds / 60),
    vehicleType: null,
    isRealtime: true,
    fetchedAt: "2026-07-25T06:37:00.000Z",
  };
}

describe("선택 경로 차량 표시", () => {
  it("실제 TAGO 차량 캡처의 출처와 checksum을 검증한다", () => {
    expect(capture.providerOperation).toContain("getRouteAcctoBusLcList");
    expect(
      createHash("sha256")
        .update(JSON.stringify(capture.response))
        .digest("hex"),
    ).toBe(capture.checksum);
  });

  it.each([599, 600])("ETA %i초이면 가장 가까운 접근 차량을 선택한다", (seconds) => {
    const selected = selectRelevantVehiclePositions(
      [busLeg()],
      capture.response.items,
      [arrival(seconds)],
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      routeNo: "603",
      vehicleNo: "대전75자2238",
      nodeOrder: 21,
      stopsUntilBoarding: 6,
      displayReason: "ARRIVING_SOON",
      arrivalSeconds: seconds,
    });
  });

  it("ETA가 600초를 넘고 이동 구간 차량도 없으면 표시하지 않는다", () => {
    expect(
      selectRelevantVehiclePositions(
        [busLeg()],
        capture.response.items,
        [arrival(601)],
      ),
    ).toEqual([]);
  });

  it("승차~하차 구간에서는 승차 지점을 방금 지난 차량 한 대만 표시한다", () => {
    const selected = selectRelevantVehiclePositions(
      [busLeg({ alightingNodeOrder: 40 })],
      capture.response.items,
      [arrival(601)],
    );

    expect(selected.map((vehicle) => vehicle.nodeOrder)).toEqual([31]);
    expect(selected[0]?.displayReason).toBe("JUST_PASSED");
  });

  it("도착정보 호출이 실패해 빈 배열이어도 이동 구간 차량은 유지한다", () => {
    const selected = selectRelevantVehiclePositions(
      [busLeg({ alightingNodeOrder: 40 })],
      capture.response.items,
      [],
    );

    expect(selected.map((vehicle) => vehicle.nodeOrder)).toEqual([31]);
    expect(
      selected.every((vehicle) => vehicle.displayReason === "JUST_PASSED"),
    ).toBe(true);
  });

  it("여러 leg에서 같은 차량이 선택돼도 한 번만 표시한다", () => {
    const selected = selectRelevantVehiclePositions(
      [busLeg({ alightingNodeOrder: 31 }), busLeg({ alightingNodeOrder: 31 })],
      capture.response.items,
      [arrival(600)],
    );

    expect(selected.filter((vehicle) => vehicle.nodeOrder === 31)).toHaveLength(1);
  });

  it("같은 노선은 오고 있는 차량과 방금 지난 차량을 합쳐 최대 두 대다", () => {
    const selected = selectRelevantVehiclePositions(
      [busLeg({ alightingNodeOrder: 40 })],
      capture.response.items,
      [arrival(600)],
    );

    expect(selected).toHaveLength(2);
    expect(selected.map((vehicle) => vehicle.displayReason)).toEqual([
      "ARRIVING_SOON",
      "JUST_PASSED",
    ]);
    expect(selected.map((vehicle) => vehicle.nodeOrder)).toEqual([21, 31]);
  });

  it("정류장 순서가 없거나 하차 지점을 지난 차량은 제외한다", () => {
    const base = capture.response.items[0] as BusVehiclePosition;
    const selected = selectRelevantVehiclePositions(
      [busLeg()],
      [
        { ...base, nodeOrder: null },
        { ...base, vehicleNo: "passed", nodeOrder: 31 },
      ],
      [arrival(601)],
    );

    expect(selected).toEqual([]);
  });
});
