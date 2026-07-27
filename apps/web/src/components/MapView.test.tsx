import type { Place, Recommendation } from "@chimap/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RelevantVehiclePosition } from "../lib/vehicle-positions.js";
import { MapView, transitMarkers } from "./MapView.js";

const origin: Place = {
  id: "kakao:place:10491355",
  name: "한국과학기술원",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "교육,학문 > 학교 > 대학교",
  location: { lng: 127.363854, lat: 36.372104 },
};

const destination: Place = {
  id: "kakao:place:8532908",
  name: "대전역",
  address: "대전 동구 정동 1-1",
  roadAddress: "대전 동구 중앙로 215",
  category: "교통,수송 > 기차,철도 > 기차역",
  location: { lng: 127.434893, lat: 36.33242 },
};

const route: Recommendation = {
  id: "kakao:walk:kaist-daejeon",
  type: "FAST",
  title: "가장 빠른 경로",
  reason: "현재 이용 가능한 경로 중 가장 빠릅니다.",
  durationSeconds: 4_800,
  arrivalAt: "2026-07-25T20:20:00+09:00",
  extraMinutes: 0,
  walkDistanceMeters: 8_100,
  estimatedSteps: 11_570,
  stepDifference: 3_570,
  goalFit: "OVER",
  expectedTotalSteps: 11_570,
  dailyGoalCompletionRate: 1,
  shortfallCoverageRate: 1,
  transferCount: 0,
  legs: [
    {
      id: "walk-kaist-daejeon",
      mode: "WALK",
      guidance: "한국과학기술원에서 대전역까지 이동하세요.",
      distanceMeters: 8_100,
      durationSeconds: 4_800,
      coordinates: [origin.location, destination.location],
      isExerciseSegment: false,
    },
  ],
};

const walkingDisplayRoute: Recommendation = {
  ...route,
  id: "kakao:walk:all-walking-orange",
  legs: [
    {
      ...route.legs[0]!,
      id: "walk-access",
      distanceMeters: 4_000,
      coordinates: [
        origin.location,
        { lng: 127.399, lat: 36.35 },
      ],
      isExerciseSegment: false,
      walkingRole: "ACCESS",
    },
    {
      ...route.legs[0]!,
      id: "walk-goal",
      distanceMeters: 4_100,
      coordinates: [
        { lng: 127.399, lat: 36.35 },
        destination.location,
      ],
      isExerciseSegment: true,
      walkingRole: "GOAL_EARLY_ALIGHTING",
    },
  ],
};

const alternateRoute: Recommendation = {
  ...route,
  id: "kakao:walk:kaist-daejeon-alternate",
  legs: route.legs.map((leg) => ({ ...leg, id: `${leg.id}-alternate` })),
};

const vehicle: RelevantVehiclePosition = {
  cityCode: "25",
  routeId: "DJB30300070",
  routeNo: "603",
  vehicleNo: "대전75자2238",
  latitude: 36.35,
  longitude: 127.4,
  nodeId: "DJB8002720",
  nodeName: "이전 정류장",
  nodeOrder: 21,
  routeType: "간선버스",
  fetchedAt: "2026-07-25T06:37:00.000Z",
  stopsUntilBoarding: 6,
  stopsUntilAlighting: 9,
  displayReason: "ARRIVING_SOON",
  arrivalSeconds: 59,
};

