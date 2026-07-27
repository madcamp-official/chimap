import { describe, expect, it } from "vitest";

import {
  findMultimodalPaths,
  type GraphEdge,
  type RequestGraph,
} from "./multimodal-route-planner.js";

function edge(input: Partial<GraphEdge> & Pick<GraphEdge, "id" | "fromNodeId" | "toNodeId" | "kind" | "mode" | "durationSeconds">): GraphEdge {
  return {
    distanceMeters: 100,
    coordinates: [{ lat: 36.3, lng: 127.3 }, { lat: 36.31, lng: 127.31 }],
    ...input,
  };
}

function graph(edges: GraphEdge[]): RequestGraph {
  const adjacency = new Map<string, GraphEdge[]>();
  for (const item of edges) {
    adjacency.set(item.fromNodeId, [
      ...(adjacency.get(item.fromNodeId) ?? []),
      item,
    ]);
  }
  return { nodes: new Map(), adjacency, topologyPartial: false };
}

describe("요청 범위 멀티모달 graph", () => {
  it("버스→지하철 환승을 찾고 같은 노선 대기시간은 한 번만 더한다", () => {
    const result = findMultimodalPaths(graph([
      edge({ id: "access", fromNodeId: "ORIGIN", toNodeId: "B1", kind: "WALK", mode: "WALK", durationSeconds: 10 }),
      edge({ id: "bus-1", fromNodeId: "B1", toNodeId: "B2", kind: "RIDE", mode: "BUS", durationSeconds: 60, serviceKey: "BUS:604", expectedWaitSeconds: 120 }),
      edge({ id: "bus-2", fromNodeId: "B2", toNodeId: "B3", kind: "RIDE", mode: "BUS", durationSeconds: 60, serviceKey: "BUS:604", expectedWaitSeconds: 120 }),
      edge({ id: "transfer", fromNodeId: "B3", toNodeId: "S1", kind: "WALK", mode: "WALK", durationSeconds: 20 }),
      edge({ id: "subway-1", fromNodeId: "S1", toNodeId: "S2", kind: "RIDE", mode: "SUBWAY", durationSeconds: 90, serviceKey: "SUBWAY:DAEJEON_1", expectedWaitSeconds: 180 }),
      edge({ id: "subway-2", fromNodeId: "S2", toNodeId: "S3", kind: "RIDE", mode: "SUBWAY", durationSeconds: 90, serviceKey: "SUBWAY:DAEJEON_1", expectedWaitSeconds: 180 }),
      edge({ id: "egress", fromNodeId: "S3", toNodeId: "DESTINATION", kind: "WALK", mode: "WALK", durationSeconds: 10 }),
    ]), 2, new Date("2026-07-27T00:00:00Z"));

    expect(result[0]).toMatchObject({ durationSeconds: 640, transferCount: 1 });
    expect(result[0]?.steps.map((step) => step.boardingWaitSeconds)).toEqual([
      0, 120, 0, 0, 180, 0, 0,
    ]);
  });

  it("설정된 환승 횟수를 넘는 경로는 제외한다", () => {
    const result = findMultimodalPaths(graph([
      edge({ id: "b", fromNodeId: "ORIGIN", toNodeId: "X", kind: "RIDE", mode: "BUS", durationSeconds: 60, serviceKey: "BUS:A" }),
      edge({ id: "walk", fromNodeId: "X", toNodeId: "Y", kind: "WALK", mode: "WALK", durationSeconds: 10 }),
      edge({ id: "s", fromNodeId: "Y", toNodeId: "DESTINATION", kind: "RIDE", mode: "SUBWAY", durationSeconds: 60, serviceKey: "SUBWAY:B" }),
    ]), 0, new Date("2026-07-27T00:00:00Z"));

    expect(result).toEqual([]);
  });
});
