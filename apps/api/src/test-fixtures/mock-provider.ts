import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type Coordinate,
  type NormalizedRoute,
  type Place,
  type RouteLeg,
} from "@chimap/contracts";

import { ProviderError } from "../errors.js";
import { normalizeSearchTerm } from "../services/cache.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
} from "../providers/types.js";

export type MockScenarioId =
  | "KAIST_TO_DAEJEON_STATION"
  | "KAIST_TO_YUSEONG_SPA"
  | "GOAL_ALREADY_ACHIEVED"
  | "TIGHT_DEADLINE"
  | "ONLY_TWO_VALID_CANDIDATES"
  | "PARTIAL_CANDIDATE_FAILURE";

type MockProviderOptions = {
  scenario?: MockScenarioId;
};

const KAIST: Place = {
  id: "kaist",
  name: "한국과학기술원 KAIST",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "교육 > 대학교",
  location: { lng: 127.3604, lat: 36.3723 },
};

const DAEJEON_STATION: Place = {
  id: "daejeon-station",
  name: "대전역",
  address: "대전 동구 정동 1-1",
  roadAddress: "대전 동구 중앙로 215",
  category: "교통 > 기차역",
  location: { lng: 127.4342, lat: 36.3321 },
};

const YUSEONG_SPA: Place = {
  id: "yuseong-spa-station",
  name: "유성온천역",
  address: "대전 유성구 봉명동",
  roadAddress: "대전 유성구 계룡로 지하 97",
  category: "교통 > 지하철역",
  location: { lng: 127.3417, lat: 36.3537 },
};

const GOVERNMENT_COMPLEX: Place = {
  id: "government-complex-station",
  name: "정부청사역",
  address: "대전 서구 둔산동",
  roadAddress: "대전 서구 한밭대로 지하 744",
  category: "교통 > 지하철역",
  location: { lng: 127.3848, lat: 36.3576 },
};

const CITY_HALL: Place = {
  id: "city-hall-station",
  name: "시청역",
  address: "대전 서구 둔산동",
  roadAddress: "대전 서구 둔산중로 지하 55",
  category: "교통 > 지하철역",
  location: { lng: 127.3846, lat: 36.3515 },
};

const JUNG_GU_OFFICE: Place = {
  id: "junggu-office-station",
  name: "중구청역",
  address: "대전 중구 대흥동",
  roadAddress: "대전 중구 중앙로 지하 71",
  category: "교통 > 지하철역",
  location: { lng: 127.4191, lat: 36.3257 },
};

const JUNGANGNO: Place = {
  id: "jungangno-station",
  name: "중앙로역",
  address: "대전 중구 은행동",
  roadAddress: "대전 중구 중앙로 지하 145",
  category: "교통 > 지하철역",
  location: { lng: 127.4255, lat: 36.3277 },
};

const CHUNGNAM_UNIVERSITY: Place = {
  id: "chungnam-university-stop",
  name: "충남대학교",
  address: "대전 유성구 궁동",
  roadAddress: "대전 유성구 대학로 99",
  category: "교통 > 버스정류장",
  location: { lng: 127.3456, lat: 36.3619 },
};

const HANBAT_ARBORETUM: Place = {
  id: "hanbat-arboretum",
  name: "한밭수목원",
  address: "대전 서구 만년동 396",
  roadAddress: "대전 서구 둔산대로 169",
  category: "여행 > 공원",
  location: { lng: 127.388, lat: 36.3664 },
};

const DAEJEON_SKYROAD: Place = {
  id: "daejeon-skyroad",
  name: "대전스카이로드",
  address: "대전 중구 은행동",
  roadAddress: "대전 중구 중앙로164번길 17",
  category: "여행 > 광장",
  location: { lng: 127.4277, lat: 36.3289 },
};

export const MOCK_PLACES: readonly Place[] = [
  KAIST,
  DAEJEON_STATION,
  YUSEONG_SPA,
  GOVERNMENT_COMPLEX,
  CITY_HALL,
  JUNG_GU_OFFICE,
  JUNGANGNO,
  CHUNGNAM_UNIVERSITY,
  HANBAT_ARBORETUM,
  DAEJEON_SKYROAD,
];

