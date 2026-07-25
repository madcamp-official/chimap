import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { INTRO_SESSION_KEY } from "./components/IntroSequence.js";
import { LAST_TRIP_STORAGE_KEY } from "./lib/storage.js";
import { defaultDeadline } from "./lib/time.js";
import { useTripStore } from "./store/trip-store.js";
import {
  daejeonStationPlace,
  kaistPlace,
  recommendationFixture,
} from "./test/fixtures.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(resultCount: 1 | 2 | 3 = 3, delayMs = 40) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/health")) {
      return jsonResponse({
        status: "ok",
        mode: "mock",
        timestamp: new Date().toISOString(),
      });
    }
    if (url.includes("/places")) {
      const query = new URL(url).searchParams.get("query") ?? "";
      return jsonResponse({
        items: /KAIST/iu.test(query)
          ? [kaistPlace]
          : /대전/iu.test(query)
            ? [daejeonStationPlace]
            : [],
      });
    }
    if (url.includes("/recommendations")) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      return jsonResponse(recommendationFixture(resultCount));
    }
    return jsonResponse(
      {
        error: {
          code: "NOT_FOUND",
          message: "not found",
          requestId: "11111111-1111-4111-8111-111111111111",
        },
      },
      404,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.setItem(INTRO_SESSION_KEY, "1");
  useTripStore.setState({
    origin: undefined,
    destination: undefined,
    currentSteps: 0,
    goalSteps: 8000,
    deadlineLocal: defaultDeadline(),
    maxExtraMinutes: 25,
    strideLengthMeters: 0.7,
    safetyBufferMinutes: 3,
    selectedRouteId: undefined,
  });
});

describe("CHIMap 웹 사용자 흐름", () => {
  it("위치 권한을 거절해도 직접 검색 흐름을 유지한다", async () => {
    installFetchMock();
    const getCurrentPosition = vi.fn(
      (
        _success: PositionCallback,
        failure: PositionErrorCallback | null | undefined,
      ) => {
        failure?.({
          code: 1,
          message: "permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    );
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
    });
    const user = userEvent.setup();
    renderApp();

    await user.click(
      screen.getByRole("button", {
        name: "현재 위치를 출발지로 사용",
      }),
    );

    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        "위치 권한을 사용하지 않았어요. 출발지를 직접 검색하면 계속 이용할 수 있어요.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("출발지")).toBeEnabled();
  });

  it("장소와 목표를 입력하고 로딩 단계와 추천 카드를 표시한다", async () => {
    installFetchMock(3, 80);
    const user = userEvent.setup();
    renderApp();

    const originInput = screen.getByLabelText("출발지");
    await user.type(originInput, "KAIST");
    const originOption = await screen.findByRole("option", {
      name: /한국과학기술원/u,
    });
    await user.click(originOption);

    const destinationInput = screen.getByLabelText("목적지");
    await user.type(destinationInput, "대전역");
    const destinationOption = await screen.findByRole("option", {
      name: /대전역/u,
    });
    await user.click(destinationOption);

    expect(
      screen.getByRole("heading", { name: "얼마나 더 걸어볼까요?" }),
    ).toBeInTheDocument();
    const currentSteps = screen.getByLabelText("현재 걸음 수");
    await user.clear(currentSteps);
    await user.type(currentSteps, "5200");
    expect(screen.getByText(/2,800걸음/u)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "건강 경로 찾기" }),
    );
    expect(
      await screen.findByText("입력 조건을 확인하고 있어요"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: /빠른 경로, 예상 도착/u,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /균형 경로, 예상 도착/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /목표 달성 경로, 예상 도착/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("네이버 지도 키 없이 경로선 미리보기로 표시 중"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("지도와 경로 데이터 제공자"),
    ).toHaveTextContent("NAVER 지도+DEMO 경로");
  });

  it("경로 카드를 선택하면 상세와 마지막 선택 요약을 저장한다", async () => {
    installFetchMock();
    useTripStore.setState({
      origin: kaistPlace,
      destination: daejeonStationPlace,
      currentSteps: 5200,
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", { name: "건강 경로 찾기" }),
    );
    const balanced = await screen.findByRole("button", {
      name: /균형 경로, 예상 도착/u,
    });
    await user.click(balanced);
    expect(balanced).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("heading", { name: "균형 경로" }),
    ).toBeInTheDocument();
    expect(
      within(balanced).getByRole("progressbar", {
        name: "이동 후 하루 목표 달성률",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem(LAST_TRIP_STORAGE_KEY)).toContain(
        "BALANCED",
      ),
    );
  });

  it("서버가 두 경로만 반환하면 빈 카드를 만들지 않는다", async () => {
    installFetchMock(2);
    useTripStore.setState({
      origin: kaistPlace,
      destination: daejeonStationPlace,
      currentSteps: 5200,
    });
    const user = userEvent.setup();
    const { container } = renderApp();
    await user.click(
      screen.getByRole("button", { name: "건강 경로 찾기" }),
    );
    await screen.findByText("충분히 다른 경로가 2개뿐이에요.");
    expect(container.querySelectorAll(".recommendation-card")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /목표 달성 경로, 예상 도착/u }),
    ).not.toBeInTheDocument();
  });

  it("실제 대중교통 API 오류를 가짜 결과 없이 표시한다", async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/health")) {
        return jsonResponse({
          status: "ok",
          mode: "live",
          timestamp: new Date().toISOString(),
        });
      }
      if (url.includes("/recommendations")) {
        return jsonResponse(
          {
            error: {
              code: "UPSTREAM_ERROR",
              message: "TAGO 버스 정보를 불러오지 못했어요.",
              requestId: "11111111-1111-4111-8111-111111111111",
            },
          },
          502,
        );
      }
      return jsonResponse({ items: [] });
    });
    useTripStore.setState({
      origin: kaistPlace,
      destination: daejeonStationPlace,
      currentSteps: 5200,
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", { name: "건강 경로 찾기" }),
    );
    expect(
      await screen.findByText(/TAGO 버스 정보를 불러오지 못했어요/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /빠른 경로, 예상 도착/u }),
    ).not.toBeInTheDocument();
  });

  it("지도 SDK가 없어도 텍스트 경로 단계가 유지된다", async () => {
    installFetchMock(1);
    useTripStore.setState({
      origin: kaistPlace,
      destination: daejeonStationPlace,
      currentSteps: 5200,
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(
      screen.getByRole("button", { name: "건강 경로 찾기" }),
    );
    await screen.findByText(
      "네이버 지도 키 없이 경로선 미리보기로 표시 중",
    );
    const details = await screen.findByLabelText(
      /한국과학기술원 KAIST에서 대전역까지 선택 경로선 미리보기/u,
    );
    expect(details).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "텍스트 이동 단계" });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(screen.getByText("정류장까지 걸어서 이동")).toBeInTheDocument();
  });
});
