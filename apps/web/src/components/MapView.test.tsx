import type { Place, Recommendation } from "@chimap/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MapView } from "./MapView.js";

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

describe("MapView", () => {
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
      screen.getByLabelText("지도와 경로 데이터 제공자"),
    ).toHaveTextContent("NAVER 지도+KAKAO 검색/도보+TAGO 버스");
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
});
