import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthControl } from "./AuthControl.js";

function wrapper() {
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
  window.history.replaceState({}, "", "/");
});

describe("선택형 카카오 로그인", () => {
  it("익명 사용자는 로그인 없이 계속 쓸 수 있고 원할 때 로그인한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: false,
          kakaoLoginAvailable: true,
          user: null,
        }),
      }),
    );

    render(<AuthControl />, { wrapper: wrapper() });

    expect(
      await screen.findByRole("link", { name: /카카오 로그인/u }),
    ).toHaveAttribute(
      "href",
      "http://localhost:8080/api/v1/auth/kakao/start",
    );
    expect(screen.getByText("로그인 없이도 이용할 수 있어요")).toBeVisible();
  });

  it("로그인 사용자를 표시하고 CHIMap 세션을 로그아웃한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          kakaoLoginAvailable: true,
          user: {
            id: "00000000-0000-4000-8000-000000000000",
            provider: "KAKAO",
            displayName: "춘식이",
            profileImageUrl: null,
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthControl />, { wrapper: wrapper() });

    expect(await screen.findByText("춘식이")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://localhost:8080/api/v1/auth/logout",
    );
    expect(
      await screen.findByRole("link", { name: /카카오 로그인/u }),
    ).toBeVisible();
  });

  it("로그아웃 실패 시 로그인 상태와 재시도 안내를 유지한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          kakaoLoginAvailable: true,
          user: {
            id: "00000000-0000-4000-8000-000000000000",
            provider: "KAKAO",
            displayName: "춘식이",
            profileImageUrl: null,
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuthControl />, { wrapper: wrapper() });

    fireEvent.click(
      await screen.findByRole("button", { name: "로그아웃" }),
    );
    expect(
      await screen.findByText(
        "로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
      ),
    ).toBeVisible();
    expect(screen.getByText("춘식이")).toBeVisible();
  });

  it("카카오에서 돌아온 결과를 안내하고 URL에서는 결과 값을 지운다", async () => {
    window.history.replaceState({}, "", "/?auth=kakao-cancelled");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: false,
          kakaoLoginAvailable: true,
          user: null,
        }),
      }),
    );

    render(<AuthControl />, { wrapper: wrapper() });

    expect(
      await screen.findByText(
        "카카오 로그인을 취소했어요. 로그인 없이도 이용할 수 있어요.",
      ),
    ).toBeVisible();
    expect(window.location.search).toBe("");
  });
});
