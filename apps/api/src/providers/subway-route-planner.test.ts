import { describe, expect, it } from "vitest";

import type {
  SubwayRoutingGraph,
  SubwayRoutingStation,
} from "../transit/transit-repository.js";
import { findSubwayPathCandidates } from "./subway-route-planner.js";

function station(
  nodeId: string,
  serviceLineId: string,
  stationName: string,
  longitude: number,
): SubwayRoutingStation {
  return {
    nodeId,
    serviceLineId,
    sourceStationKey: nodeId.split(":").at(-1)!,
    stationOrder: 1,
    stationName,
    lineName: serviceLineId === "line-1" ? "1호선" : "2호선",
    regionName: "대전",
    operatorName: "대전교통공사",
    latitude: 36.33,
    longitude,
  };
}

describe("지하철 추천 그래프", () => {
  it("직통 지하철 경로와 최초 탑승 대기시간을 계산한다", () => {
    const a = station("line-1:A", "line-1", "월평", 127.36);
    const b = station("line-1:B", "line-1", "정부청사", 127.38);
    const c = station("line-1:C", "line-1", "대전", 127.43);
    const graph: SubwayRoutingGraph = {
      stations: [a, b, c],
      edges: [
        {
          fromNodeId: a.nodeId,
          toNodeId: b.nodeId,
          kind: "RIDE",
          durationSeconds: 120,
          distanceMeters: 1_000,
          expectedWaitSeconds: 240,
          serviceLineId: "line-1",
          durationIsEstimated: false,
        },
        {
          fromNodeId: b.nodeId,
          toNodeId: c.nodeId,
          kind: "RIDE",
          durationSeconds: 180,
          distanceMeters: 2_000,
          expectedWaitSeconds: 240,
          serviceLineId: "line-1",
          durationIsEstimated: false,
        },
      ],
    };

    const [candidate] = findSubwayPathCandidates(
      graph,
      { lat: 36.33, lng: 127.359 },
      { lat: 36.33, lng: 127.431 },
    );

    expect(candidate?.stations.map((item) => item.stationName)).toEqual([
      "월평",
      "정부청사",
      "대전",
    ]);
    expect(candidate).toMatchObject({
      waitingDurationSeconds: 240,
      ridingDurationSeconds: 300,
      transferDurationSeconds: 0,
    });
  });

  it("노선 사이의 환승 간선을 포함한 경로를 찾는다", () => {
    const a = station("line-1:A", "line-1", "출발", 127.36);
    const transferOut = station("line-1:T1", "line-1", "환승", 127.38);
    const transferIn = station("line-2:T2", "line-2", "환승", 127.38);
    const destination = station("line-2:D", "line-2", "도착", 127.41);
    const graph: SubwayRoutingGraph = {
      stations: [a, transferOut, transferIn, destination],
      edges: [
        {
          fromNodeId: a.nodeId,
          toNodeId: transferOut.nodeId,
          kind: "RIDE",
          durationSeconds: 120,
          distanceMeters: 1_000,
          expectedWaitSeconds: 180,
          serviceLineId: "line-1",
          durationIsEstimated: false,
        },
        {
          fromNodeId: transferOut.nodeId,
          toNodeId: transferIn.nodeId,
          kind: "TRANSFER",
          durationSeconds: 240,
          distanceMeters: 70,
          expectedWaitSeconds: 0,
          serviceLineId: null,
          durationIsEstimated: true,
        },
        {
          fromNodeId: transferIn.nodeId,
          toNodeId: destination.nodeId,
          kind: "RIDE",
          durationSeconds: 180,
          distanceMeters: 1_500,
          expectedWaitSeconds: 300,
          serviceLineId: "line-2",
          durationIsEstimated: false,
        },
      ],
    };

    const [candidate] = findSubwayPathCandidates(
      graph,
      { lat: 36.33, lng: 127.359 },
      { lat: 36.33, lng: 127.411 },
    );

    expect(candidate?.edges.map((edge) => edge.kind)).toEqual([
      "RIDE",
      "TRANSFER",
      "RIDE",
    ]);
    expect(candidate).toMatchObject({
      waitingDurationSeconds: 480,
      ridingDurationSeconds: 300,
      transferDurationSeconds: 240,
    });
  });
});
