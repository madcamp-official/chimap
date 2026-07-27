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
        "실제 경로 요청을 처리하고 있어요. 보통 몇 초 안에 완료됩니다.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("추천 요청 진행 중")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(8000));

    expect(
      screen.getByText(
        "교통 정보 응답이 평소보다 늦어요. 그대로 기다리거나 장소를 수정해 새로 검색할 수 있어요.",
      ),
    ).toBeInTheDocument();
  });
});
