# API 레퍼런스

기준 base URL은 `https://chimap.madcamp-kaist.org`입니다. 모든 응답은
JSON이며 성공 응답과 오류 응답을 `@chimap/contracts`의 Zod schema로
검증합니다.

## 1. 공통 규칙

- 날짜·시간: UTC offset을 포함한 ISO 8601 문자열
- 좌표: WGS84 `{ "lng": 경도, "lat": 위도 }`
- request ID: 모든 응답 header의 `x-request-id`
- JSON request body 상한: 32KB
- 장소 조회 rate limit: IP당 기본 60회/분
- 추천 rate limit: IP당 기본 10회/분
- CORS: `WEB_ORIGIN`과 origin이 없는 서버 요청만 허용

오류 응답:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력값을 확인해 주세요.",
    "requestId": "00000000-0000-4000-8000-000000000000",
    "fieldErrors": {
      "query": ["두 글자 이상 입력해 주세요."]
    }
  }
}
```

`fieldErrors`는 필드별 상세 오류가 있을 때만 포함됩니다.

## 2. 상태 API

### `GET /api/v1/health`

프로세스가 HTTP 요청을 받을 수 있는지 확인하는 liveness입니다. 외부 공급자와
DB를 조회하지 않습니다.

```json
{
  "status": "ok",
  "timestamp": "2026-07-25T16:26:00.000Z"
}
```

### `GET /api/v1/readiness`

신규 배포를 트래픽에 연결할 수 있는지 확인합니다.

```json
{
  "status": "ready",
  "timestamp": "2026-07-25T16:26:00.000Z",
  "database": {
    "connected": true,
    "postgis": true,
    "migrationsCurrent": true
  },
  "providers": {
    "kakao": true,
    "naver": true,
    "tago": true
  },
  "transit": {
    "stops": 227223,
    "linkedStops": 2797,
    "routes": 134,
    "routeStops": 5638
  }
}
```

위 통계는 2026-07-26 01:26 KST 운영 스냅샷 예시이며 실제 데이터
동기화에 따라 증가할 수 있습니다.

다음 조건을 모두 만족하면 HTTP 200과 `ready`를 반환합니다.

- PostgreSQL 연결
- PostGIS extension
- 모든 migration의 최신 checksum
- Kakao, NAVER, TAGO 필수 키
- 네 교통 통계가 모두 0보다 큼

하나라도 실패하면 HTTP 503과 `not_ready`입니다.

## 3. 장소 검색

### `GET /api/v1/places`

| query | 필수 | 범위/기본값 | 설명 |
| --- | --- | --- | --- |
| `query` | 예 | 2~100자 | 장소명 또는 주소 |
| `scope` | 아니요 | `suggest\|resolve`, 기본 `resolve` | 검색 전략 |
| `x` | 아니요 | -180~180 | 중심 경도 |
| `y` | 아니요 | -90~90 | 중심 위도 |
| `limit` | 아니요 | 1~10, 기본 8 | 최대 결과 수 |

`x`와 `y`는 함께 제공해야 합니다. 중심 좌표는 전국 검색 범위를 제한하지 않고
Kakao 거리 정렬과 서버 최종 정렬에만 사용합니다.

```http
GET /api/v1/places?query=카이스트&scope=resolve&x=127.36&y=36.37&limit=8
```

응답:

```ts
type Place = {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category: string;
  location: { lng: number; lat: number };
};