describe("MapView", () => {
  afterEach(() => {
    delete (window as Window & { naver?: unknown }).naver;
  });
  it("지하철 탑승·노선 환승·하차 마커를 만든다", () => {
    const subwayRoute: Recommendation = {
      ...route,
      id: "subway-transfer-route",
      transferCount: 1,
      legs: [
        {
          id: "subway-one",
          mode: "SUBWAY",
          name: "대전 1호선",
          distanceMeters: 2_000,
          durationSeconds: 400,
          stops: ["월평", "정부청사"],
          coordinates: [
            { lat: 36.358, lng: 127.364 },
            { lat: 36.357, lng: 127.381 },
          ],
          isExerciseSegment: false,
        },
        {
          id: "subway-two",
          mode: "SUBWAY",
          name: "대전 2호선",
          distanceMeters: 3_000,
          durationSeconds: 500,
          stops: ["정부청사", "대전"],
          coordinates: [
            { lat: 36.357, lng: 127.381 },
            { lat: 36.331, lng: 127.433 },
          ],
          isExerciseSegment: false,
        },
      ],
    };

    expect(transitMarkers(subwayRoute)).toEqual([
      expect.objectContaining({
        label: "탑승",
        title: "월평 · 대전 1호선 탑승",
      }),
      expect.objectContaining({
        label: "환승",
        title: "정부청사 · 대전 1호선에서 대전 2호선으로 환승",
      }),
      expect.objectContaining({
        label: "하차",
        title: "대전 · 대전 2호선 하차",
      }),
    ]);
  });
  it("지도 키가 없어도 경로 카드 기능과 대체 경로선을 유지한다", () => {
    render(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[route]}
        selectedRouteId={route.id}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "한국과학기술원에서 대전역까지 선택 경로선 미리보기",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("네이버 지도 키 없이 경로선 미리보기로 표시 중"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "추천 카드와 텍스트 이동 단계는 계속 사용할 수 있어요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("지도와 경로 데이터 제공자"),
    ).not.toBeInTheDocument();
  });

  it("경로 선택 전에는 다음 행동을 설명한다", () => {
    render(
      <MapView
        origin={undefined}
        destination={undefined}
        recommendations={[]}
        selectedRouteId={undefined}
      />,
    );

    expect(
      screen.getByText("장소를 선택하면 경로가 이곳에 표시돼요."),
    ).toBeInTheDocument();
  });

  it("모든 도보를 주황색 실선으로 그리고 운동 시작 마커는 표시하지 않는다", () => {
    const { container } = render(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[walkingDisplayRoute]}
        selectedRouteId={walkingDisplayRoute.id}
      />,
    );

    const walkingLines = container.querySelectorAll(
      ".route-preview-svg polyline",
    );
    expect(walkingLines).toHaveLength(2);
    walkingLines.forEach((line) => {
      expect(line).toHaveAttribute("stroke", "#f47b35");
      expect(line).not.toHaveAttribute("stroke-dasharray");
    });
    expect(screen.queryByText("운동 시작")).not.toBeInTheDocument();
    expect(screen.getByLabelText("지도 경로 범례")).toHaveTextContent("도보");
    expect(screen.getByLabelText("지도 경로 범례")).not.toHaveTextContent(
      "일반 도보",
    );
    expect(screen.getByLabelText("지도 경로 범례")).not.toHaveTextContent(
      "추가 운동",
    );
  });

  it("SVG fallback도 WebP 버스 이미지와 흰 전광판·검은 노선번호를 표시한다", () => {
    const { container } = render(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[route]}
        selectedRouteId={route.id}
        vehiclePositions={[vehicle]}
      />,
    );

    const image = container.querySelector(".route-preview-svg image");
    const number = container.querySelector(".preview-vehicle-number");
    expect(image).toHaveAttribute(
      "href",
      expect.stringContaining("bus_icon.webp"),
    );
    expect(number).toHaveTextContent("603");
    expect(number).toHaveClass("preview-vehicle-number");
    expect(number).toHaveAttribute("fill", "#111");
    expect(container.querySelector(".preview-vehicle-display")).toHaveAttribute(
      "fill",
      "#fff",
    );
    expect(container.querySelector(".route-preview-svg title")).toHaveTextContent(
      "603번 · 1분 후 도착",
    );
  });

  it("차량만 갱신할 때 카메라는 유지하고 버스 이미지 마커만 교체한다", async () => {
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    const setZoom = vi.fn();
    const markerOptions: Array<{ icon: { content: HTMLElement }; title: string }> = [];
    class LatLng {}
    class LatLngBounds {}
    class MapMock {
      destroy = vi.fn();
      fitBounds = fitBounds;
      setCenter = setCenter;
      setZoom = setZoom;
    }
    class OverlayMock {
      setMap = vi.fn();
    }
    class MarkerMock extends OverlayMock {
      constructor(options: { icon: { content: HTMLElement }; title: string }) {
        super();
        markerOptions.push(options);
      }
    }
    Object.assign(window, {
      naver: {
        maps: {
          Map: MapMock,
          LatLng,
          LatLngBounds,
          Polyline: OverlayMock,
          Marker: MarkerMock,
          MapTypeId: { NORMAL: "normal" },
          Position: { RIGHT_CENTER: "right" },
        },
      },
    });
    const view = render(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[route, alternateRoute]}
        selectedRouteId={route.id}
        cameraResetKey="request-1"
        ncpKeyId="public-map-key"
        vehiclePositions={[vehicle]}
      />,
    );

    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));
    const vehicleMarker = markerOptions.find((option) =>
      option.icon.content.classList.contains("map-marker-vehicle"),
    );
    expect(vehicleMarker?.icon.content.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("bus_icon"),
    );
    expect(vehicleMarker?.icon.content.querySelector("img")).toHaveAttribute(
      "alt",
      "",
    );
    expect(vehicleMarker?.icon.content).toHaveTextContent("603");
    expect(vehicleMarker?.title).toContain("1분 후 도착");
    expect(vehicleMarker?.icon.content).toHaveAttribute(
      "aria-label",
      expect.stringContaining("603번 · 1분 후 도착"),
    );

    view.rerender(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[route, alternateRoute]}
        selectedRouteId={route.id}
        cameraResetKey="request-1"
        ncpKeyId="public-map-key"
        vehiclePositions={[
          { ...vehicle, latitude: 36.351, fetchedAt: "2026-07-25T06:37:10.000Z" },
        ]}
      />,
    );
    await waitFor(() =>
      expect(
        markerOptions.filter((option) =>
          option.icon.content.classList.contains("map-marker-vehicle"),
        ),
      ).toHaveLength(2),
    );
    expect(fitBounds).toHaveBeenCalledTimes(1);
    expect(setCenter).not.toHaveBeenCalled();
    expect(setZoom).not.toHaveBeenCalled();

    view.rerender(
      <MapView
        origin={origin}
        destination={destination}
        recommendations={[route, alternateRoute]}
        selectedRouteId={alternateRoute.id}
        cameraResetKey="request-1"
        ncpKeyId="public-map-key"
        vehiclePositions={[vehicle]}
      />,
    );
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(2));
  });
});
