import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecommendationProgress } from "./RecommendationProgress.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("RecommendationProgress", () => {
  it("외부 버스 응답이 길어지면 멈춘 것처럼 보이지 않도록 상황을 설명한다", () => {
    vi.useFakeTimers();
    render(<RecommendationProgress />);

    expect(
      screen.getByText(
        "보통 몇 초 안에 끝나요. 새 검색을 시작하면 이 요청은 취소됩니다.",
      ),
    ).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(8000));

    expect(
      screen.getByText(
        "실제 버스 운행 응답이 늦어 조금 더 확인하고 있어요. 새 검색을 시작하면 이 요청은 취소됩니다.",
      ),
    ).toBeInTheDocument();
  });
});
