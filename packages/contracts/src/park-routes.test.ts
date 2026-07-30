import { describe, expect, it } from "vitest";

import { parkRouteSnapshotSchema } from "./index.js";

const hash = "a".repeat(64);
const route = {
  routeId: "park-route:park-001:main",
  officialParkId: "park-001",
  parkName: "샘머리공원",
  routeType: "LOOP",
  directionPolicy: "BOTH",
  entry: {
    waypointId: "A",
    location: { lng: 127.381234, lat: 36.357891 },
  },
  exit: {
    waypointId: "A",
    location: { lng: 127.381234, lat: 36.357891 },
  },
  waypoints: [
    {
      id: "A",
      kind: "ENTRANCE",
      location: { lng: 127.381234, lat: 36.357891 },
    },
    {
      id: "W1",
      kind: "INTERNAL",
      location: { lng: 127.382041, lat: 36.358221 },
    },
  ],
  pathWaypointIds: ["A", "W1", "A"],
  excludedWaypointIds: [],
  coordinates: [
    { lng: 127.381234, lat: 36.357891 },
    { lng: 127.382041, lat: 36.358221 },
    { lng: 127.381234, lat: 36.357891 },
  ],
  distanceMeters: 824,
  durationSeconds: 642,
  routing: { engine: "VALHALLA", costing: "pedestrian" },
  review: {
    completed: true,
    outcome: "APPROVED_FOR_PRODUCTION",
    reviewer: "검수자",
    reviewedAt: "2026-07-29T13:30:00+09:00",
  },
  sourceHash: hash,
} as const;

const snapshot = {
  schemaVersion: "park-route-snapshot-v1",
  datasetId: "daejeon-park-routes-20260729-v1",
  generatedAt: "2026-07-29T14:00:00+09:00",
  regionCode: "KR-30",
  mode: "FULL_SNAPSHOT",
  source: {
    system: "chimap-park-etl",
    reviewSchemaVersion: "v2.4",
  },
  datasetChecksum: hash,
  routes: [route],
} as const;

describe("공원 경로 snapshot 계약", () => {
  it("LOOP와 반복 pathWaypointIds를 순서 그대로 허용한다", () => {
    const parsed = parkRouteSnapshotSchema.parse(snapshot);
    expect(parsed.routes[0]?.pathWaypointIds).toEqual(["A", "W1", "A"]);
  });

  it("strict object, 좌표, checksum, engine, costing, review를 검증한다", () => {
    expect(
      parkRouteSnapshotSchema.safeParse({ ...snapshot, unexpected: true })
        .success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [{ ...route, coordinates: [{ lng: 181, lat: 36 }] }],
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        datasetChecksum: "bad",
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [
          { ...route, routing: { engine: "KAKAO", costing: "pedestrian" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [
          { ...route, routing: { engine: "VALHALLA", costing: "bicycle" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [
          {
            ...route,
            review: { ...route.review, completed: false },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("빈 routes, 중복 routeId, waypoint 참조 오류를 거절한다", () => {
    expect(
      parkRouteSnapshotSchema.safeParse({ ...snapshot, routes: [] }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [route, route],
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [{ ...route, pathWaypointIds: ["A", "MISSING"] }],
      }).success,
    ).toBe(false);
    expect(
      parkRouteSnapshotSchema.safeParse({
        ...snapshot,
        routes: [
          {
            ...route,
            waypoints: [route.waypoints[0], route.waypoints[0]],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