type PlaceSearchResponse = {
  items: Place[];
  meta: {
    provider: "KAKAO" | "NAVER" | "NONE";
    strategy:
      | "KAKAO_KEYWORD"
      | "KAKAO_KEYWORD_ADDRESS"
      | "KAKAO_ADDRESS"
      | "NAVER_GEOCODE"
      | "NONE";
    fallbackUsed: boolean;
    degraded: boolean;
  };
};
```

ID 접두사:

- Kakao 장소: `kakao:place:`
- Kakao 주소: `kakao:address:`
- NAVER 주소: `naver:address:`

`provider=NONE`은 두 공급자가 정상 응답했지만 결과가 없다는 뜻입니다.
`degraded=true`는 일부 Kakao 호출이 실패했으나 다른 실제 결과를 반환했다는
뜻입니다.

## 4. 역지오코딩

### `GET /api/v1/places/reverse`

| query | 필수 | 범위 |
| --- | --- | --- |
| `x` | 예 | -180~180, 경도 |
| `y` | 예 | -90~90, 위도 |

```http
GET /api/v1/places/reverse?x=127.36&y=36.37
```

```ts
type ReverseGeocodeResponse = {
  place: Place | null;
  meta: {
    provider: "KAKAO" | "NAVER" | "NONE";
    fallbackUsed: boolean;
    degraded: boolean;
  };
};
```

두 공급자가 정상적으로 주소를 찾지 못하면 `place: null`입니다. UI는 이때
원래 GPS 좌표를 `현재 위치`로 사용할 수 있습니다.

## 5. 추천

### `POST /api/v1/recommendations`

요청:

```ts
type RecommendationRequest = {
  origin: Place;
  destination: Place;
  deadline: string;
  currentSteps: number;       // 0~100000
  goalSteps: number;          // 1~100000
  maxExtraMinutes: number;    // 0~120
  walkingMetric: {
    stepLengthMeters: number; // 0.3~1.2, 한 걸음 길이
    source: "RESEARCH_ESTIMATE";
    modelVersion: "HAN_2026_V1";
  };
  safetyBufferMinutes: number;// 0~15
};
```

브라우저는 필수 출생연도·신장·체중·생물학적 성별로 한 걸음 길이를
계산합니다. 이 원본 프로필은 요청 계약에 포함하지 않으며 서버에는 위
`walkingMetric` 파생값만 전송합니다. API는 직접 보폭 입력이나 20m 보행
측정값을 받지 않습니다.

추가 검증:

- 출발지와 목적지는 50m 이상 떨어져야 함
- 마감시간은 요청 시점보다 미래이고 6시간 이내
- 안전 여유시간을 제외한 유효 마감시간도 미래여야 함

응답:

```ts
type RouteSource = "KAKAO" | "TAGO";

