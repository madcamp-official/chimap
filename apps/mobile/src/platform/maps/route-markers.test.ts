import type { RouteLeg } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { deriveRouteMarkers } from "./route-markers";

function busLeg(
  id: string,
  boarding: { lat: number; lng: number; name: string },
  alighting: { lat: number; lng: number; name: string },
): RouteLeg {
  return {
    id,
    mode: "BUS",
    distanceMeters: 1_000,
    durationSeconds: 600,
    coordinates: [boarding, alighting],
    isExerciseSegment: false,
    bus: {
      routeId: id,
      cityCode: "25",
      routeNo: "514",
      routeType: null,
      boardingStop: {
        id: `${id}-on`,
        cityCode: "25",
        nodeId: `${id}-on-node`,
        sourceStopNo: null,
        arsId: null,
        name: boarding.name,
        latitude: boarding.lat,
        longitude: boarding.lng,
        source: "database",
      },
      alightingStop: {
        id: `${id}-off`,
        cityCode: "25",
        nodeId: `${id}-off-node`,
        sourceStopNo: null,
        arsId: null,
        name: alighting.name,
        latitude: alighting.lat,
        longitude: alighting.lng,
        source: "database",
      },
      stopCount: 2,
      boardingNodeOrder: 1,
      alightingNodeOrder: 2,
      expectedArrivalSeconds: 60,
      expectedRideSeconds: 600,
      vehicleNo: null,
      vehicleType: null,
      isArrivalRealtime: false,
      polyline: [boarding, alighting],
      stops: [
        {
          routeId: id,
          stopId: `${id}-on`,
          nodeId: `${id}-on-node`,
          cityCode: "25",
          stopName: boarding.name,
          latitude: boarding.lat,
          longitude: boarding.lng,
          nodeOrder: 1,
          direction: null,
        },
        {
          routeId: id,
          stopId: `${id}-off`,
          nodeId: `${id}-off-node`,
          cityCode: "25",
          stopName: alighting.name,
          latitude: alighting.lat,
          longitude: alighting.lng,
          nodeOrder: 2,
          direction: null,
        },
      ],
    },
  };
}

describe("route markers", () => {
  it("adds no transit marker to a walking-only route", () => {
    const walk = {
      id: "walk",
      mode: "WALK",
      distanceMeters: 300,
      durationSeconds: 240,
      coordinates: [],
      isExerciseSegment: false,
    } as RouteLeg;

    expect(deriveRouteMarkers([walk])).toEqual([]);
  });

  it("marks the first boarding, transfers and final alighting in route order", () => {
    const transfer = { lat: 36.350001, lng: 127.380001, name: "환승 정류장" };
    const markers = deriveRouteMarkers([
      busLeg(
        "bus-1",
        { lat: 36.35, lng: 127.37, name: "첫 승차" },
        transfer,
      ),
      busLeg(
        "bus-2",
        { lat: 36.350002, lng: 127.380002, name: "환승 승차" },
        { lat: 36.36, lng: 127.39, name: "마지막 하차" },
      ),
    ]);

    expect(markers.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: "bus-1:board", role: "BOARD" },
      { id: "bus-1:alight", role: "TRANSFER" },
      { id: "bus-2:alight", role: "ALIGHT" },
    ]);
  });

  it("keeps same-role markers farther than 15m apart", () => {
    const markers = deriveRouteMarkers([
      busLeg(
        "bus-1",
        { lat: 36.35, lng: 127.37, name: "첫 승차" },
        { lat: 36.35, lng: 127.38, name: "환승 하차" },
      ),
      busLeg(
        "bus-2",
        { lat: 36.352, lng: 127.382, name: "멀리 떨어진 환승 승차" },
        { lat: 36.36, lng: 127.39, name: "마지막 하차" },
      ),
    ]);

    expect(markers.filter((marker) => marker.role === "TRANSFER")).toHaveLength(2);
  });
});
