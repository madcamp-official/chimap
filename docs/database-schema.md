# 데이터베이스 스키마와 저장 계약

기준 구현은 PostgreSQL 18 + PostGIS 3.6이며, 2026-07-27 운영 DB에서
migration 1~7, 정류장 227,225개, TAGO 연결 정류장 2,844개, 노선 134개,
노선-정류장 관계 5,731개, 활성 지하철역 1,097개와 TAGO 매핑 706개를
확인했습니다. 운영 수치는
[구현·운영 현황](./current-state.md)에서 갱신합니다.

## 1. 경계와 원칙

CHIMap은 PostgreSQL 18과 PostGIS를 사용합니다. DB에는 전국 버스 정류장,
TAGO 식별자, 노선과 노선-정류장 순서 같은 정적 교통 데이터와, 사용자가
지하철역·노선과 TAGO 역 ID 같은 정적 교통 데이터, 사용자가 선택적으로
로그인한 경우의 최소 계정·web/mobile session, refresh token
family와 암호화된 retry credential만 저장합니다.

production과 staging은 schema 계약과 migration 코드는 같지만 서로 다른 Compose
project·network·PostgreSQL volume을 사용합니다. Web·iOS·Android는 선택한 환경의
API를 통해 그 환경 안의 계정과 기준 데이터를 공유합니다. production dump를
staging에 복원하거나 양쪽 DB를 동기화하는 작업은 기본 운영 절차에 포함하지
않으며, 필요한 테스트 fixture와 교통 seed만 staging에 별도로 적재합니다.

다음 정보는 영구 저장하지 않습니다.

- 사용자의 검색어와 자동완성 결과
- 현재 위치와 출발지·목적지 선택
- 현재·목표 걸음과 자동 추천 요청
- 만 나이에서 파생한 출생연도, 신장, 체중, 생물학적 성별과 개인화 프로필
- TAGO 도착·차량의 실시간 응답
- TAGO 지하철 시간표 응답
- Kakao·NAVER·TAGO 원문 응답
- API 자격 증명
- 카카오 access token과 refresh token
- CHIMap session token 원문

장소·주소·경로·실시간 교통 정보는 메모리 캐시의 TTL이 끝나면 제거됩니다.
브라우저의 사용자 환경설정과 개인화 걸음 프로필은 versioned localStorage
계약으로만 관리합니다. API에는 연구식으로 계산한 한 걸음 길이와 모델
버전만 전달합니다.

## 2. 연결 정책

```dotenv
DATABASE_URL=postgresql://chimap:change-me@postgres:5432/chimap
DATABASE_POOL_MAX=10
DATABASE_CONNECT_TIMEOUT_MS=3000
DATABASE_STATEMENT_TIMEOUT_MS=5000
DATABASE_SSL_MODE=disable
```

- API는 프로세스당 하나의 `pg.Pool`을 사용하며 최대 10 connections입니다.
- 데이터 관리 CLI는 최대 2 connections를 사용합니다.
- 단일 쿼리는 `pool.query`를 사용합니다.
- transaction은 하나의 checked-out client에서
  `BEGIN/COMMIT/ROLLBACK` 전체를 실행합니다.
- HTTP 서버가 새 연결을 받지 않게 한 뒤 `pool.end()` 완료를 기다립니다.
- Compose 내부 연결은 TLS 없이 격리된 network를 사용합니다. 관리형 DB로
  전환할 때 `require` 또는 `verify-full`을 사용합니다.

## 3. extension과 migration

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version bigint PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

migration 실행기는 다음 순서를 보장합니다.

1. `pg_advisory_lock(hashtext('chimap:transit:migrations'))`
2. 적용된 version과 SHA-256 checksum 조회
3. 같은 version의 checksum이 다르면 즉시 중단
4. migration 하나마다 별도 transaction
5. 성공 후 version/name/checksum 기록
6. advisory lock 해제

migration 2는 CSV `source_stop_no`와 기존 TAGO `node_id`가 정확히 같은
정류장 1,173쌍의 노선 관계를 CSV row로 옮긴 뒤 별도 TAGO row를 제거하고
식별자를 연결했습니다. 운영 적용 후 같은 정확 중복 조합은 0건입니다.