export const MOCK_SCENARIOS: ReadonlyArray<{
  id: MockScenarioId;
  description: string;
}> = [
  {
    id: "KAIST_TO_DAEJEON_STATION",
    description: "KAIST에서 대전역까지 정상 추천 3개",
  },
  {
    id: "KAIST_TO_YUSEONG_SPA",
    description: "KAIST에서 유성온천역까지의 짧은 이동",
  },
  {
    id: "GOAL_ALREADY_ACHIEVED",
    description: "현재 걸음 수가 목표를 이미 넘은 입력",
  },
  {
    id: "TIGHT_DEADLINE",
    description: "기본 경로도 안전 마감시간을 지키기 어려운 입력",
  },
  {
    id: "ONLY_TWO_VALID_CANDIDATES",
    description: "충분히 다른 유효 후보가 두 개뿐인 응답",
  },
  {
    id: "PARTIAL_CANDIDATE_FAILURE",
    description: "일부 조기 하차 도보 조회가 실패하는 응답",
  },
];

function interpolate(
  start: Coordinate,
  end: Coordinate,
  steps = 4,
): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps;
    return {
      lng: start.lng + (end.lng - start.lng) * ratio,
      lat: start.lat + (end.lat - start.lat) * ratio,
    };
  });
}

function pathThrough(points: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  points.forEach((point, index) => {
    const next = points[index + 1];
    if (next === undefined) {
      result.push(point);
      return;
    }
    const segment = interpolate(point, next, 3);
    result.push(...(index === 0 ? segment : segment.slice(1)));
  });
  return result;
}

function makeLeg(input: Omit<RouteLeg, "isExerciseSegment">): RouteLeg {
  return {
    ...input,
    isExerciseSegment: false,
  };
}

