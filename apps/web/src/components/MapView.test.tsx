import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  daejeonStationPlace,
  kaistPlace,
  recommendationFixture,
} from "../test/fixtures.js";
import { MapView } from "./MapView.js";

afterEach(() => {
  Reflect.deleteProperty(window, "naver");
});

describe("MapView provider 분리", () => {
  it("네이버 키가 없으면 경로 좌표와 제공자 정보를 폴백으로 유지한다", () => {
    render(
      <MapView
        origin={kaistPlace}
        destination={daejeonStationPlace}
        recommendations={recommendationFixture(1).recommendations}
        selectedRouteId="route-fast"
        routeProvider="DEMO"
      />,
    );

    expect(
      screen.getByText("네이버 지도 키 없이 경로선 미리보기로 표시 중"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("지도와 경로 데이터 제공자"),
    ).toHaveTextContent("NAVER 지도+DEMO 경로");
    expect(
      screen.getByRole("img", {
        name: /한국과학기술원 KAIST에서 대전역까지/u,
      }),
    ).toBeInTheDocument();
  });

  it("TAGO 경로 좌표를 네이버 Polyline과 Marker로 렌더링한다", async () => {
    const destroy = vi.fn();
    const fitBounds = vi.fn();
    const setCenter = vi.fn();
    const setZoom = vi.fn();
    const mapInstance = { destroy, fitBounds, setCenter, setZoom };
    const MapConstructor = vi.fn(function () {
      return mapInstance;
    });
    const LatLng = vi.fn(function (
      this: { lat: number; lng: number },
      lat: number,
      lng: number,
    ) {
      this.lat = lat;
      this.lng = lng;
    });
    const LatLngBounds = vi.fn(function () {
      return {};
    });
    const polylineSetMap = vi.fn();
    const Polyline = vi.fn(function () {
      return { setMap: polylineSetMap };
    });
    const markerSetMap = vi.fn();
    const Marker = vi.fn(function () {
      return { setMap: markerSetMap };
    });

    Object.defineProperty(window, "naver", {
      configurable: true,
      value: {
        maps: {
          Map: MapConstructor,
          LatLng,
          LatLngBounds,
          Polyline,
          Marker,
          MapTypeId: { NORMAL: "normal" },
          Position: { RIGHT_CENTER: "right-center" },
        },
      },
    });

    const recommendations = recommendationFixture(2).recommendations;
    const { unmount } = render(
      <MapView
        origin={kaistPlace}
        destination={daejeonStationPlace}
        recommendations={recommendations}
        selectedRouteId="route-balanced"
        ncpKeyId="public-client-id"
      />,
    );

    await screen.findByText(
      "네이버 지도가 준비됐어요. 경로 계산 데이터는 TAGO를 사용합니다.",
    );
    await waitFor(() => {
      expect(MapConstructor).toHaveBeenCalledOnce();
      expect(Polyline).toHaveBeenCalledTimes(6);
      expect(Marker).toHaveBeenCalledTimes(3);
      expect(fitBounds).toHaveBeenCalledOnce();
    });
    expect(MapConstructor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        logoControl: true,
        mapDataControl: true,
        zoomControlOptions: { position: "right-center" },
      }),
    );
    expect(Polyline).toHaveBeenCalledWith(
      expect.objectContaining({
        map: mapInstance,
        strokeOpacity: 0.95,
        zIndex: 20,
        path: expect.any(Array),
      }),
    );
    expect(LatLng).toHaveBeenCalledWith(
      kaistPlace.location.lat,
      kaistPlace.location.lng,
    );
    expect(fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxZoom: 16, top: 128 }),
    );

    unmount();
    expect(polylineSetMap).toHaveBeenCalledWith(null);
    expect(markerSetMap).toHaveBeenCalledWith(null);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("SDK callback 순서와 뒤늦은 인증 실패를 안전하게 처리한다", async () => {
    const destroy = vi.fn(() => {
      throw new Error("SDK cleanup failed");
    });
    const MapConstructor = vi.fn(function () {
      return {
        destroy,
        fitBounds: vi.fn(),
        setCenter: vi.fn(),
        setZoom: vi.fn(),
      };
    });
    const LatLng = vi.fn(function () {
      return {};
    });
    const LatLngBounds = vi.fn(function () {
      return {};
    });
    const Polyline = vi.fn(function () {
      return { setMap: vi.fn() };
    });
    const Marker = vi.fn(function () {
      return { setMap: vi.fn() };
    });

    const { unmount } = render(
      <MapView
        origin={undefined}
        destination={undefined}
        recommendations={[]}
        selectedRouteId={undefined}
        ncpKeyId="public-client-id"
      />,
    );

    const script = document.getElementById("chimap-naver-maps-sdk");
    expect(script).toBeInstanceOf(HTMLScriptElement);
    (
      window as Window & { __chimapNaverMapsReady?: () => void }
    ).__chimapNaverMapsReady?.();

    Object.defineProperty(window, "naver", {
      configurable: true,
      value: {
        maps: {
          Map: MapConstructor,
          LatLng,
          LatLngBounds,
          Polyline,
          Marker,
          MapTypeId: { NORMAL: "normal" },
          Position: { RIGHT_CENTER: "right-center" },
        },
      },
    });
    script?.dispatchEvent(new Event("load"));

    await screen.findByText(
      "네이버 지도가 준비됐어요. 경로 계산 데이터는 TAGO를 사용합니다.",
    );
    expect(MapConstructor).toHaveBeenCalledOnce();

    (
      window as Window & { navermap_authFailure?: () => void }
    ).navermap_authFailure?.();
    await screen.findByText("네이버 지도를 불러오지 못했어요");
    expect(
      (window as Window & { naver?: unknown }).naver,
    ).toBeDefined();

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
