import { describe, expect, it } from "vitest";

import {
  authSessionResponseSchema,
  coordinateSchema,
  estimatePersonalizedStepLengthMeters,
  haversineDistanceMeters,
  mobileAccountDeletionRequestSchema,
  mobileAppleLoginRequestSchema,
  mobileClientHeadersSchema,
  mobileConfigResponseSchema,
  mobileKakaoLoginRequestSchema,
  mobileTokenPairSchema,
  recommendationRequestSchema,
  routeLegSchema,
  storedPreferencesV1Schema,
  storedPreferencesV2Schema,
  storedPreferencesV3Schema,
  subwayDeparturesResponseSchema,
  subwayStationSchema,
  uiEventPayloadSchema,
} from "./index.js";

describe("공유 계약", () => {
  it("모바일 플랫폼과 opaque token pair 계약을 엄격하게 검증한다", () => {
    expect(
      mobileKakaoLoginRequestSchema.safeParse({
        kakaoAccessToken: "k".repeat(32),
        platform: "ios",
      }).success,
    ).toBe(true);
    expect(
      mobileKakaoLoginRequestSchema.safeParse({
        kakaoAccessToken: "k".repeat(32),
        platform: "web",
      }).success,
    ).toBe(false);
    expect(
      mobileTokenPairSchema.safeParse({
        tokenType: "Bearer",
        accessToken: "a".repeat(43),
        accessExpiresAt: "2026-07-26T12:15:00+09:00",
        refreshToken: "r".repeat(43),
        refreshExpiresAt: "2026-08-25T12:00:00+09:00",
        user: {
          id: "00000000-0000-4000-8000-000000000000",
          provider: "KAKAO",
          displayName: null,
          profileImageUrl: null,
        },
      }).success,
    ).toBe(true);
    expect(
      mobileAppleLoginRequestSchema.safeParse({
        identityToken: "i".repeat(64),
        authorizationCode: "authorization-code",
        nonce: "n".repeat(32),
        displayName: "CHIMap 사용자",
        platform: "ios",
      }).success,
    ).toBe(true);
    expect(
      mobileAccountDeletionRequestSchema.safeParse({
        refreshToken: "r".repeat(43),
        confirmation: "DELETE",
      }).success,
    ).toBe(true);
  });

  it("모바일 client metadata와 호환성 설정을 versioned contract로 검증한다", () => {
    expect(
      mobileClientHeadersSchema.safeParse({
        platform: "ios",
        appVersion: "0.1.0",
        contractVersion: "v1",
      }).success,
    ).toBe(true);
    expect(
      mobileConfigResponseSchema.safeParse({
        contractVersion: "v1",
        minimumSupportedVersion: { ios: "0.1.0", android: "0.1.0" },
        maintenance: { enabled: false, message: null },
        supportedRegions: ["대전"],
        privacyPolicyVersion: "2026-07-26",
        vehiclePollingIntervalSeconds: 15,
        authentication: {
          guestEnabled: true,
          kakaoEnabled: true,
          appleEnabled: true,
        },
      }).success,
    ).toBe(true);
    expect(
      mobileClientHeadersSchema.safeParse({
        platform: "ios",
        appVersion: "latest",
        contractVersion: "v1",
      }).success,
    ).toBe(false);
  });

  it("선택형 카카오 로그인 세션의 익명·로그인 상태를 구분한다", () => {
    expect(
      authSessionResponseSchema.safeParse({
        authenticated: false,
        kakaoLoginAvailable: true,
        user: null,
      }).success,
    ).toBe(true);
    expect(
      authSessionResponseSchema.safeParse({
        authenticated: true,
        kakaoLoginAvailable: true,
        user: {
          id: "00000000-0000-4000-8000-000000000000",
          provider: "KAKAO",
          displayName: "춘식이",
          profileImageUrl: null,
        },
      }).success,
    ).toBe(true);
    expect(
      authSessionResponseSchema.safeParse({
        authenticated: true,
        kakaoLoginAvailable: true,
        user: null,
      }).success,
    ).toBe(false);
  });

  it("유효한 좌표를 허용하고 범위 밖 좌표를 거절한다", () => {
    expect(
      coordinateSchema.parse({ lng: 127.3604, lat: 36.3723 }),
    ).toEqual({ lng: 127.3604, lat: 36.3723 });
    expect(
      coordinateSchema.safeParse({ lng: 181, lat: 36.3723 }).success,
    ).toBe(false);
    expect(
      coordinateSchema.safeParse({ lng: 127, lat: Number.NaN }).success,
    ).toBe(false);
  });

  it("비도보 구간을 운동 구간으로 표시하지 못하게 한다", () => {
    const result = routeLegSchema.safeParse({
      id: "bus-1",
      mode: "BUS",
      name: "104",
      distanceMeters: 1000,
      durationSeconds: 600,
      coordinates: [],
      isExerciseSegment: true,
    });

    expect(result.success).toBe(false);
  });

  it("상세·근사 경로 geometry 품질을 구분한다", () => {
    const leg = {
      id: "subway-1",
      mode: "SUBWAY",
      distanceMeters: 1300,
      durationSeconds: 240,
      coordinates: [
        { lng: 127.381, lat: 36.357 },
        { lng: 127.384, lat: 36.346 },
      ],
      isExerciseSegment: false,
    };

    expect(
      routeLegSchema.safeParse({ ...leg, geometryQuality: "DETAILED" }).success,
    ).toBe(true);
    expect(
      routeLegSchema.safeParse({ ...leg, geometryQuality: "APPROXIMATE" }).success,
    ).toBe(true);
    expect(
      routeLegSchema.safeParse({ ...leg, geometryQuality: "UNKNOWN" }).success,
    ).toBe(false);
  });

  it("추천 입력의 걸음 수와 개인화 한 걸음 길이 경계를 검증한다", () => {
    const baseRequest = {
      origin: {
        id: "kaist",
        name: "KAIST",
        address: "",
        roadAddress: "",
        category: "교육",
        location: { lng: 127.3604, lat: 36.3723 },
      },
      destination: {
        id: "daejeon",
        name: "대전역",
        address: "",
        roadAddress: "",
        category: "교통",
        location: { lng: 127.4342, lat: 36.3321 },
      },
      currentSteps: 5200,
      goalSteps: 8000,
      walkingMetric: {
        stepLengthMeters: 0.69,
        source: "RESEARCH_ESTIMATE",
        modelVersion: "HAN_2026_V1",
      },
    };

    expect(recommendationRequestSchema.safeParse(baseRequest).success).toBe(
      true,
    );
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        walkingMetric: {
          ...baseRequest.walkingMetric,
          stepLengthMeters: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        unknownConstraint: 30,
      }).success,
    ).toBe(false);
    expect(
      recommendationRequestSchema.safeParse({
        ...baseRequest,
        deadline: "2026-07-24T18:00:00+09:00",
        maxExtraMinutes: 25,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(true);
  });

  it("연구식으로 필수 신체정보를 개인화 한 걸음 길이로 환산한다", () => {
    expect(
      estimatePersonalizedStepLengthMeters(
        {
          birthYear: 1976,
          heightCm: 170.73,
          weightKg: 72.92,
          biologicalSex: "FEMALE",
        },
        2026,
      ),
    ).toBeCloseTo(0.694, 3);
    expect(() =>
      estimatePersonalizedStepLengthMeters(
        {
          birthYear: 2010,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "MALE",
        },
        2026,
      ),
    ).toThrow(/18~90세/u);
  });

  it("v2 설정에서 생물학적 성별을 필수로 검증한다", () => {
    expect(
      storedPreferencesV2Schema.safeParse({
        version: 2,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
        },
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(false);
    expect(
      storedPreferencesV1Schema.safeParse({
        version: 2,
        dailyGoalSteps: 8000,
        strideLengthMeters: 0.7,
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      }).success,
    ).toBe(false);
  });

  it("v3 설정은 당일 현재 걸음과 프로필만 저장한다", () => {
    expect(
      storedPreferencesV3Schema.safeParse({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate: "2026-07-26",
      }).success,
    ).toBe(true);
    expect(
      storedPreferencesV3Schema.safeParse({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate: "2026-07-26",
        maxExtraMinutes: 20,
      }).success,
    ).toBe(false);
  });

  it("KAIST와 대전역의 거리가 50m보다 멀다", () => {
    expect(
      haversineDistanceMeters(
        { lng: 127.3604, lat: 36.3723 },
        { lng: 127.4342, lat: 36.3321 },
      ),
    ).toBeGreaterThan(50);
  });

  it("익명 UI 이벤트는 허용된 enum만 받고 위치·검색·식별 정보는 거절한다", () => {
    const event = {
      version: "route-pulse-v1",
      event: "recommendation_succeeded",
      uiState: "results",
      experienceMode: "guided",
      outcome: "success",
      durationBucket: "1to3s",
    };

    expect(uiEventPayloadSchema.safeParse(event).success).toBe(true);
    expect(
      uiEventPayloadSchema.safeParse({
        ...event,
        query: "대전역",
        coordinates: { lat: 36.3, lng: 127.4 },
        sessionId: "private-session",
      }).success,
    ).toBe(false);
  });

  it("지하철역과 시간표 기반 출발 응답을 실시간 정보와 구분한다", () => {
    const station = {
      id: "223",
      stationCode: "104",
      name: "대전",
      lineCode: "S3001",
      lineName: "대전 도시철도 1호선",
      englishName: "Daejeon",
      hanjaName: "大田",
      transferType: "일반역",
      transferLineCode: null,
      transferLineName: null,
      latitude: 36.331583,
      longitude: 127.433118,
      operatorName: "대전교통공사",
      roadAddress: null,
      phoneNumber: null,
      dataDate: "2026-06-25",
      tagoStationId: "MTRDJ10004",
      tagoRouteName: "1호선",
      mappingStatus: "MAPPED",
      active: true,
    };
    expect(subwayStationSchema.safeParse(station).success).toBe(true);
    expect(
      subwayDeparturesResponseSchema.safeParse({
        items: [],
        scheduleAvailable: false,
        unavailableReason: "TAGO_STATION_UNRESOLVED",
        scheduleBased: true,
        realtimeAvailable: false,
        fetchedAt: "2026-07-27T03:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      subwayDeparturesResponseSchema.safeParse({
        items: [],
        scheduleAvailable: true,
        unavailableReason: null,
        scheduleBased: false,
        realtimeAvailable: true,
        fetchedAt: "2026-07-27T03:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