function createDaejeonRoutes(): NormalizedRoute[] {
  const railPath = pathThrough([
    GOVERNMENT_COMPLEX.location,
    CITY_HALL.location,
    JUNG_GU_OFFICE.location,
    JUNGANGNO.location,
    DAEJEON_STATION.location,
  ]);

  const routeOneLegs: RouteLeg[] = [
    makeLeg({
      id: "mock-fast-walk-start",
      mode: "WALK",
      guidance: "KAIST 정문에서 버스 정류장까지 이동",
      distanceMeters: 280,
      durationSeconds: 240,
      coordinates: interpolate(KAIST.location, {
        lng: 127.3627,
        lat: 36.3698,
      }),
    }),
    makeLeg({
      id: "mock-fast-bus",
      mode: "BUS",
      name: "104",
      guidance: "104번 버스로 정부청사역까지 이동",
      distanceMeters: 3600,
      durationSeconds: 960,
      stops: ["한국과학기술원", "충남대학교", "정부청사역"],
      coordinates: pathThrough([
        { lng: 127.3627, lat: 36.3698 },
        CHUNGNAM_UNIVERSITY.location,
        GOVERNMENT_COMPLEX.location,
      ]),
    }),
    makeLeg({
      id: "mock-fast-subway",
      mode: "SUBWAY",
      name: "대전 1호선",
      guidance: "정부청사역에서 대전역까지 이동",
      distanceMeters: 4400,
      durationSeconds: 960,
      stops: [
        "정부청사역",
        "시청역",
        "중구청역",
        "중앙로역",
        "대전역",
      ],
      coordinates: railPath,
    }),
    makeLeg({
      id: "mock-fast-walk-end",
      mode: "WALK",
      guidance: "대전역 출구까지 이동",
      distanceMeters: 150,
      durationSeconds: 240,
      coordinates: [DAEJEON_STATION.location],
    }),
  ];

  const routeTwoLegs: RouteLeg[] = [
    makeLeg({
      id: "mock-bus-walk-start",
      mode: "WALK",
      guidance: "충남대학교 정류장까지 이동",
      distanceMeters: 420,
      durationSeconds: 360,
      coordinates: interpolate(KAIST.location, CHUNGNAM_UNIVERSITY.location),
    }),
    makeLeg({
      id: "mock-bus-main",
      mode: "BUS",
      name: "705",
      guidance: "705번 버스로 대전역까지 이동",
      distanceMeters: 7600,
      durationSeconds: 1680,
      stops: [
        "충남대학교",
        "정부청사역",
        "시청역",
        "중구청역",
        "중앙로역",
        "대전역",
      ],
      coordinates: pathThrough([
        CHUNGNAM_UNIVERSITY.location,
        GOVERNMENT_COMPLEX.location,
        CITY_HALL.location,
        JUNG_GU_OFFICE.location,
        JUNGANGNO.location,
        DAEJEON_STATION.location,
      ]),
    }),
    makeLeg({
      id: "mock-bus-walk-end",
      mode: "WALK",
      guidance: "정류장에서 대전역 입구까지 이동",
      distanceMeters: 360,
      durationSeconds: 540,
      coordinates: [DAEJEON_STATION.location],
    }),
  ];

  const routeThreeLegs: RouteLeg[] = [
    makeLeg({
      id: "mock-walk-more-start",
      mode: "WALK",
      guidance: "월평역 방향으로 걸어서 이동",
      distanceMeters: 600,
      durationSeconds: 480,
      coordinates: interpolate(KAIST.location, {
        lng: 127.3668,
        lat: 36.366,
      }),
    }),
    makeLeg({
      id: "mock-walk-more-bus",
      mode: "BUS",
      name: "121",
      guidance: "121번 버스로 정부청사역까지 이동",
      distanceMeters: 2500,
      durationSeconds: 720,
      stops: ["한국과학기술원", "충남대학교", "정부청사역"],
      coordinates: pathThrough([
        { lng: 127.3668, lat: 36.366 },
        GOVERNMENT_COMPLEX.location,
      ]),
    }),
    makeLeg({
      id: "mock-walk-more-subway",
      mode: "SUBWAY",
      name: "대전 1호선",
      guidance: "정부청사역에서 대전역까지 이동",
      distanceMeters: 4400,
      durationSeconds: 930,
      stops: [
        "정부청사역",
        "시청역",
        "중구청역",
        "중앙로역",
        "대전역",
      ],
      coordinates: railPath,
    }),
    makeLeg({
      id: "mock-walk-more-end",
      mode: "WALK",
      guidance: "대전역까지 걸어서 이동",
      distanceMeters: 550,
      durationSeconds: 600,
      coordinates: [DAEJEON_STATION.location],
    }),
  ];

  return [
    {
      id: "mock-daejeon-fast",
      source: "MOCK",
      durationSeconds: 2400,
      distanceMeters: 8430,
      walkDistanceMeters: 430,
      transitDistanceMeters: 8000,
      transferCount: 1,
      fareWon: 1550,
      legs: routeOneLegs,
    },
    {
      id: "mock-daejeon-direct-bus",
      source: "MOCK",
      durationSeconds: 2580,
      distanceMeters: 8380,
      walkDistanceMeters: 780,
      transitDistanceMeters: 7600,
      transferCount: 0,
      fareWon: 1500,
      legs: routeTwoLegs,
    },
    {
      id: "mock-daejeon-walk-more",
      source: "MOCK",
      durationSeconds: 2730,
      distanceMeters: 8050,
      walkDistanceMeters: 1150,
      transitDistanceMeters: 6900,
      transferCount: 1,
      fareWon: 1550,
      legs: routeThreeLegs,
    },
  ].map((route) => normalizedRouteSchema.parse(route));
}

