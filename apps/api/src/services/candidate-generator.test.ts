import type { NormalizedRoute } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { rebuildRoute } from "./candidate-generator.js";

describe("대중교통 목표 걸음 경로 재구성", () => {
  it("시간표 기반 지하철의 비실시간 상태와 시간 합계를 보존한다", () => {
    const base: NormalizedRoute = {
      id: "mixed-base",
      source: "TAGO",
      durationSeconds: 600,
      distanceMeters: 1_500,
      walkDistanceMeters: 0,
      transitDistanceMeters: 1_500,
      transferCount: 1,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
      isRealtime: false,
      estimationNotes: ["TAGO 시간표 기반 예상"],
      legs: [
        {
          id: "subway",
          mode: "SUBWAY",
          name: "대전 1호선",
          distanceMeters: 1_000,
          durationSeconds: 400,
          coordinates: [
            { lat: 36.35, lng: 127.38 },
            { lat: 36.33, lng: 127.42 },
          ],
          isExerciseSegment: false,
          subway: {
            serviceLineId: "daejeon-1",
            lineName: "대전 1호선",
            boardingStation: {
              stationLineId: "1",
              sourceStationKey: "S3001|101",
              name: "반석",
              location: { lat: 36.35, lng: 127.38 },
            },
            alightingStation: {
              stationLineId: "2",
              sourceStationKey: "S3001|104",
              name: "대전",
              location: { lat: 36.33, lng: 127.42 },
            },
            stationCount: 3,
            rideDurationSeconds: 200,
            direction: "DOWN",
            destinationName: null,
            intermediateStations: [],
          },
        },
        {
          id: "bus",
          mode: "BUS",
          name: "501",
          distanceMeters: 500,
          durationSeconds: 200,
          coordinates: [
            { lat: 36.33, lng: 127.42 },
            { lat: 36.33, lng: 127.43 },
          ],
          isExerciseSegment: false,
          bus: {
            routeId: "route-501",
            cityCode: "25",
            routeNo: "501",
            routeType: null,
            boardingStop: {
              id: "stop-1", cityCode: "25", nodeId: "node-1",
              sourceStopNo: null, arsId: null, name: "승차",
              latitude: 36.33, longitude: 127.42, source: "database",
            },
            alightingStop: {
              id: "stop-2", cityCode: "25", nodeId: "node-2",
              sourceStopNo: null, arsId: null, name: "하차",
              latitude: 36.33, longitude: 127.43, source: "database",
            },
            stopCount: 1,
            boardingNodeOrder: 1,
            alightingNodeOrder: 2,
            expectedArrivalSeconds: 100,
            expectedRideSeconds: 100,
            vehicleNo: null,
            vehicleType: null,
            isArrivalRealtime: false,
            polyline: [
              { lat: 36.33, lng: 127.42 },
              { lat: 36.33, lng: 127.43 },
            ],
            stops: [
              { routeId: "route-501", stopId: "stop-1", nodeId: "node-1", cityCode: "25", stopName: "승차", latitude: 36.33, longitude: 127.42, nodeOrder: 1, direction: null },
              { routeId: "route-501", stopId: "stop-2", nodeId: "node-2", cityCode: "25", stopName: "하차", latitude: 36.33, longitude: 127.43, nodeOrder: 2, direction: null },
            ],
          },
        },
      ],
    };

    const rebuilt = rebuildRoute(
      base,
      base.legs,
      "mixed-adjusted",
      "EARLY_ALIGHT",
    );

    expect(rebuilt).toMatchObject({
      isRealtime: false,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
    });
  });
});