migration 3은 선택형 카카오 로그인에 필요한 `app_users`, `oauth_accounts`,
`auth_sessions`를 추가합니다. 기존 교통 테이블이나 익명 웹 사용자의 브라우저
저장 데이터는 변경하지 않습니다. 운영 DB 적용과 별도 PostGIS 복원을
완료했으며 실제 계정 E2E 전 계정·OAuth·session row는 각각 0건입니다.

migration 4는 기존 Web row를 backfill하는 default를 유지하면서 모바일 token
kind, platform, family/generation, grace/revoke column과 index를 additive하게
추가합니다. 적용된 migration 1~3의 SQL과 checksum은 수정하지 않습니다.

migration 5는 `oauth_accounts.provider` 허용값에 `APPLE`을 추가합니다. migration
6은 Apple authorization code 교환으로 받은 refresh token을 평문이 아닌
AES-256-GCM ciphertext/IV/tag와 마지막 Apple 검증 시각을 보관할 column을
추가합니다. Kakao account는 네 column이 모두 NULL이어야 하고 Apple credential은
네 값이 모두 존재해야 하는 check constraint를 둡니다.

migration 7은 CSV의 역·노선 row와 TAGO 매핑 상태를 보존하는
`subway_station_lines`를 추가합니다. 기존 버스·인증 row는 변경하지 않습니다.

전역 실행 registry는 `apps/api/src/migrations.ts`입니다. 교통 migration 1~3은
`apps/api/src/transit/migrations.ts`, 인증 migration 4는
`apps/api/src/auth/migrations.ts`가 소유하며 전역 registry가 순서대로 합칩니다.
API와 CLI가 checksum을 계산합니다.
`apps/api/migrations/001_transit.sql`은 version 1 DDL을 사람이 확인하거나
초기 환경에서 참고하기 위한 mirror이며, 최신 migration 전체의 실행 원본이
아닙니다. 새 변경은 TypeScript migration에 새 version으로 추가하고 기존
version의 SQL을 수정하지 않습니다.

## 4. 물리 스키마

### 4.1 bus_stops

```sql
CREATE TABLE bus_stops (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_code varchar(20),
  node_id varchar(100),
  source_stop_no varchar(100),
  ars_id varchar(100),
  region_name varchar(200),
  name varchar(200) NOT NULL,
  location geography(Point, 4326) NOT NULL,
  source varchar(20) NOT NULL CHECK (source IN ('csv', 'tago')),
  source_identity text,
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX bus_stops_city_node_unique
  ON bus_stops(city_code, node_id)
  WHERE city_code IS NOT NULL AND node_id IS NOT NULL;

CREATE UNIQUE INDEX bus_stops_source_identity_unique
  ON bus_stops(source_identity)
  WHERE source_identity IS NOT NULL;

CREATE INDEX bus_stops_location_gist
  ON bus_stops USING gist(location);

CREATE INDEX bus_stops_source_stop_no_index
  ON bus_stops(source_stop_no);
```

`source_identity`는 CSV의 정류장번호·이름·위도·경도를 정규화해 만든 SHA-256
값입니다. 위도와 경도는 중복 컬럼으로 저장하지 않습니다.

```sql
ST_Y(location::geometry) AS latitude,
ST_X(location::geometry) AS longitude
```

### 4.2 bus_routes

```sql
CREATE TABLE bus_routes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_code varchar(20) NOT NULL,
  route_id varchar(100) NOT NULL,
  route_no varchar(100) NOT NULL,
  route_name varchar(200) NOT NULL,
  route_type varchar(100),
  start_stop_name varchar(200),
  end_stop_name varchar(200),
  first_bus_time varchar(20),
  last_bus_time varchar(20),
  weekday_interval_minutes integer
    CHECK (weekday_interval_minutes IS NULL OR weekday_interval_minutes > 0),
  weekend_interval_minutes integer
    CHECK (weekend_interval_minutes IS NULL OR weekend_interval_minutes > 0),
  source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(city_code, route_id)
);

CREATE INDEX bus_routes_number_index
  ON bus_routes(city_code, route_no);
```

### 4.3 bus_route_stops

