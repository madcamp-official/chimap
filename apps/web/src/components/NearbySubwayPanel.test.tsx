import type {
  Place,
  SubwayDeparture,
  SubwayDeparturesResponse,
  SubwayStation,
  SubwayStationsResponse,
} from "@chimap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { NearbySubwayPanel } from "./NearbySubwayPanel.js";

const origin: Place = {
  id: "origin",
  name: "한국과학기술원",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "대학교",
  location: { lng: 127.363854, lat: 36.372104 },
};

const destination: Place = {
  id: "destination",
  name: "대전역",
  address: "대전 동구 정동 1-1",
  roadAddress: "대전 동구 중앙로 215",
  category: "기차역",
  location: { lng: 127.434893, lat: 36.33242 },
};

function station(
  id: string,
  name: string,
  distanceMeters: number,
  mappingStatus: SubwayStation["mappingStatus"] = "MAPPED",
): SubwayStation {
  return {
    id,
    stationCode: `code-${id}`,
    name,
    lineCode: "1",
    lineName: "대전 1호선",
    englishName: null,
    hanjaName: null,
    transferType: null,
    transferLineCode: null,
    transferLineName: null,
    latitude: 36.33,
    longitude: 127.43,
    operatorName: "대전교통공사",
    roadAddress: null,
    phoneNumber: null,
    dataDate: "2026-07-27",
    tagoStationId: mappingStatus === "MAPPED" ? `tago-${id}` : null,
    tagoRouteName: mappingStatus === "MAPPED" ? "대전 1호선" : null,
    mappingStatus,
    active: true,
    distanceMeters,
  };
}

function departure(
  stationId: string,
  direction: "U" | "D",
  hour: string,
): SubwayDeparture {
  return {
    stationId,
    stationName: stationId === "1" ? "월평" : "대전",
    tagoStationId: `tago-${stationId}`,
    subwayRouteId: "DJB1",
    terminalStationId: direction === "U" ? "panam" : "bansuk",
    terminalStationName: direction === "U" ? "판암" : "반석",
    direction,
    dailyTypeCode: "01",
    rawDepartureTime: `${hour.replace(":", "")}00`,
    rawArrivalTime: `${hour.replace(":", "")}00`,
    departureAt: `2026-07-27T${hour}:00+09:00`,
    arrivalAt: `2026-07-27T${hour}:00+09:00`,
    scheduleBased: true,
  };
}

function stationResponse(items: SubwayStation[]): SubwayStationsResponse {
  return { items, total: items.length };
}

function departureResponse(
  items: SubwayDeparture[],
): SubwayDeparturesResponse {
  return {
    items,
    scheduleAvailable: items.length > 0,
    unavailableReason: items.length > 0 ? null : "NO_UPCOMING_DEPARTURES",
    scheduleBased: true,
    realtimeAvailable: false,
    fetchedAt: "2026-07-27T08:00:00+09:00",
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("NearbySubwayPanel", () => {
  it("출발·도착 주변 역과 TAGO 상하행 시간표를 화면에 표시한다", async () => {
    const wolpyeong = station("1", "월평", 1_250);
    const daejeon = station("2", "대전", 120);
    const searchNearby = vi.fn(async ({ coordinate }) =>
      coordinate.lng === origin.location.lng
        ? stationResponse([wolpyeong])
        : stationResponse([daejeon]),
    );
    const searchDepartures = vi.fn(async ({ stationId, direction }) =>
      departureResponse([
        departure(
          stationId,
          direction,
          stationId === "1"
            ? direction === "U"
              ? "08:15"
              : "08:19"
            : direction === "U"
              ? "08:22"
              : "08:27",
        ),
      ]),
    );

    render(
      <NearbySubwayPanel
        origin={origin}
        destination={destination}
        searchNearby={searchNearby}
        searchDepartures={searchDepartures}
      />,
      { wrapper: createWrapper() },
    );

    expect(await screen.findByRole("heading", { name: "월평역" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "대전역" })).toBeVisible();
    expect(screen.getByText("1.3km")).toBeVisible();
    expect(screen.getByText("120m")).toBeVisible();
    expect(screen.getByText("TAGO 시간표 기반 예상")).toBeVisible();
    expect(screen.getByText("실시간 지연 미반영")).toBeVisible();
    expect(await screen.findByText("08:15")).toBeVisible();
    expect(screen.getAllByText("판암역 방면")).toHaveLength(2);
    expect(
      screen.getByText("현재 추천 소요시간에는 지하철 시간표가 합산되지 않습니다."),
    ).toBeVisible();
    expect(searchNearby).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(searchDepartures).toHaveBeenCalledTimes(4));
    expect(searchDepartures).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: "1", direction: "U", limit: 2 }),
    );
    expect(searchDepartures).toHaveBeenCalledWith(
      expect.objectContaining({ stationId: "2", direction: "D", limit: 2 }),
    );
  });

  it("미매핑 역과 일부 주변 역 조회 실패를 경로 실패로 오해하지 않게 안내한다", async () => {
    const unresolved = station("3", "정부청사", 500, "UNRESOLVED");
    const searchNearby = vi.fn(async ({ coordinate }) => {
      if (coordinate.lng === destination.location.lng) {
        throw new Error("temporary failure");
      }
      return stationResponse([unresolved]);
    });
    const searchDepartures = vi.fn();

    render(
      <NearbySubwayPanel
        origin={origin}
        destination={destination}
        searchNearby={searchNearby}
        searchDepartures={searchDepartures}
      />,
      { wrapper: createWrapper() },
    );

    expect(await screen.findByRole("heading", { name: "정부청사역" })).toBeVisible();
    expect(
      screen.getByText("TAGO 역 매핑 전이라 시간표를 제공하지 못해요."),
    ).toBeVisible();
    expect(screen.getByText("주변 역 조회 실패")).toBeVisible();
    expect(screen.getByText("경로 추천은 그대로 이용할 수 있어요.")).toBeVisible();
    expect(searchDepartures).not.toHaveBeenCalled();
  });
});