function createYuseongRoutes(): NormalizedRoute[] {
  const directDistance = Math.round(
    haversineDistanceMeters(KAIST.location, YUSEONG_SPA.location) * 1.15,
  );
  const firstLegs: RouteLeg[] = [
    makeLeg({
      id: "mock-yuseong-walk-start",
      mode: "WALK",
      guidance: "KAIST 정문 정류장까지 이동",
      distanceMeters: 250,
      durationSeconds: 210,
      coordinates: interpolate(KAIST.location, {
        lng: 127.3578,
        lat: 36.3692,
      }),
    }),
    makeLeg({
      id: "mock-yuseong-bus",
      mode: "BUS",
      name: "5",
      guidance: "마을버스 5번으로 유성온천역까지 이동",
      distanceMeters: Math.max(900, directDistance - 450),
      durationSeconds: 720,
      stops: ["한국과학기술원", "충남대학교", "유성온천역"],
      coordinates: pathThrough([
        { lng: 127.3578, lat: 36.3692 },
        CHUNGNAM_UNIVERSITY.location,
        YUSEONG_SPA.location,
      ]),
    }),
    makeLeg({
      id: "mock-yuseong-walk-end",
      mode: "WALK",
      guidance: "유성온천역 입구까지 이동",
      distanceMeters: 200,
      durationSeconds: 270,
      coordinates: [YUSEONG_SPA.location],
    }),
  ];

  return [
    normalizedRouteSchema.parse({
      id: "mock-yuseong-fast",
      source: "MOCK",
      durationSeconds: 1200,
      distanceMeters: directDistance,
      walkDistanceMeters: 450,
      transitDistanceMeters: Math.max(900, directDistance - 450),
      transferCount: 0,
      fareWon: 1500,
      legs: firstLegs,
    }),
  ];
}

function createDynamicTransitRoute(
  origin: Place,
  destination: Place,
): NormalizedRoute {
  const straightDistance = haversineDistanceMeters(
    origin.location,
    destination.location,
  );
  const walkStartDistance = 260;
  const walkEndDistance = 70;
  const transitDistance = Math.max(
    500,
    Math.round(straightDistance * 1.08 - walkStartDistance - walkEndDistance),
  );
  const scenarioPenalty =
    destination.id === JUNG_GU_OFFICE.id ? 240 : 0;
  const transitDuration =
    600 + Math.round(transitDistance / 6.5) + scenarioPenalty;
  const midpoint = interpolate(origin.location, destination.location, 5);
  const transferCount = destination.id === JUNG_GU_OFFICE.id ? 1 : 0;
  const legs: RouteLeg[] = [
    makeLeg({
      id: `mock-dynamic-${destination.id}-walk-start`,
      mode: "WALK",
      guidance: "가까운 정류장까지 이동",
      distanceMeters: walkStartDistance,
      durationSeconds: 210,
      coordinates: midpoint.slice(0, 2),
    }),
    makeLeg({
      id: `mock-dynamic-${destination.id}-transit`,
      mode: transferCount === 0 ? "BUS" : "SUBWAY",
      name: transferCount === 0 ? "705" : "대전 1호선",
      guidance: `${destination.name}까지 대중교통으로 이동`,
      distanceMeters: transitDistance,
      durationSeconds: transitDuration,
      stops: ["한국과학기술원", "정부청사역", destination.name],
      coordinates: midpoint,
    }),
    makeLeg({
      id: `mock-dynamic-${destination.id}-walk-end`,
      mode: "WALK",
      guidance: `${destination.name} 하차 지점까지 이동`,
      distanceMeters: walkEndDistance,
      durationSeconds: 90,
      coordinates: [destination.location],
    }),
  ];

  return normalizedRouteSchema.parse({
    id: `mock-transit-to-${destination.id}`,
    source: "MOCK",
    durationSeconds: 300 + transitDuration,
    distanceMeters: walkStartDistance + transitDistance + walkEndDistance,
    walkDistanceMeters: walkStartDistance + walkEndDistance,
    transitDistanceMeters: transitDistance,
    transferCount,
    fareWon: 1500,
    legs,
  });
}

export class MockMobilityProvider implements MobilityProvider {
  public readonly source = "MOCK" as const;
  public readonly mode = "mock" as const;

  readonly #scenario: MockScenarioId;

  public constructor(options: MockProviderOptions = {}) {
    this.#scenario = options.scenario ?? "KAIST_TO_DAEJEON_STATION";
  }