```sql
CREATE TABLE bus_route_stops (
  route_internal_id bigint NOT NULL
    REFERENCES bus_routes(id) ON DELETE CASCADE,
  stop_internal_id bigint NOT NULL
    REFERENCES bus_stops(id) ON DELETE CASCADE,
  node_order integer NOT NULL CHECK (node_order >= 0),
  direction varchar(100),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(route_internal_id, stop_internal_id, node_order),
  UNIQUE(route_internal_id, node_order)
);

CREATE INDEX bus_route_stops_stop_index
  ON bus_route_stops(stop_internal_id);
```

노선의 정류장 전체 교체는 노선 upsert, 기존 관계 삭제, 정류장 연결,
관계 삽입을 하나의 transaction으로 실행합니다. 한 정류장이라도 실패하면
이전 노선 관계가 유지됩니다.
겹치는 노선을 동시에 갱신할 때 PostgreSQL deadlock `40P01`이 발생하면 해당
transaction 전체만 최대 두 번 다시 실행합니다. 다른 DB 오류는 재시도하지
않습니다.

### 4.4 subway_station_lines

```sql
CREATE TABLE subway_station_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  station_code varchar(50) NOT NULL,
  station_name varchar(200) NOT NULL,
  line_code varchar(50) NOT NULL,
  line_name varchar(200) NOT NULL,
  english_name varchar(200),
  hanja_name varchar(200),
  transfer_type varchar(100),
  transfer_line_code varchar(200),
  transfer_line_name varchar(500),
  location geography(Point, 4326) NOT NULL,
  operator_name varchar(200) NOT NULL,
  road_address varchar(500),
  phone_number varchar(100),
  data_date text NOT NULL,
  tago_station_id varchar(100),
  tago_route_name varchar(200),
  mapping_status varchar(20) NOT NULL,
  mapping_checked_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(station_code, line_code, line_name, operator_name)
);

CREATE INDEX subway_station_lines_location_gist
  ON subway_station_lines USING gist(location);
```

CSV import는 임시 staging table에 검증된 1,097개 row를 먼저 넣고 하나의
transaction에서 전체 기존 row를 비활성화한 다음 자연키 upsert로 현재 파일의
row만 다시 활성화합니다. TAGO ID와 매핑 상태는 conflict update 대상에서
제외하므로 재import와 원본 누락에도 보존됩니다.

### 4.5 사용자와 로그인 세션

```sql
CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  display_name varchar(100),
  profile_image_url text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_login_at timestamptz NOT NULL
);

CREATE TABLE oauth_accounts (
  provider varchar(20) NOT NULL CHECK (provider IN ('KAKAO', 'APPLE')),
  provider_user_id varchar(100) NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  refresh_token_ciphertext bytea,
  refresh_token_iv bytea,
  refresh_token_tag bytea,
  refresh_token_validated_at timestamptz,
  PRIMARY KEY(provider, provider_user_id),
  UNIQUE(provider, user_id)
);

CREATE TABLE auth_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  token_kind varchar(20) NOT NULL,
  client_platform varchar(10) NOT NULL,
  family_id uuid,
  generation integer NOT NULL,
  rotated_at timestamptz,
  replaced_by_token_hash char(64),
  grace_period_expires_at timestamptz,
  retry_response_ciphertext bytea,
  retry_response_iv bytea,
  retry_response_tag bytea,
  retry_access_expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason varchar(40)
);
```

카카오 회원번호는 JavaScript 안전 정수 범위를 넘을 수 있으므로 숫자가 아닌
문자열로 보존합니다. 외부 카카오 토큰은 DB에 저장하지 않습니다. CHIMap
session은 256-bit 난수 원문을 HttpOnly cookie로 전달하되 DB에는 SHA-256
hash만 저장합니다. migration 4부터 Web cookie는 `WEB_SESSION/web`, 모바일은
`MOBILE_ACCESS|MOBILE_REFRESH`와 `ios|android`로 명시해 token 종류가 섞이지
않습니다.

