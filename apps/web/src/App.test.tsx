import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { INTRO_SESSION_KEY } from "./components/IntroSequence.js";
import { useTripStore } from "./store/trip-store.js";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  sessionStorage.setItem(INTRO_SESSION_KEY, "1");
  useTripStore.setState({
    origin: undefined,
    destination: undefined,
    walkingProfile: {
      birthYear: 2000,
      heightCm: 170,
      weightKg: 65,
      biologicalSex: "FEMALE",
    },
    selectedRouteId: undefined,
  });
});

describe("현재 위치 출발지 UX", () => {
  it("주소를 찾지 못해도 좌표를 출발지로 유지하고 이유를 안내한다", async () => {
    const getCurrentPosition = vi.fn(
      (success: PositionCallback) =>
        success({
          coords: {
            longitude: 127.363854,
            latitude: 36.372104,
          },
        } as GeolocationPosition),
    );
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
    });
    const reverseAddress = vi.fn().mockResolvedValue({
      place: null,
      meta: {
        provider: "NONE",
        fallbackUsed: true,
        degraded: true,
      },
    });
    render(<App reverseAddress={reverseAddress} />, {
      wrapper: createWrapper(),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "현재 위치를 출발지로 사용",
      }),
    );

    await screen.findByText(
      "주소는 찾지 못했지만 현재 좌표를 출발지로 설정했어요.",
    );
    expect(reverseAddress).toHaveBeenCalledWith({
      lng: 127.363854,
      lat: 36.372104,
    });
    expect(useTripStore.getState().origin).toMatchObject({
      name: "현재 위치",
      location: { lng: 127.363854, lat: 36.372104 },
    });
  });

  it("위치 권한을 사용하지 않아도 직접 검색으로 이어갈 방법을 안내한다", async () => {
    const getCurrentPosition = vi.fn(
      (_success: PositionCallback, error: PositionErrorCallback) =>
        error({
          code: 1,
          message: "permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        }),
    );
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
    });
    render(<App />, { wrapper: createWrapper() });

    fireEvent.click(
      screen.getByRole("button", {
        name: "현재 위치를 출발지로 사용",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "위치 권한을 사용하지 않았어요. 출발지를 직접 검색하면 계속 이용할 수 있어요.",
        ),
      ).toBeInTheDocument(),
    );
    expect(useTripStore.getState().origin).toBeUndefined();
  });
});

describe("Route Pulse 화면 설정과 동의 경계", () => {
  it("동의 전과 거부 상태에서는 익명 UI 이벤트 요청을 만들지 않는다", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />, { wrapper: createWrapper() });

    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-ui-state",
      "idle",
    );
    fireEvent.click(screen.getByRole("button", { name: "괜찮아요" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("명시적으로 허용한 뒤에만 제한된 planner 이벤트를 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "허용" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      version: "route-pulse-v1",
      event: "planner_viewed",
      uiState: "idle",
      experienceMode: "guided",
    });
    expect(String(request.body)).not.toContain("coordinate");
    expect(String(request.body)).not.toContain("query");
  });

  it("화면 설정에서 동작 줄이기와 간결한 안내를 직접 선택할 수 있다", () => {
    render(<App />, { wrapper: createWrapper() });

    fireEvent.click(
      screen.getByRole("button", { name: "화면 사용 설정 열기" }),
    );
    fireEvent.click(
      screen.getByRole("radio", {
        name: "간결하게 핵심 정보만 표시",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "동작 줄이기" }));

    expect(document.querySelector(".app-shell")).toHaveAttribute(
      "data-experience-mode",
      "compact",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-chimap-reduced-motion",
      "true",
    );
  });
});
