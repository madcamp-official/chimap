import {
  busVehiclesResponseSchema,
  type BusVehiclePosition,
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

describe("선택 경로 차량 표시", () => {
  it("실제 TAGO 차량 캡처의 출처와 checksum을 검증한다", () => {
    expect(capture.providerOperation).toContain("getRouteAcctoBusLcList");
    expect(
      createHash("sha256")
        .update(JSON.stringify(capture.response))
        .digest("hex"),
    ).toBe(capture.checksum);
  });

  it("탑승 정류장에 가장 가까이 접근 중인 차량 한 대만 선택한다", () => {
    const selected = selectRelevantVehiclePositions(
      [
        {
          cityCode: "25",
          routeId: "DJB30300070",
          vehicleNo: null,
          boardingNodeOrder: 27,
          alightingNodeOrder: 31,
        },
      ],
      capture.response.items,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      routeNo: "603",
      vehicleNo: "대전75자2238",
      nodeOrder: 21,
      stopsUntilBoarding: 6,
    });
  });

  it("차량 번호가 확인되면 같은 실제 차량을 우선하고 중복 표시는 제거한다", () => {
    const target = capture.response.items[0] as BusVehiclePosition;
    const selected = selectRelevantVehiclePositions(
      [
        {
          cityCode: target.cityCode,
          routeId: target.routeId,
          vehicleNo: target.vehicleNo,
          boardingNodeOrder: 27,
          alightingNodeOrder: 31,
        },
        {
          cityCode: target.cityCode,
          routeId: target.routeId,
          vehicleNo: target.vehicleNo,
          boardingNodeOrder: 27,
          alightingNodeOrder: 31,
        },
      ],
      capture.response.items,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.vehicleNo).toBe(target.vehicleNo);
    expect(selected[0]?.stopsUntilBoarding).toBe(23);
  });
});