모바일 refresh는 `(family_id, generation, token_kind)`가 고유합니다. rotation은
이전 refresh row를 `FOR UPDATE`로 잠그고 새 generation을 넣은 뒤, 이전 row에
`rotated_at`, 교체 token hash, DB `now()` 기준 120초 grace를 기록합니다. 직전
pair 원문은 grace 동안에만 server secret으로 AES-256-GCM 암호화해 보관합니다.
같은 이전 token의 grace 안 재요청은 이 pair를 재생하고, grace가 지난 재사용은
family의 모든 access/refresh row에 `revoked_at`을 설정합니다. 다른 mobile
family와 Web session에는 영향을 주지 않습니다. 이전 refresh row 자체를 즉시
삭제하지 않으며 grace가 끝난 retry ciphertext/IV/tag만 제거합니다. 따라서 만료된
token hash와 rotation metadata는 reuse 탐지에 남고, 직전 pair 원문은 grace보다
오래 보관되지 않습니다.

Apple refresh token은 계정 삭제 시 Apple `/auth/revoke`를 호출하기 위한
최소 provider credential이며 CHIMap refresh token과 다른 값입니다. 동일한
32-byte server key로 AES-256-GCM 암호화하고 원문을 응답·로그·브라우저에
노출하지 않습니다. 계정 삭제가 완료되면 `app_users` cascade로 OAuth credential과
모든 Web/mobile session도 함께 삭제됩니다.
Apple 계정의 CHIMap refresh 과정에서는 마지막 확인이 24시간을 넘었을 때만
Apple `/auth/token`으로 grant를 재검증합니다. `invalid_grant`이면 해당 mobile
family를 폐기하고, Apple의 일시적 네트워크/5xx 장애면 CHIMap session을 폐기하지
않고 다음 refresh에서 다시 확인합니다.

## 5. 공간 질의

주변 정류장은 `geography`의 미터 단위를 사용합니다.

```sql
SELECT
  id,
  city_code,
  node_id,
  name,
  ST_Y(location::geometry) AS latitude,
  ST_X(location::geometry) AS longitude,
  ST_Distance(
    location,
    ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
  ) AS distance_meters
FROM bus_stops
WHERE ST_DWithin(
  location,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
  $radiusMeters
)
ORDER BY distance_meters
LIMIT 100;
```

GiST index가 반경 후보를 줄이고 `ST_Distance`가 최종 거리 순서를 만듭니다.
공개 주변 정류장 API 반경 상한은 500m입니다. 추천 내부 조회는 같은
공간 질의를 500m→800m→기본 1.2km 순으로 반복하며, 별도
`TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS` 상한을 적용합니다. 각 단계에서
실제 노선이 0건인 정류장은 승하차 후보에서 제외합니다.

## 6. 전국 정류장 CSV import

1. UTF-8 BOM/UTF-8을 우선 해석하고 실패하면 CP949로 읽습니다.
2. header delimiter는 comma, tab, semicolon 후보 중에서 감지합니다.
3. 정류장번호·이름·위도·경도의 alias header를 검사합니다.
4. 정류장번호·이름·위도·경도의 유효성을 검증합니다. 유효하지 않은 원본
   행은 값을 보정하지 않고 제외 건수로 보고하며, 제외율이 1%를 넘으면 전체
   import를 중단합니다.
5. transaction 안에서 임시 `bus_stops_import` 테이블을 만듭니다.
6. `COPY FROM STDIN WITH (FORMAT csv)`로 일괄 적재합니다.
7. 좌표를 `geography(Point,4326)`로 변환합니다.
8. `source_identity` 충돌 시 지역·이름·좌표·갱신시각을 upsert합니다.
9. 허용 제외율 초과 또는 upsert 실패 시 전체 transaction을 rollback합니다.

동일 파일을 반복 import해도 row가 중복되지 않습니다.
일반 API의 5초 statement timeout은 유지하며 이 관리 transaction 안에서만
`SET LOCAL statement_timeout = '5min'`을 사용합니다.

## 7. TAGO reconcile과 동기화

TAGO 정류장의 `(city_code,node_id)`가 있으면 해당 row를 갱신합니다. 없으면
먼저 TAGO `node_id`와 CSV `source_stop_no`가 정확히 같은 단일 row를
연결합니다. 정확 일치가 없을 때만 30m 안에서 아직 TAGO ID가 연결되지
않은 CSV row를 찾고 정규화한 이름 유사도가 0.82 이상인 후보를 비교합니다.