  public async searchPlaces(
    query: string,
    options: PlaceSearchOptions = {},
  ): Promise<Place[]> {
    if (options.signal?.aborted === true) {
      throw new ProviderError({
        kind: "ABORTED",
        message: "Mock 장소 검색이 취소되었습니다.",
      });
    }

    const normalizedQuery = normalizeSearchTerm(query).replace(/\s+/g, "");
    let candidates = MOCK_PLACES.filter((place) => {
      const searchable = normalizeSearchTerm(
        `${place.name} ${place.address} ${place.roadAddress} ${place.category}`,
      ).replace(/\s+/g, "");
      return (
        searchable.includes(normalizedQuery) ||
        normalizedQuery.includes(
          normalizeSearchTerm(place.name).replace(/\s+/g, ""),
        )
      );
    });

    if (
      this.#scenario === "ONLY_TWO_VALID_CANDIDATES" &&
      candidates.some((place) => place.category.includes("교통"))
    ) {
      candidates = [];
    }

    if (options.center !== undefined) {
      candidates = [...candidates].sort(
        (first, second) =>
          haversineDistanceMeters(first.location, options.center!) -
          haversineDistanceMeters(second.location, options.center!),
      );
      if (options.radiusMeters !== undefined) {
        candidates = candidates.filter(
          (place) =>
            haversineDistanceMeters(place.location, options.center!) <=
            options.radiusMeters!,
        );
      }
    }

    return candidates.slice(0, options.limit ?? 5);
  }

  public async getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    if (request.signal?.aborted === true) {
      throw new ProviderError({
        kind: "ABORTED",
        message: "Mock 대중교통 조회가 취소되었습니다.",
      });
    }

    if (
      haversineDistanceMeters(
        request.destination.location,
        DAEJEON_STATION.location,
      ) < 80 &&
      haversineDistanceMeters(request.origin.location, KAIST.location) < 200
    ) {
      const routes = createDaejeonRoutes();
      return this.#scenario === "ONLY_TWO_VALID_CANDIDATES"
        ? routes.slice(0, 2)
        : routes;
    }

    if (
      haversineDistanceMeters(
        request.destination.location,
        YUSEONG_SPA.location,
      ) < 80 &&
      haversineDistanceMeters(request.origin.location, KAIST.location) < 200
    ) {
      return createYuseongRoutes();
    }

    return [createDynamicTransitRoute(request.origin, request.destination)];
  }

  public async getWalkingRoute(
    request: WalkRouteRequest,
  ): Promise<NormalizedRoute> {
    if (request.signal?.aborted === true) {
      throw new ProviderError({
        kind: "ABORTED",
        message: "Mock 도보 조회가 취소되었습니다.",
      });
    }

    if (
      this.#scenario === "PARTIAL_CANDIDATE_FAILURE" &&
      haversineDistanceMeters(request.origin, JUNGANGNO.location) < 100
    ) {
      throw new ProviderError({
        kind: "UPSTREAM",
        message: "부분 실패 시나리오용 도보 조회 실패",
      });
    }

    const points = [request.origin, ...(request.vias ?? []), request.destination];
    let directDistance = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      directDistance += haversineDistanceMeters(
        points[index]!,
        points[index + 1]!,
      );
    }
    if (directDistance > 30_000) {
      throw new ProviderError({
        kind: "NO_ROUTE",
        message: "Mock 도보 경로가 너무 멉니다.",
      });
    }

    const distanceMeters = Math.max(1, Math.round(directDistance * 1.18));
    const durationSeconds = Math.max(1, Math.round(distanceMeters / 1.25));
    const routeCoordinates = pathThrough(points);

    return normalizedRouteSchema.parse({
      id: `mock-walk-${request.origin.lng.toFixed(4)}-${request.destination.lng.toFixed(4)}`,
      source: "MOCK",
      durationSeconds,
      distanceMeters,
      walkDistanceMeters: distanceMeters,
      transitDistanceMeters: 0,
      transferCount: 0,
      legs: [
        {
          id: "mock-walk-leg",
          mode: "WALK",
          guidance: "보행 경로를 따라 목적지까지 이동",
          distanceMeters,
          durationSeconds,
          coordinates: routeCoordinates,
          isExerciseSegment: false,
        },
      ],
    });
  }
}
