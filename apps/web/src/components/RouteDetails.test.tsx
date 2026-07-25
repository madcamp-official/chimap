import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { recommendationFixture } from "../test/fixtures.js";
import { RouteDetails } from "./RouteDetails.js";

describe("RouteDetails 버스 실시간 상태", () => {
  it("탑승/하차, 정류장 수, 실시간 도착과 저상버스를 표시한다", () => {
    const recommendation = structuredClone(
      recommendationFixture(1).recommendations[0]!,
    );
    const leg = recommendation.legs.find((item) => item.mode === "BUS")!;
    leg.bus = {
      routeId: "DJB30300104",
      cityCode: "25",
      routeNo: "104",
      routeType: "간선",
      boardingStop: {
        id: "25:A",
        cityCode: "25",
        nodeId: "A",
        sourceStopNo: null,
        arsId: null,
        name: "출발 정류장",
        latitude: 36.37,
        longitude: 127.36,
        source: "tago",
      },
      alightingStop: {
        id: "25:C",
        cityCode: "25",
        nodeId: "C",
        sourceStopNo: null,
        arsId: null,
        name: "도착 정류장",
        latitude: 36.35,
        longitude: 127.4,
        source: "tago",
      },
      stopCount: 2,
      boardingNodeOrder: 1,
      alightingNodeOrder: 3,
      expectedArrivalSeconds: 180,
      expectedRideSeconds: 900,
      vehicleNo: null,
      vehicleType: "저상버스",
      isArrivalRealtime: true,
      polyline: [
        { lat: 36.37, lng: 127.36 },
        { lat: 36.35, lng: 127.4 },
      ],
      stops: [
        {
          routeId: "DJB30300104",
          stopId: "25:A",
          nodeId: "A",
          cityCode: "25",
          stopName: "출발 정류장",
          latitude: 36.37,
          longitude: 127.36,
          nodeOrder: 1,
          direction: null,
        },
        {
          routeId: "DJB30300104",
          stopId: "25:C",
          nodeId: "C",
          cityCode: "25",
          stopName: "도착 정류장",
          latitude: 36.35,
          longitude: 127.4,
          nodeOrder: 3,
          direction: null,
        },
      ],
    };

    render(<RouteDetails recommendation={recommendation} />);
    expect(screen.getByText("출발 정류장 → 도착 정류장")).toBeInTheDocument();
    expect(screen.getByText(/실시간 · 3분 후/u)).toBeInTheDocument();
    expect(screen.getByText("저상버스")).toBeInTheDocument();
    expect(screen.getByText(/2개 정류장/u)).toBeInTheDocument();
  });

  it("실시간 도착이 아니면 예상 배지를 표시한다", () => {
    const recommendation = structuredClone(
      recommendationFixture(1).recommendations[0]!,
    );
    const leg = recommendation.legs.find((item) => item.mode === "BUS")!;
    leg.bus = {
      routeId: "R1",
      cityCode: "25",
      routeNo: "104",
      routeType: null,
      boardingStop: {
        id: "A",
        cityCode: "25",
        nodeId: "A",
        sourceStopNo: null,
        arsId: null,
        name: "A",
        latitude: 36.37,
        longitude: 127.36,
        source: "database",
      },
      alightingStop: {
        id: "B",
        cityCode: "25",
        nodeId: "B",
        sourceStopNo: null,
        arsId: null,
        name: "B",
        latitude: 36.36,
        longitude: 127.38,
        source: "database",
      },
      stopCount: 1,
      boardingNodeOrder: 1,
      alightingNodeOrder: 2,
      expectedArrivalSeconds: 600,
      expectedRideSeconds: 300,
      vehicleNo: null,
      vehicleType: null,
      isArrivalRealtime: false,
      polyline: [
        { lat: 36.37, lng: 127.36 },
        { lat: 36.36, lng: 127.38 },
      ],
      stops: [
        {
          routeId: "R1",
          stopId: "A",
          nodeId: "A",
          cityCode: "25",
          stopName: "A",
          latitude: 36.37,
          longitude: 127.36,
          nodeOrder: 1,
          direction: null,
        },
        {
          routeId: "R1",
          stopId: "B",
          nodeId: "B",
          cityCode: "25",
          stopName: "B",
          latitude: 36.36,
          longitude: 127.38,
          nodeOrder: 2,
          direction: null,
        },
      ],
    };
    render(<RouteDetails recommendation={recommendation} />);
    expect(screen.getByText(/예상 · 10분 후/u)).toBeInTheDocument();
  });
});