- 한 후보가 두 번째 후보보다 0.1 이상 우세: 기존 CSV row에 TAGO ID 연결
- 여러 후보가 비슷함: ambiguous event를 남기고 TAGO row를 별도로 저장
- 적합 후보 없음: TAGO row 삽입

노선 정보와 정류장 순서는 TAGO API에서 다시 받아 transaction으로 교체합니다.
실시간 도착과 차량 위치는 DB에 저장하지 않습니다.

매일 systemd timer가 KAIST 1.2km와 대전역 500m 운영 지역을 갱신합니다.
상태 파일에는 시도·마지막 성공 시각, 지역 수, 성공·실패 노선 수, 안전한
실패 코드와 정적 교통 통계만 기록합니다.

## 8. 공개 API 계약

### 8.1 health

```ts
type HealthResponse = {
  status: "ok";
  timestamp: string;
};
```

### 8.2 readiness

```ts
type ReadinessResponse = {
  status: "ready" | "not_ready";
  timestamp: string;
  database: {
    connected: boolean;
    postgis: boolean;
    migrationsCurrent: boolean;
  };
  providers: {
    kakao: boolean;
    naver: boolean;
    tago: boolean;
  };
  transit: {
    stops: number;
    linkedStops: number;
    routes: number;
    routeStops: number;
  };
};
```

ready 조건은 DB 연결, PostGIS, 최신 migration, Kakao/NAVER/TAGO 키와 네 가지
교통 통계가 모두 충족되는 것입니다.

### 8.3 장소 검색

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

ID 접두사는 `kakao:place:`, `kakao:address:`,
`naver:address:`입니다. 중심 좌표는 전국 결과의 정렬에만 사용합니다.

### 8.4 역지오코딩

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

좌표는 소수점 다섯 자리로 cache key를 만듭니다. 주소를 찾지 못해도 원래
좌표로 현재 위치 Place를 구성할 수 있습니다.

### 8.5 추천

```ts
type RouteSource = "KAKAO" | "TAGO";

type RecommendationRequest = {
  origin: Place;
  destination: Place;
  currentSteps: number;
  goalSteps: number;
  walkingMetric: {
    stepLengthMeters: number;
    source: "RESEARCH_ESTIMATE";
    modelVersion: "HAN_2026_V1";
  };
};

type RecommendationResponse = {
  requestId: string;
  generatedAt: string;
  departureAt: string;
  baseline: BaselineSummary;
  walkingGoal: {
    remainingSteps: number;
    targetWalkDistanceMeters: number;
    toleranceSteps: number;
    effectiveStepLengthMeters: number;
    source: "RESEARCH_ESTIMATE";
  };
  primaryRecommendationId: string;
  recommendations: Recommendation[];
  warnings: ApiWarning[];
};
```

`Recommendation`은 `stepDifference`,
`goalFit: "WITHIN_TOLERANCE" | "UNDER" | "OVER"`와 도보 leg별
`walkingRole`을 포함합니다. 목표 운동 역할은 조기 하차
`GOAL_EARLY_ALIGHTING`과 늦은 탑승 `GOAL_LATE_BOARDING`으로 구분합니다.
마지막 버스의 조기 하차 후보를 먼저 조회하고 목표 ±5% 후보가 없을 때만
늦은 탑승과 양쪽 조합을 보완합니다.

공급자 원문 모델은 API 밖으로 노출하지 않으며 모든 경로 좌표는 WGS84
`{lng,lat}`로 정규화합니다.

### 8.6 익명 UI 이벤트

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

사용자가 동의한 경우에만 이 strict payload를
`POST /api/v1/ui-events`로 보내며 성공 응답은 `204 No Content`입니다.
서버는 PostgreSQL row나 개별 사용자 이력을 만들지 않고 허용된 enum label의
Prometheus `chimap_ui_events_total`만 증가시킵니다. 요청 본문과 IP는 분석
로그에 남기지 않습니다. 검색어, 좌표, 장소·노선 ID, 신체정보,
사용자·세션 ID와 정확한 시간값은 계약에 없으므로 추가하면 거절됩니다.

### 8.7 브라우저 개인화 저장 계약

