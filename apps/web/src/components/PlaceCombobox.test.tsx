import type { Place, PlaceSearchResponse } from "@chimap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlaceCombobox } from "./PlaceCombobox.js";

const kaist: Place = {
  id: "kakao:place:10491355",
  name: "한국과학기술원",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "교육,학문 > 학교 > 대학교",
  location: { lng: 127.363854, lat: 36.372104 },
};

const daejeonStation: Place = {
  id: "naver:address:daejeon-station",
  name: "대전역",
  address: "대전 동구 정동 1-1",
  roadAddress: "대전 동구 중앙로 215",
  category: "주소",
  location: { lng: 127.434893, lat: 36.33242 },
};

function response(items: Place[]): PlaceSearchResponse {
  return {
    items,
    meta: {
      provider: items.some((item) => item.id.startsWith("naver:"))
        ? "NAVER"
        : "KAKAO",
      strategy: items.some((item) => item.id.startsWith("naver:"))
        ? "NAVER_GEOCODE"
        : "KAKAO_KEYWORD_ADDRESS",
      fallbackUsed: items.some((item) => item.id.startsWith("naver:")),
      degraded: false,
    },
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("PlaceCombobox", () => {
  it("명시 검색 뒤에도 결과를 자동 선택하지 않고 클릭으로 확정한다", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(response([kaist]));
    const onChange = vi.fn();
    render(
      <PlaceCombobox
        label="출발지"
        placeholder="출발 장소 검색"
        value={undefined}
        onChange={onChange}
        search={search}
      />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByRole("combobox", { name: "출발지" });
    await user.type(input, "한국과학기술원");
    await user.click(screen.getByRole("button", { name: "출발지 검색" }));

    const option = await screen.findByRole("option", {
      name: /한국과학기술원/,
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "한국과학기술원",
        scope: "resolve",
      }),
    );
    expect(onChange).not.toHaveBeenCalledWith(kaist);

    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith(kaist);
    expect(input).toHaveValue("한국과학기술원");
  });

  it("방향키와 Enter로 원하는 주소 결과를 선택한다", async () => {
    const user = userEvent.setup();
    const search = vi
      .fn()
      .mockResolvedValue(response([kaist, daejeonStation]));
    const onChange = vi.fn();
    render(
      <PlaceCombobox
        label="목적지"
        placeholder="도착 장소 검색"
        value={undefined}
        onChange={onChange}
        search={search}
      />,
      { wrapper: createWrapper() },
    );

    const input = screen.getByRole("combobox", { name: "목적지" });
    await user.type(input, "대전역");
    await user.click(screen.getByRole("button", { name: "목적지 검색" }));
    await screen.findByRole("option", { name: /한국과학기술원/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: /대전역/ }),
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(daejeonStation));
    expect(input).toHaveValue("대전역");
  });

  it("한 글자 입력에는 호출 대신 바로 이해할 수 있는 안내를 보여준다", async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    render(
      <PlaceCombobox
        label="출발지"
        placeholder="출발 장소 검색"
        value={undefined}
        onChange={vi.fn()}
        search={search}
      />,
      { wrapper: createWrapper() },
    );

    await user.type(
      screen.getByRole("combobox", { name: "출발지" }),
      "역",
    );

    expect(
      screen.getAllByText("두 글자 이상 입력해 주세요.").length,
    ).toBeGreaterThan(0);
    expect(search).not.toHaveBeenCalled();
  });
});
