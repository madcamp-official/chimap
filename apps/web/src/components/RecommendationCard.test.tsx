import type { Recommendation } from "@chimap/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecommendationCard } from "./RecommendationCard.js";

const recommendation: Recommendation = {
  id: "tago:25:daejeon-108",
  type: "BALANCED",
  title: "2배 걸음 경로",
  reason: "가장 빠른 경로의 예상 걸음 수 약 두 배에 가장 가까워요.",
  durationSeconds: 2_280,
  arrivalAt: "2026-07-25T19:38:00+09:00",
  extraMinutes: 8,
  walkDistanceMeters: 1_120,
  estimatedSteps: 1_600,
  stepDifference: -2_400,
  goalFit: "UNDER",
  expectedTotalSteps: 5_200,
  dailyGoalCompletionRate: 0.65,
  shortfallCoverageRate: 0.4,
  transferCount: 0,
  isRealtime: true,
  legs: [
    {
      id: "walk-to-kaist-stop",
      mode: "WALK",
      guidance: "한국과학기술원 정문 정류장까지 걸어가세요.",
      distanceMeters: 620,
      durationSeconds: 540,
      coordinates: [
        { lng: 127.363854, lat: 36.372104 },
        { lng: 127.362734, lat: 36.368879 },
      ],
      isExerciseSegment: false,
    },
    {
      id: "bus-108",
      mode: "BUS",
      name: "108",
      guidance: "108번 버스를 타고 대전역에서 내리세요.",
      distanceMeters: 7_600,
      durationSeconds: 1_440,
      coordinates: [
        { lng: 127.362734, lat: 36.368879 },
        { lng: 127.434893, lat: 36.33242 },
      ],
      isExerciseSegment: false,
    },
    {
      id: "walk-from-daejeon-station",
      mode: "WALK",
      guidance: "대전역 출구까지 걸어가세요.",
      distanceMeters: 500,
      durationSeconds: 300,
      coordinates: [
        { lng: 127.434893, lat: 36.33242 },
        { lng: 127.435484, lat: 36.331477 },
      ],
      isExerciseSegment: true,
    },
  ],
};

describe("RecommendationCard", () => {
  it("선택 전에도 이동시간·도보·환승·목표 정보를 한눈에 보여준다", () => {
    render(
      <RecommendationCard
        recommendation={recommendation}
        selected={false}
        detailsOpen={false}
        detailsId="route-details"
        onSelect={vi.fn()}
        onToggleDetails={vi.fn()}
      />,
    );

    expect(screen.getByText("38분")).toBeInTheDocument();
    expect(screen.getByText(/도보 14분 · 1\.1km/)).toBeInTheDocument();
    expect(screen.getByText("환승 없음")).toBeInTheDocument();
    expect(screen.getByText(/1,600걸음 · 목표 65%/)).toBeInTheDocument();
    expect(screen.getByText("실시간 도착")).toBeInTheDocument();
    expect(screen.getByText("약 2배 걷기")).toBeInTheDocument();
    expect(screen.queryByText(recommendation.reason)).not.toBeInTheDocument();
  });

  it("카드 선택과 상세 열기를 서로 구분해 실행한다", () => {
    const onSelect = vi.fn();
    const onToggleDetails = vi.fn();
    render(
      <RecommendationCard
        recommendation={recommendation}
        selected={true}
        detailsOpen={false}
        detailsId="route-details"
        onSelect={onSelect}
        onToggleDetails={onToggleDetails}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /2배 걸음 경로, 예상 도착/,
      }),
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onToggleDetails).not.toHaveBeenCalled();

    const detailsButton = screen.getByRole("button", {
      name: "2배 걸음 경로 자세히",
    });
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    expect(detailsButton).toHaveAttribute("aria-controls", "route-details");
    fireEvent.click(detailsButton);
    expect(onToggleDetails).toHaveBeenCalledOnce();
  });
});
