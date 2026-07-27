# API 레퍼런스

기준 base URL은 `https://chimap.madcamp-kaist.org`입니다. JSON 본문이 있는
성공·오류 응답은 `@chimap/contracts`의 Zod schema로 검증합니다. 익명 UI
이벤트 성공만 본문 없는 `204 No Content`를 반환합니다.

staging은 같은 계약의 `https://staging.chimap.madcamp-kaist.org`를 사용하지만
별도 API process와 PostgreSQL volume에 연결됩니다. Web·iOS·Android가 한 환경의
API를 함께 쓰는 것은 의도된 server data 공유이며, 서로 다른 환경의 계정·session·
교통 seed가 자동으로 복제되지는 않습니다.

계약 구현 기준은 `feat/mobile/cross-platform-foundation`이며, 공개 Web/API
배포 기준은 별도로 [구현·운영 현황](./current-state.md)에 기록합니다. mobile
endpoint와 migration이 코드에 존재한다는 사실과 실제 store release를 구분합니다.

## 1. 공통 규칙

- 날짜·시간: UTC offset을 포함한 ISO 8601 문자열
- 좌표: WGS84 `{ "lng": 경도, "lat": 위도 }`
- request ID: 모든 응답 header의 `x-request-id`
- JSON request body 상한: 32KB
- 장소 조회 rate limit: IP당 기본 60회/분
- 추천 rate limit: IP당 기본 10회/분
- 익명 UI 이벤트 rate limit: IP당 기본 120회/분
- 인증 API rate limit: IP당 기본 20회/분
- CORS: `WEB_ORIGIN`과 origin이 없는 서버 요청만 허용, credential cookie 허용

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
  "timestamp": "2026-07-26T00:40:46.433Z"
}
```

### `GET /api/v1/readiness`

신규 배포를 트래픽에 연결할 수 있는지 확인합니다.

```json
{
  "status": "ready",
  "timestamp": "2026-07-26T00:40:47.478Z",
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
    "stops": 227225,
    "linkedStops": 2844,
    "routes": 134,
    "routeStops": 5731,
    "subwayStations": 1097,
    "activeSubwayStations": 1097,
    "mappedSubwayStations": 706,
    "subwayServiceLines": 46,
    "routeReadySubwayLines": 30,
    "providerMappedStations": 706,
    "busSubwayTransferEdges": 0
  }
}
```

위 응답은 2026-07-27 migration 7·CSV import·TAGO 매핑 후 예시이며 실제 데이터 동기화에
따라 시각과 통계가 달라질 수 있습니다.

다음 조건을 모두 만족하면 HTTP 200과 `ready`를 반환합니다.

- PostgreSQL 연결
- PostGIS extension
- 모든 migration의 최신 checksum
- Kakao, NAVER, 버스 4종과 지하철 TAGO 필수 키
- 버스 정류장·연결 정류장·노선·노선정류장 네 통계가 모두 0보다 큼

지하철 전체·활성·매핑 수는 readiness와 운영 지표에 포함됩니다. 토폴로지가
비어 있거나 조회에 실패하면 버스 추천은 계속 제공하고, 지하철 후보만 생략하는
부분 실패 정책을 사용합니다.

추천 응답의 대중교통 leg는 `WALK | BUS | SUBWAY`입니다. `SUBWAY`에는 서비스
노선 ID, 승·하차 역의 `stationLineId/sourceStationKey`, 중간 역, 방향과 실제
승차시간이 들어갑니다. BUS/SUBWAY leg의 `timing`은 `waitSeconds`,
`timingSource`, `isRealtime`, `plannedBoardingAt`, `updatedAt`, `stale`을
제공합니다. 환승 WALK leg는 `transferType`을 포함하며 geometry는 기존
`coordinates` 필드로 반환합니다.

하나라도 실패하면 HTTP 503과 `not_ready`입니다.

## 3. 선택형 카카오 로그인

웹은 로그인하지 않아도 검색·추천을 모두 사용할 수 있습니다. 카카오 로그인은
향후 모바일 계정과 웹 편의정보를 연결하기 위한 선택 기능입니다. 카카오
access/refresh token은 사용자 정보 확인 직후 폐기하며 서버 DB에는 저장하지
않습니다.

### `GET /api/v1/auth/session`

현재 CHIMap HttpOnly cookie를 확인합니다. 응답은 `Cache-Control: no-store`입니다.

```json
{
  "authenticated": false,
  "kakaoLoginAvailable": true,
  "user": null
}
```

로그인한 경우:

```json
{
  "authenticated": true,
  "kakaoLoginAvailable": true,
  "user": {
    "id": "00000000-0000-4000-8000-000000000000",
    "provider": "KAKAO",
    "displayName": "춘식이",
    "profileImageUrl": null
  }
}
```

### `GET /api/v1/auth/kakao/start`

브라우저가 직접 이동하는 endpoint입니다. 10분 유효한 고유 `state`를 생성해
서명된 `chimap_kakao_state` HttpOnly·SameSite=Lax cookie로 저장하고 카카오
인가 화면으로 `302` 이동합니다. 카카오 로그인이 설정되지 않은 환경은
`AUTH_NOT_CONFIGURED` 503을 반환합니다.

### `GET /api/v1/auth/kakao/callback`

Kakao Developers에 등록할 Redirect URI입니다. `code`와 `state`를 받고 서명된
cookie의 state와 constant-time 비교한 뒤 서버에서 인가 코드를 교환합니다.
성공하면 30일 기본 만료의 `chimap_session` HttpOnly·SameSite=Lax cookie를
발급하고 웹의 `/?auth=kakao-success`로 이동합니다. 운영 cookie에는 Secure도
적용합니다. 취소와 안전한 실패 결과만 웹 query에 전달하며 카카오 원문 오류나
토큰은 브라우저에 노출하지 않습니다.

### `POST /api/v1/auth/logout`

CHIMap 세션 hash row를 삭제하고 cookie를 만료시킵니다. 카카오계정 전체
로그아웃이나 앱 연결 해제는 수행하지 않습니다. 성공은 본문 없는 204입니다.

필수 서버 설정:

```dotenv
KAKAO_REST_API_KEY=
KAKAO_OAUTH_CLIENT_SECRET=
KAKAO_OAUTH_REDIRECT_URI=https://chimap.madcamp-kaist.org/api/v1/auth/kakao/callback
AUTH_SESSION_SECRET=
AUTH_SESSION_TTL_DAYS=30
```

Kakao Developers에서 카카오 로그인을 활성화하고 위 Redirect URI를 정확히
등록해야 합니다. Client Secret이 활성화된 앱이므로 토큰 요청에도 같은 값을
사용합니다.

## 4. 모바일 호환성과 선택 로그인

모바일은 Web cookie를 사용하지 않습니다. CHIMap access/refresh 원문은 256-bit
opaque token이고 DB에는 SHA-256 hash만 저장합니다. 성공 응답은 모두
`Cache-Control: no-store`입니다.

모바일 요청은 다음 세 header를 한 묶음으로 보냅니다. 하나만 보내는 요청은
400이며, 최소 지원 버전보다 낮으면 `CLIENT_UPDATE_REQUIRED` 426, 점검 중이면
`SERVICE_MAINTENANCE` 503입니다. header가 없는 기존 Web 요청은 이 mobile
version gate의 영향을 받지 않습니다.

```http
X-Client-Platform: ios
X-App-Version: 0.1.0
X-Contract-Version: v1
```

### `GET /api/v1/mobile-config`

인증 없이 호출하며 최소 iOS/Android 버전, maintenance 안내, 지원 지역,
privacy policy 버전, 차량 polling 주기와 guest/Kakao/Apple 활성 상태를
반환합니다. 앱은 이 endpoint 실패만으로 저장된 추천 화면을 막지 않습니다.

### `POST /api/v1/auth/kakao/mobile`

```json
{
  "kakaoAccessToken": "Kakao SDK가 발급한 access token",
  "platform": "android"
}
```

서버는 Kakao `access_token_info`의 `app_id`와 만료를 검증한 뒤 사용자 정보를
조회합니다. Kakao token 자체를 CHIMap session으로 사용하거나 저장하지 않습니다.

### `POST /api/v1/auth/apple/mobile`

iOS native Sign in with Apple이 준 `identityToken`, `authorizationCode`, `nonce`,
최초 동의 때만 제공될 수 있는 `displayName`, `platform: "ios"`를 받습니다. 서버는
Apple 공개키로 issuer/audience/nonce를 검증하고 authorization code를 Apple
`/auth/token`에서 교환합니다. 교환된 identity의 subject도 같아야 합니다.
Apple refresh token은 계정 삭제 시 grant를 철회하기 위해 server에서만
AES-256-GCM 암호화 보관합니다. 마지막 Apple 검증이 24시간을 넘으면 CHIMap
refresh 과정에서 grant도 재검증합니다. `invalid_grant`는 mobile family를
폐기하지만 Apple 일시 장애만으로는 사용자의 CHIMap session을 없애지 않습니다.

```json
{
  "tokenType": "Bearer",
  "accessToken": "CHIMap opaque access token",
  "accessExpiresAt": "2026-07-26T03:15:00.000Z",
  "refreshToken": "CHIMap opaque refresh token",
  "refreshExpiresAt": "2026-08-25T03:00:00.000Z",
  "user": {
    "id": "00000000-0000-4000-8000-000000000000",
    "provider": "KAKAO",
    "displayName": "춘식이",
    "profileImageUrl": null
  }
}
```

### `POST /api/v1/auth/token/refresh`

본문은 `{ "refreshToken": "..." }`입니다. 정상 token은 새 generation으로
rotation합니다. 네트워크 timeout으로 같은 이전 token을 다시 보냈을 때 DB
`grace_period_expires_at` 이내면 직전 CHIMap token pair를 그대로 반환합니다.
기본 grace는 120초입니다. grace가 지난 이전 token 재사용은 해당 mobile family
전체를 revoke하고 외부에는 원인을 구분하지 않는 `AUTH_SESSION_INVALID` 401만
반환합니다.

### `GET /api/v1/auth/me`

`Authorization: Bearer <accessToken>`으로 현재 사용자를 확인합니다. Web cookie는
이 endpoint의 인증 수단이 아닙니다. 만료·revoke·종류가 다른 token은
`AUTH_SESSION_INVALID` 401입니다.

### `POST /api/v1/auth/mobile/logout`

본문은 `{ "refreshToken": "..." }`입니다. 해당 mobile family만 revoke하며 다른
기기의 family와 Web cookie session은 유지합니다. 성공은 204입니다.

### `POST /api/v1/auth/mobile/account/delete`

`Authorization: Bearer <accessToken>`과
`{ "refreshToken": "...", "confirmation": "DELETE" }`를 함께 보냅니다. 두 token이
같은 유효 family에 속할 때만 `app_users`를 삭제하며 FK cascade로 OAuth account와
모든 Web/mobile session을 제거합니다. Apple 계정이면 transaction이 끝난 뒤
보관해 둔 refresh grant를 Apple `/auth/revoke`에서 철회 시도합니다. 공급자
장애나 이미 철회된 grant는 완료된 내부 삭제를 되돌리지 않습니다. 성공은
204입니다.

필수 서버 설정:

```dotenv
AUTH_MOBILE_ENABLED=1
AUTH_MOBILE_ACCESS_TTL_MINUTES=15
AUTH_MOBILE_REFRESH_TTL_DAYS=30
AUTH_REFRESH_GRACE_SECONDS=120
AUTH_REFRESH_RETRY_ENCRYPTION_KEY=
KAKAO_APP_ID=
APPLE_CLIENT_ID_IOS=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_BASE64=
```

Apple 네 값은 전부 설정되었을 때만 Apple 로그인이 활성화됩니다.
`APPLE_PRIVATE_KEY_BASE64`는 Developer Portal에서 받은 Sign in with Apple `.p8`
내용을 한 줄 base64로 인코딩한 값입니다.

## 5. 장소 검색

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

## 6. 역지오코딩

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

## 7. 추천

### `POST /api/v1/recommendations`

요청:

```ts
type RecommendationRequest = {
  origin: Place;
  destination: Place;
  currentSteps: number;       // 0~100000
  goalSteps: number;          // 1~100000
  walkingMetric: {
    stepLengthMeters: number; // 0.3~1.2, 한 걸음 길이
    source: "RESEARCH_ESTIMATE";
    modelVersion: "HAN_2026_V1";
  };
};
```

브라우저는 최초 설정에서 받은 만 나이·신장·체중·생물학적 성별로 한 걸음
길이를 계산합니다. 연구식 적용 직전에 만 나이를 출생연도로 변환하며, 원본
프로필은 요청 계약에 포함하지 않고 서버에는 위 `walkingMetric` 파생값만
전송합니다. API는 직접 보폭 입력이나 20m 보행 측정값을 받지 않습니다.

추가 검증:

- 출발지와 목적지는 50m 이상 떨어져야 함
- 현재 걸음은 0~100,000, 목표 걸음은 1~100,000 범위여야 함
- 요청에 선언되지 않은 필드는 거절함

서버는 최단 기본 경로를 먼저 구한 뒤 다음 식으로 자동 추가시간 범위를
정합니다.

```text
부족 도보거리 = max((목표−현재) × 한 걸음 길이 − 기본 경로 도보거리, 0)
부족 도보시간 = 부족 도보거리 ÷ 1.2835m/s
자동 추가시간 = clamp(ceil(부족 도보시간 × 1.25 + 5분), 15분, 90분)
```

목표를 이미 달성했다면 운동을 위한 새 우회 후보는 만들지 않지만, 공급자가
반환한 고유 기본 후보가 충분하면 세 경로를 비교할 수 있습니다. 자동
추가시간 안에서 `FAST`, `BALANCED`, `GOAL` 후보를 선별합니다.

이번 전환 릴리스 동안에는 기존의 `deadline`, `maxExtraMinutes`,
`safetyBufferMinutes`를 모두 포함한 strict 요청도 같은 endpoint에서
허용합니다. 기존 요청에는 종전 마감시간 검증과 필터를 적용하고 응답에
`Deprecation: true` header를 붙입니다. 새 웹 앱은 이 기존 형식을 보내지
않습니다. 새 형식과 기존 형식의 일부 필드만 섞은 요청은 거절합니다.

```ts
type LegacyRecommendationRequest = RecommendationRequest & {
  deadline: string;            // 현재보다 미래, 최대 6시간
  maxExtraMinutes: number;     // 0~120
  safetyBufferMinutes: number; // 0~15
};
```

기존 요청의 성공·오류 응답 모두 파싱이 끝난 뒤에는 `Deprecation: true`가
포함됩니다. 제거 시점은 이 전환 릴리스의 사용 현황을 확인한 뒤 별도로
공지합니다.

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

추천 타입은 `FAST`, `BALANCED`, `GOAL`입니다. `BALANCED`는 호환성을 위해
유지하며 화면 의미는 FAST 예상 걸음의 2배에 가장 가까운 `2배 걸음 경로`입니다.
`GOAL`은 남은 목표 걸음에 가장 가까운 `목표 근접 경로`입니다. 세 타입에는
서로 다른 route ID만 배정합니다. 모든 경로 좌표와 거리는 정규화된
Kakao/TAGO 응답에서 가져옵니다.

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
| `GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET` | 자동 추천 범위에서 목표 ±5% 경로가 없어 최접근 경로 제공 |
| `GOAL_UNREACHABLE_WITHIN_CONSTRAINTS` | 기존 시간 제약 요청에서 목표 ±5% 경로가 없어 최접근 경로 제공 |
| `LIMITED_ROUTE_VARIETY` | 충분히 다른 경로가 3개 미만 |

## 8. 익명 UI 이벤트

### `POST /api/v1/ui-events`

사용자가 화면 설정에서 공유를 허용한 경우에만 브라우저가 호출합니다.
성공 응답은 항상 `204 No Content`이며 `x-request-id` header는 유지합니다.
기본 rate limit은 IP당 120회/분입니다.

```ts
type UiEventPayload = {
  version: "route-pulse-v1";
  event:
    | "planner_viewed"
    | "place_search_started"
    | "place_selected"
    | "recommendation_started"
    | "recommendation_succeeded"
    | "recommendation_failed"
    | "route_selected"
    | "route_details_opened"
    | "experience_mode_changed";
  uiState:
    | "idle"
    | "editing-place"
    | "ready"
    | "calculating"
    | "results"
    | "route-selected"
    | "error";
  experienceMode: "guided" | "compact";
  outcome?: "success" | "empty" | "error" | "cancelled";
  durationBucket?: "lt1s" | "1to3s" | "3to8s" | "gt8s";
};
```

strict schema이므로 검색어, 좌표, 장소·노선 ID, 신체정보, 사용자·세션 ID,
정확한 시간값 등 추가 필드가 있으면 HTTP 400으로 거절합니다.
서버는 허용된 enum 조합을 `chimap_ui_events_total` Prometheus counter로만
집계하며 요청 본문을 PostgreSQL이나 분석 로그에 저장하지 않습니다.

## 9. 교통 조회

권장 prefix는 `/api/v1/transit`입니다.

| 메서드와 경로 | 입력 | 응답 |
| --- | --- | --- |
| `GET /bus/stops/nearby` | `lat`, `lng`, `radiusMeters?` | 최대 100개 정류장, `partial` |
| `GET /bus/stops/:nodeId/routes` | `cityCode` | 노선 목록, `database\|tago` |
| `GET /bus/stops/:nodeId/arrivals` | `cityCode` | 도착 목록, 실시간 여부 |
| `GET /bus/routes/:routeId` | `cityCode` | 노선 기본정보 |
| `GET /bus/routes/:routeId/stops` | `cityCode` | 노선 정류장 순서 |
| `GET /bus/routes/:routeId/vehicles` | `cityCode` | 차량 위치, 실시간 여부 |
| `GET /subway/stations/search` | `query`, `limit?` | 활성 역·노선 검색 결과 |
| `GET /subway/stations/nearby` | `lat`, `lng`, `radiusMeters?`, `limit?` | 거리순 활성 역·노선 결과 |
| `GET /subway/stations/:id/departures` | `direction=U\|D`, `at?`, `limit?` | 다음 시간표 출발편 |
| `POST /recommendations` | 추천 요청 body | 추천 응답 |

위 표의 경로 앞에 `/api/v1/transit`을 붙입니다. 기존 클라이언트를 위한
`/api/transit` prefix도 현재 같은 router에 연결되어 있지만 신규 코드는
versioned prefix를 사용합니다.

지하철 출발 응답은 실제 열차 GPS나 지연 반영 ETA가 아닙니다. 항상
`scheduleBased: true`, `realtimeAvailable: false`, `fetchedAt`을 포함하며 UI는
`TAGO 시간표 기반 예상`으로 표시해야 합니다. CSV 역이 TAGO ID에 매핑되지
않았으면 404 대신 다음과 같이 명시적인 빈 결과를 반환합니다.

```json
{
  "items": [],
  "scheduleAvailable": false,
  "unavailableReason": "TAGO_STATION_UNRESOLVED",
  "scheduleBased": true,
  "realtimeAvailable": false,
  "fetchedAt": "2026-07-27T03:00:00.000Z"
}
```

Web은 추천 응답을 받은 뒤 출발지와 도착지마다 `nearby`를 반경 2,000m,
최대 3개로 호출합니다. 각 위치에서 TAGO 매핑 역을 우선 선택하고 U/D
`departures`를 최대 2개씩 병렬 조회합니다. 일부 요청 실패는 추천 응답을
실패시키지 않습니다. 이 별도 조회 결과는 현재 추천의 소요시간·도보거리·
도착시각을 변경하지 않습니다.

## 10. 오류 코드

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