```ts
type StoredPreferencesV3 = {
  version: 3;
  dailyGoalSteps: number;
  walkingProfile: {
    birthYear: number;
    heightCm: number;
    weightKg: number;
    biologicalSex: "MALE" | "FEMALE";
  };
  currentSteps: number;
  currentStepsDate: string; // 한국 날짜 YYYY-MM-DD
  lastOrigin?: Place;
  lastDestination?: Place;
};
```

화면에서는 만 나이를 받지만 연구식과 저장 호환을 위해 `birthYear`로
변환합니다. 생물학적 성별을 포함한 프로필과 하루 목표는 모두 필수입니다.
직접 한 걸음 길이를 입력하거나 20m를 걷게 하는 측정값은 저장하지 않습니다. version 1
계약은 프로필이 없으므로 온보딩을 다시 표시하고, version 2는 프로필·목표·
장소만 이전한 뒤 현재 걸음을 0으로 시작합니다. 새 저장은 version 3만
사용합니다. 현재 걸음은 한국 날짜가 같은 동안만 복구합니다. 이 객체는
PostgreSQL에 복제하지 않으며 API 요청에는 연구식으로 계산한
`walkingMetric`만 포함합니다.

마지막 출발지와 목적지 `Place`는 편의를 위해 이 브라우저 객체에 들어갈 수
있지만 서버 저장 계약은 아닙니다. 사용자가 입력 문자열을 수정하는 즉시
선택된 Place를 해제해 화면 문자열과 추천 좌표가 어긋나지 않게 합니다.

### 8.8 브라우저 UI 경험 저장 계약

```ts
type UiExperienceStateV1 = {
  version: 1;
  successfulRecommendationCount: number;
  densityPreference: "auto" | "guided" | "compact";
  motionPreference: "system" | "reduced";
  telemetryConsent: "unknown" | "granted" | "denied";
};
```

`chimap:ui-experience-v1` localStorage에만 저장합니다. `auto`는 성공 횟수
0~2회에 `guided`, 3회부터 `compact`를 파생합니다. 이 횟수는 추천 점수나
API 응답을 바꾸지 않고 보조 설명의 밀도에만 영향을 줍니다. 학습 초기화는
동의 상태를 보존한 채 나머지 값을 기본값으로 되돌립니다. OS의
`prefers-reduced-motion`과 `motionPreference=reduced` 중 하나라도 참이면
최종 동작 축소 상태가 됩니다.

## 9. 백업과 복구

systemd timer가 매일 다음 스크립트로 custom-format 백업을 생성합니다.

```bash
./ops/backup-postgres.sh
```

- `flock`으로 동시 백업 차단
- 임시 파일 생성 후 `pg_restore --list` 성공 시에만 최종 이름으로 이동
- archive마다 SHA-256 sidecar 생성
- `latest.json`에 완료시각, 파일명, byte, checksum 기록
- 일간 최근 7개 보관
- 주간 최근 4개 보관
- 월 1회 digest가 고정된 별도 PostGIS 18 컨테이너에 restore 검증
- PostGIS 이미지 초기화 후 `template0` 기반 빈 DB에 `pg_restore`
- 복구 시험 후 extension, migration, 버스 네 가지 통계와 지하철 table/index 확인
- `restore-latest.json`에 검증 완료시각과 통계 기록
- volume 장애 시 최신 검증 백업으로 새 volume을 만든 뒤 readiness 확인

최초 실제 데이터 백업의 파일명·크기·checksum과 restore 결과는
[구현·운영 현황](./current-state.md)에 기록합니다.

## 10. 보존과 개인정보

- 정류장·노선: 최신 공개 데이터로 대체될 때까지 보존
- schema migration: 서비스 수명 동안 보존
- 검색과 역지오코딩 cache: 각각 10분/60초/24시간 정책
- 실시간 도착·차량 cache: 초 단위 TTL 후 제거
- 애플리케이션 로그: provider, strategy, count, duration, HTTP status만 기록
- 검색어·좌표·키·원문 응답은 로그와 DB에 기록하지 않음
- 동의 기반 UI 이벤트: 허용 enum별 Prometheus counter만 기록하고 요청
  본문·IP·개별 사용자 이력은 저장하지 않음