type RecommendationResponse = {
  requestId: string;
  generatedAt: string;
  departureAt: string;
  baseline: BaselineSummary;
  walkingGoal: {
    remainingSteps: number;
    targetWalkDistanceMeters: number;
    toleranceSteps: number; // 남은 걸음의 5%
    effectiveStepLengthMeters: number;
    source: "RESEARCH_ESTIMATE";
  };
  primaryRecommendationId: string;
  recommendations: Recommendation[]; // 1~3개, 타입·ID 중복 없음
  warnings: ApiWarning[];
};
```

추천 타입은 `FAST`, `BALANCED`, `GOAL`입니다. 모든 경로 좌표와 거리는
정규화된 Kakao/TAGO 응답에서 가져옵니다.

각 추천은 `stepDifference`와
`goalFit: "WITHIN_TOLERANCE" | "UNDER" | "OVER"`를 포함합니다.
`primaryRecommendationId`는 남은 목표가 있을 때 목표에 가장 가까운 경로,
목표를 이미 달성했을 때 빠른 경로를 가리킵니다.

도보 leg의 `walkingRole`은 `ACCESS`, `TRANSFER`,
`GOAL_LATE_BOARDING`, `GOAL_EARLY_ALIGHTING` 중 하나입니다. 마지막
하차점을 앞당기는 `GOAL_EARLY_ALIGHTING` 후보를 먼저 조회하고 부족한
경우에만 늦은 탑승과 양쪽 조합을 추가합니다. 후보 생성기 호출 예산은
대중교통 경로 1회와 조정 도보 최대 8회이며 조기 하차 후보가 목표 ±5%를
충족하면 나머지 호출을 생략합니다.

버스 leg의 `bus.stops`는 승차부터 하차까지의 실제 TAGO 정류장 순서를
유지합니다. `coordinates`와 `bus.polyline`은 그 정류장 순서를 Kakao
Mobility Directions 도로 vertex에 매칭한 표시용 geometry입니다. 이는
버스 운영사의 정밀 GPS 궤적과는 구분합니다. 클라이언트 지도는 전체
`bus.stops`를 마커로 만들지 않고 첫 승차, 버스 간 환승, 최종 하차만
표시합니다.

주요 warning:

| code | 의미 |
| --- | --- |
| `ESTIMATED_STEPS` | 걸음과 도착시간은 계산값 |
| `CURRENT_TIME_ESTIMATE` | TAGO 정보는 지금 출발 기준 |
| `REALTIME_UNAVAILABLE` | 일부 도착정보를 정적 노선으로 추정 |
| `PARTIAL_TRANSIT_DATA` | 일부 TAGO 갱신 실패 |
| `PARTIAL_CANDIDATE_FAILURE` | 일부 후보만 계산 성공 |
| `GOAL_UNREACHABLE_WITHIN_CONSTRAINTS` | 제한 안에서 목표 ±5% 경로가 없어 최접근 경로 제공 |
| `LIMITED_ROUTE_VARIETY` | 충분히 다른 경로가 3개 미만 |

## 6. 교통 조회

권장 prefix는 `/api/v1/transit`입니다.

| 메서드와 경로 | 입력 | 응답 |
| --- | --- | --- |
| `GET /bus/stops/nearby` | `lat`, `lng`, `radiusMeters?` | 최대 100개 정류장, `partial` |
| `GET /bus/stops/:nodeId/routes` | `cityCode` | 노선 목록, `database\|tago` |
| `GET /bus/stops/:nodeId/arrivals` | `cityCode` | 도착 목록, 실시간 여부 |
| `GET /bus/routes/:routeId` | `cityCode` | 노선 기본정보 |
| `GET /bus/routes/:routeId/stops` | `cityCode` | 노선 정류장 순서 |
| `GET /bus/routes/:routeId/vehicles` | `cityCode` | 차량 위치, 실시간 여부 |
| `POST /recommendations` | 추천 요청 body | 추천 응답 |

위 표의 경로 앞에 `/api/v1/transit`을 붙입니다. 기존 클라이언트를 위한
`/api/transit` prefix도 현재 같은 router에 연결되어 있지만 신규 코드는
versioned prefix를 사용합니다.

## 7. 오류 코드

| code | 일반 상태 | 의미 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400/413 | query/body/크기 검증 실패 |
| `LOCATIONS_TOO_CLOSE` | 400 | 출발·도착 50m 미만 |
| `INVALID_LOCATION` | 400 | 공급자가 위치를 경로에 연결하지 못함 |
| `NOT_FOUND` | 404 | API 경로 없음 |
| `PLACE_NOT_FOUND` | 404 | 선택할 장소를 찾지 못함 |
| `NO_TRANSIT_ROUTE` | 404 | 최대 탐색 범위 안의 운행 정류장 없음 또는 직행/1회 환승 연결 없음 |
| `NO_ROUTE_WITHIN_DEADLINE` | 404 | 마감·추가시간을 만족하는 후보 없음 |
| `UPSTREAM_RATE_LIMIT` | 429 | 외부 공급자 사용량 제한 |
| `RATE_LIMITED` | 429 | CHIMap 자체 IP rate limit |
| `SERVICE_NOT_READY` | 503 | 공급자 설정 오류 |
| `TRANSIT_NOT_CONFIGURED` | 503 | TAGO 설정 누락 |
| `UPSTREAM_TIMEOUT` | 504/408 | 외부 timeout 또는 요청 취소 |
| `UPSTREAM_ERROR` | 502 | 외부 공급자 응답 오류 |
| `UNSUPPORTED_CITY` | 422 | 지원되지 않는 도시 계약 |
| `INTERNAL_ERROR` | 500 | 내부 처리 오류 |

브라우저에는 외부 공급자 원문, 키와 내부 stack을 노출하지 않습니다.
