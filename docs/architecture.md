# 시스템 아키텍처

이 문서는 현재 작업 트리의 애플리케이션 구조를 설명합니다. 실제 공개
컨테이너와 번들에 반영됐는지는 [구현·운영 현황](./current-state.md)의 배포
스냅샷을 별도로 확인합니다.

## 1. 운영 토폴로지

```text
Browser
  ├─ NAVER Web Dynamic Map SDK
  ├─ localStorage/sessionStorage
  ├─ 선택형 Kakao Login / HttpOnly CHIMap session
  └─ HTTPS /api/v1
       ↓
Cloudflare Tunnel
       ↓ 127.0.0.1:3000
Docker Compose
  ├─ chimap-api
  │    Node.js 24 / Express 5 / 단일 프로세스
  │    └─ :9091 내부 metrics
  ├─ chimap-postgres
  │    PostgreSQL 18 / PostGIS 3.6 / named volume
  ├─ chimap-prometheus
  │    15초 수집 / 15일·2GiB / named volume
  ├─ chimap-alertmanager
  │    경보 그룹·억제·재전송 / 120시간 보존
  └─ chimap-alert-relay
       Slack·Discord·일반 webhook 형식 변환

systemd
  ├─ chimap-backup.timer
  ├─ chimap-backup-verify.timer
  └─ chimap-transit-sync.timer
```

PostgreSQL 5432는 host에 공개하지 않습니다. Cloudflare Tunnel origin은
API의 loopback 포트만 사용합니다. API metrics 9091은 Compose 내부에서만
접근하고 Prometheus 9090은 host loopback에만 공개합니다. Docker bridge
MTU는 NAVER TLS 경로의 handshake 안정성을 위해 1400으로 고정합니다.
Alertmanager 9093도 host loopback에만 공개하고 relay는 host port를
노출하지 않습니다.

### 환경별 frontend·DB 경계

DB는 Web/iOS/Android별로 나누지 않고 runtime 환경별로 나눕니다.

```text
Production Browser/iOS/Android
  → https://chimap.madcamp-kaist.org/api/v1
  → chimap API
  → chimap-postgres

Staging Browser/iOS/Android
  → https://staging.chimap.madcamp-kaist.org/api/v1
  → Cloudflare Tunnel → 127.0.0.1:3001
  → chimap-staging API
  → chimap-staging-postgres
```

같은 환경의 frontend는 server 계정·프로필·교통 기준 데이터를 같은 API로
공유합니다. client UI state, query cache, health 원본과 token 저장소는
environment·OS·user namespace로 격리합니다. staging은 production DB dump나
인증 session을 복제하지 않고 공개 교통 기준 자료만 독립 importer로 적재합니다.
구체적인 리소스명과 명령은 [staging 환경 운영서](./staging-environment.md)를
따릅니다.

## 2. 애플리케이션 컴포넌트

```text
React Web
  ├─ IntroSequence
  ├─ UiExperienceProvider
  │    숙련도·안내 밀도·모션·지표 동의(localStorage)
  ├─ ExperienceSettingsDialog
  ├─ WalkingProfileDialog
  │    필수 만 나이/신장/체중/생물학적 성별/하루 목표
  ├─ HeaderStepSummary
  │    현재 걸음 수정/목표/개인화 한 걸음
  ├─ AuthControl
  │    익명 이용/카카오 로그인/사용자 표시/로그아웃
  ├─ PlaceCombobox                │
  │    캠퍼스 중심/주소/출입구    │
  ├─ RecommendationCard          │ HTTPS
  ├─ RouteDetails                │
  ├─ NearbySubwayPanel           │ 주변 역 + U/D 시간표
  └─ MapView                     │
                                  ↓
Express API
  ├─ AuthService
  │    ├─ OAuth state HMAC
  │    ├─ Kakao code exchange + user identity
  │    └─ hash 기반 CHIMap session
  │
  ├─ PlaceLookupService
  │    ├─ KakaoLocalClient
  │    ├─ NaverGeocodingClient
  │    └─ MemoryCache + single-flight
  │
  ├─ RecommendationService
  │    ├─ CandidateGenerator
  │    ├─ RecommendationEngine
  │    └─ CachedMobilityProvider
  │         └─ TagoTransitMobilityProvider
  │              ├─ Kakao walking
  │              ├─ Kakao road geometry
  │              └─ TransitService
  │                   ├─ TAGO client
  │                   ├─ Subway CSV importer
  │                   └─ TransitRepository
  │
  ├─ AppMetrics
  │    ├─ HTTP·검색·추천·오류·동의 기반 UI enum
  │    ├─ DB pool·교통 통계·공급자 설정
  │    └─ 백업·교통 동기화 상태 파일
  └─ PostgreSQL Pool
```

외부 응답은 provider 경계에서 Zod로 검증하고 WGS84 내부 모델로
정규화합니다. API 응답도 공유 계약 패키지로 다시 검증합니다.

추천 계산은 버스 topology와 지하철의 노선 순서·방향별 구간 시간·환승 간선을
함께 사용합니다. 지하철 탑승 전후에는 Kakao 도보 경로를 붙이고, 기존 버스
경로의 첫·마지막 버스 구간과도 결합해 버스→지하철과 지하철→버스 후보를
만듭니다. 추천 성공 뒤 Web의 주변 역·TAGO U/D 시간표 조회도 별도로 유지합니다.
지하철 소요시간은 TAGO 시간표 기반 예상이며 실제 열차 위치나 지연은 반영하지
않습니다.

### Mobile application 경계

```text
apps/mobile
  ├─ src/features            guest-first 화면/auth/place/query/store
  ├─ src/platform
  │    ├─ apple/kakao        OS별 선택 로그인
  │    ├─ maps/location      NAVER native map / foreground 위치
  │    └─ steps              HealthKit / Health Connect
  ├─ app.config.ts           bundle/package, entitlement, native SDK key
  └─ plugins                 AndroidManifest/Info.plist CNG 변경

packages/contracts           Web/API/Mobile Zod 계약
packages/app-core            React 비의존 선택·stale 정책
packages/design-tokens       의미 기반 색·간격
```

Web, iOS, Android는 같은 API 계약을 사용하지만 UI component와 저장소 구현은
공유하지 않습니다. iOS와 Android만 `apps/mobile`의 feature source를 공유하고
OS SDK 차이는 `src/platform` 아래에 둡니다. CNG가 만드는 `ios/`, `android/`는
Git과 Docker image에 포함하지 않으며 EAS/Development Build pipeline에서만
생성합니다.

모바일 RouteStore와 추천 Query cache key는 environment, OS, user ID hash를
포함합니다. Web localStorage, iOS AsyncStorage, Android AsyncStorage 및 서로 다른
계정의 자료가 같은 key에 기록되지 않습니다.

guest는 고정 owner `guest-local`의 별도 namespace를 사용합니다. 로그인하면
CHIMap user ID hash namespace로 전환하고 guest cache를 계정 cache에 암묵적으로
합치지 않습니다. 이 원칙 때문에 Web/iOS/Android와 서로 다른 계정의 추천 응답,
선택 경로, 열린 상세 sheet가 충돌하지 않습니다. 앱 재실행 시 RouteStore의 마지막
요청 hash와 TanStack Query의 성공 응답을 결합해 상세 sheet까지 먼저 복원하고,
foreground 복귀 시 온라인이고 같은 한국 날짜에 생성된 활성 추천 중 5분을
엄격히 넘긴 query만 조용히 refetch합니다. fetch 중·offline·전날 요청은 중복
갱신하지 않고, 성공했으며 `persistRecommendation`을 명시한 추천만 최대 24시간
AsyncStorage에 보존합니다.

CNG가 생성하는 native project에는 수동 설정을 남기지 않습니다. iOS entitlement,
Info.plist, Android manifest, Gradle repository와 wrapper timeout은 `app.config.ts`와
config plugin에서 생성합니다. Android는 Kotlin 2.1.20과 minSdk 26을 고정하고,
NAVER `com.naver.maps`와 Kakao `com.kakao.sdk` artifact만 각 공식 Maven repository로
보내 다른 Android dependency가 국내 SDK repository에 잘못 resolve되지 않게 합니다.
`scripts/verify-mobile-native-config.mjs all|ios|android`가 CNG 직후 OS별 identity,
권한, repository, entitlement와 Privacy Manifest 경계를 검증합니다.

API는 mobile request header의 platform/app/contract version을 확인하지만 header가
없는 Web 호출에는 mobile minimum-version gate를 적용하지 않습니다. 배포는 Web,
iOS, Android가 독립적이고 계약 변경은 additive `/api/v1`을 우선합니다.

### UI 상태와 경험 파이프라인

```text
React query·폼·선택 상태
  → PlannerUiState 우선순위 계산
      calculating → error → editing-place
      → route-selected → results → ready → idle
  → app-shell data 속성
      ui-state / experience-mode / route-fit
      / reduced-motion / telemetry-consent
  → 검색·CTA·카드·지도 강조와 자동화 검증
```

숙련도와 안내 밀도는 추천 결과나 서버 점수에 관여하지 않습니다. 자동 모드는
브라우저의 추천 성공 횟수 0~2회에 `guided`, 3회부터 `compact`를 선택하고
보조 설명만 줄입니다. OS 모션 설정 또는 서비스의 `reduced` 설정 중 하나가
켜지면 경로 그리기·슬라이드·펄스를 제거합니다.

사용성 이벤트는 `telemetryConsent=granted`일 때만 브라우저에서 전송됩니다.
API의 strict schema와 분당 120회 IP rate limit을 통과한 enum만 Prometheus
counter로 집계하며 PostgreSQL이나 사용자별 분석 저장소를 만들지 않습니다.

`route-selected`는 결과가 존재하는 것뿐 아니라 사용자가 카드 선택이나 상세
열기로 경로와 상호작용한 상태입니다. 앱 루트는 CSS와 테스트가 함께 읽을 수
있는 다음 속성으로 계산 결과를 투영합니다.

| 속성 | 값 |
| --- | --- |
| `data-ui-state` | `idle`, `editing-place`, `ready`, `calculating`, `results`, `route-selected`, `error` |
| `data-experience-mode` | `guided`, `compact` |
| `data-route-fit` | `none`, `in-progress`, `complete` |
| `data-reduced-motion` | `true`, `false` |
| `data-telemetry-consent` | `unknown`, `granted`, `denied` |

`UiExperienceProvider`가 추천 성공 횟수와 사용자 설정을 localStorage에서
읽어 안내 밀도와 모션을 파생합니다. UI 이벤트 전송이 실패해도 추천 흐름은
계속됩니다.

### 선택형 웹 인증

```text
익명 진입
  → GET /api/v1/auth/session
  → 검색·추천·지도 계속 이용
  → 사용자가 카카오 로그인 선택
  → GET /api/v1/auth/kakao/start
  → Kakao authorize
  → GET /api/v1/auth/kakao/callback
  → app_users/oauth_accounts upsert
  → hash만 저장한 CHIMap session cookie
```

Kakao access/refresh token은 사용자 정보 확인 중에만 사용하고 저장하지
않습니다. 웹 세션은 HttpOnly·Secure·SameSite=Lax cookie이며 로그인 API가
실패해도 익명 추천 API에는 영향을 주지 않습니다.

## 3. 검색 시퀀스

### 자동완성

```text
입력 300ms
  → GET /api/v1/places?scope=suggest
  → Kakao keyword
      ├─ 결과 있음: 반환
      └─ 0건/복구 가능한 장애
           → Kakao address
              ├─ 결과 있음: 반환
              └─ 0건/복구 가능한 장애
                   → NAVER geocode
```

### 명시 검색

```text
Enter/검색 버튼
  → GET /api/v1/places?scope=resolve
  → Kakao keyword + address 병렬
  → 병합·20m 중복 제거·정렬
      ├─ 결과 있음: 반환
      └─ 최종 0건/복구 가능한 장애: NAVER geocode
```

Kakao/NAVER의 400·401·403 설정 오류는 보완으로 숨기지 않습니다. 외부 공급자
자체 장애가 발생하면 정상 0건과 구분된 API 오류를 반환합니다.

## 4. 추천 시퀀스

```text
RecommendationRequest
  → 브라우저 프로필로 HAN_2026_V1 한 걸음 길이 계산
  → 원본 프로필을 제외한 walkingMetric 전송
  → 입력·마감·거리 검증
  → 출발/도착 500m PostGIS 주변 정류장 + 운행 노선 확인
  → 연결 경로 없음: 800m → 최대 1.2km 단계 확장
  → 노선 0건 정류장 제외
  → 직행 후보, 필요 시 최대 1회 환승 후보
  → TAGO 도착정보 + 노선 정류장 순서
  → Kakao 도보 구간 + 버스 도로 매칭 geometry
  → baseline이 목표 ±5% 밖이면 실제 TAGO 정류장 순서로 운동 후보 생성
       ├─ 마지막 버스 조기 하차 상위 4개 우선
       ├─ 범위 내 후보 없음: 첫 버스 늦은 탑승 상위 2개
       └─ 여전히 없음: 늦은 탑승+조기 하차 조합 상위 1개
  → 마감/추가시간 필터
  → 중복 제거
  → FAST/FAST 대비 2배 걸음/목표 근접 후보를 고유 route로 선택
  → 남은 목표가 있으면 GOAL을 primaryRecommendationId로 지정
  → RecommendationResponse
```

추천 전체 timeout은 20초입니다. 후보 생성기 기준 대중교통 경로 호출은
1회, 조정 도보 호출은 최대 8회로 합계 최대 9회이며 동시성은 3입니다.
조기 하차 후보가 목표 범위에 들어오면 늦은 탑승과 양쪽 조합 호출은
생략합니다.

## 5. 데이터 저장 경계

### PostgreSQL에 저장

- 전국 공개 버스 정류장
- CSV 정류장과 TAGO `(cityCode,nodeId)` 연결
- TAGO 노선 기본정보
- 노선별 정류장 순서
- migration version/name/checksum
- 선택 로그인 사용자의 CHIMap UUID, 카카오 회원번호, 선택 nickname/profile
- SHA-256 hash만 보관한 Web/Mobile CHIMap session과 만료 시각
- 모바일 token family/generation, rotation/grace/revoke metadata
- 120초 grace 재시도용 AES-256-GCM 암호문, IV, tag

### PostgreSQL에 저장하지 않음

- 검색어와 장소 검색 결과
- GPS·출발지·목적지
- 걸음 수·목표와 자동 추천 요청
- 출생연도·신장·체중·생물학적 성별 원본 프로필
- 추천 요청·응답
- 실시간 버스 도착과 차량 위치
- 공급자 원문과 API 키
- 카카오 access/refresh token과 CHIMap session 원문
- HealthKit/Health Connect raw records와 모바일 추천 Query cache

검색·경로·실시간 자료는 프로세스 메모리 TTL 후 제거합니다. 개인화 걸음
프로필과 사용자 환경설정은 브라우저 localStorage version 3 계약으로만
저장하고, API에는 `stepLengthMeters`, `RESEARCH_ESTIMATE`,
`HAN_2026_V1`로 구성된 파생 `walkingMetric`만 전달합니다. version 1
선호는 개인화 온보딩을 다시 요구하고 version 2는 프로필·목표·장소를
이전합니다. 새 저장은 version 3만 사용하며 현재 걸음은 한국 날짜가 같은
동안만 복구합니다. 인트로 완료 상태는 sessionStorage에 저장합니다.

UI 숙련도는 별도 `UiExperienceStateV1` localStorage에만 저장합니다.
추천 성공 횟수로 보조 설명 밀도만 파생하며 서버 사용자 프로필과 결합하지
않습니다. `POST /api/v1/ui-events`는 사용자가 허용한 뒤 브라우저가 보내는
strict enum payload만 204로 집계합니다. 검색어·좌표·장소/노선 ID·
신체정보·사용자/세션 ID·정확한 시간값은 스키마에 없고, 서버는 본문이나
IP를 분석 로그에 기록하지 않습니다.

## 6. 캐시와 동시성

| 항목 | TTL |
| --- | --- |
| 장소 검색 성공 | 10분 |
| 장소 검색 정상 0건 | 60초 |
| 역지오코딩 | 24시간 |
| TAGO 주변 정류장 | 기본 300초 |
| TAGO 노선·노선 정류장 | 기본 24시간 |
| TAGO 도착 | 기본 20초 |
| TAGO 차량 | 기본 10초 |
| Kakao 도보 | 30분 |
| Kakao 버스 도로 geometry | 24시간 |

같은 key의 진행 중 요청은 하나의 Promise를 공유합니다. 캐시와 IP rate
limit은 프로세스 로컬이므로 현재 API는 단일 인스턴스로 운영합니다.
기본 rate limit은 장소 60회/분, 추천 10회/분, 익명 UI 이벤트 120회/분이며
각각 IP 단위입니다.

### 6.1 요청 범위 멀티모달 그래프

추천 요청은 DB 공간검색으로 출발·도착 주변 정류장과 역을 정하고, 끝점 정류장을
운행하는 버스 노선만 전체 정류장 순서로 확장합니다. 여기에 route-ready 지하철
segment와 사전 계산한 버스↔지하철 보행 간선을 결합합니다. 탐색은 서비스 탑승
상태를 유지해 같은 노선의 매 역마다 대기시간이 반복되지 않게 하고, 최대 2회
환승과 제한된 Pareto label로 요청 비용을 제한합니다.

결과 materializer가 도보는 Kakao 보행 geometry, 버스는 검증된 도로 geometry,
지하철은 실제 방향성 역열로 변환합니다. 실시간 공급자 장애는 각 leg의 정적
대기시간으로 격리되며 그래프 자체를 실패시키지 않습니다. 배포 중 새 데이터가
없거나 새 탐색 결과가 비면 기존 추천기로 자동 fallback합니다.

## 7. 장애 모델

- Kakao Local 복구 가능 장애: NAVER 주소 보완
- 주소 공급자 모두 정상 0건: 빈 결과 또는 `place: null`
- 자격 증명·API 선택 오류: HTTP 503 `SERVICE_NOT_READY`
- 공급자 timeout: HTTP 504 `UPSTREAM_TIMEOUT`
- 공급자 사용량 제한: HTTP 429 `UPSTREAM_RATE_LIMIT`
- TAGO 일부 실시간 실패: 정적 실제 경로가 있으면 warning과 함께 계속
- 확장 범위 내 운행 정류장 없음: 위치 구체화 안내와 `NO_TRANSIT_ROUTE`
- 운행 정류장은 있으나 직행/1회 환승 연결 없음: 연결 범위 안내와
  `NO_TRANSIT_ROUTE`
- 지도 SDK 실패: 추천 응답은 유지하고 실제 좌표 SVG 표시
- PostgreSQL/readiness 실패: 신규 배포 origin 승격 금지

서버 로그에는 request ID, path, provider, strategy, count, duration, status와
안전한 result code만 기록합니다. 검색어·좌표·키·원문은 기록하지 않습니다.

## 8. 종료와 재시작

Docker Compose가 `unless-stopped` 정책으로 API, DB, Prometheus,
Alertmanager와 relay를 재시작합니다. API는 SIGTERM/SIGINT를 받으면 사용자 HTTP와 metrics
server의 새 연결을 중단하고 최대 10초 안에 기존 요청을 정리한 뒤
PostgreSQL pool을 닫습니다.

별도 프로세스 관리자를 두지 않아 Compose와 애플리케이션의 재시작·로그·종료
책임이 겹치지 않습니다.

## 9. 백업과 모니터링

- 일일 백업은 `pg_dump -Fc`, archive 목록 검증, SHA-256 기록을 원자적으로
  수행합니다.
- 일간 7개와 일요일 주간 4개를 보존합니다.
- 월간 복구 시험은 최신 checksum을 먼저 검증하고 별도 PostGIS 18
  컨테이너의 `template0` 기반 빈 DB에 복원합니다.
- 일일 교통 갱신은 KAIST 1.2km와 대전역 500m의 실제 노선·정류장 순서를
  다시 받고 원자적 상태 파일에 성공 시각과 실패 노선을 기록합니다.
- Prometheus는 HTTP 상태·처리시간, 검색 전략·0건·보완, 추천 결과, 안전한
  오류 분류, 동의 기반 UI enum, DB pool, 정적 교통 row, 공급자 설정,
  백업·동기화와 알림 전달 상태를 수집합니다.
- label에는 검색어, 좌표, 차량번호, node/route ID, 키와 원문을 넣지
  않습니다.
- 20개 경보 규칙은 availability, API 품질, 백업, 교통 동기화와 알림 전달
  상태를 평가합니다.
- Alertmanager는 긴급 경보를 10초, 주의 경보를 30초 동안 묶은 뒤 relay로
  보내며 복구 상태도 전달합니다. relay는 비밀 URL을 runtime에만 읽고
  메시지에 경보명·요약·조치 설명·상태 확인 링크를 제공합니다.
- `EXTERNAL_ALERTS_ENABLED=0`이면 relay는 Alertmanager 요청을 `202 disabled`로
  종료하고 webhook을 호출하지 않습니다. health와
  `chimap_alert_relay_enabled=0`에 이 상태를 노출하며 Prometheus도 설정 누락
  경보를 만들지 않습니다. 활성화한 상태에서 URL만 없을 때에만
  `ChimapAlertDeliveryNotConfigured`를 표시합니다.

## 10. PM2를 사용하지 않는 이유

현재 구조에 PM2 cluster를 추가하면 worker마다 메모리 캐시, single-flight와
IP rate limit이 분리됩니다. 그 결과 같은 Kakao/NAVER/TAGO 호출이 중복될
수 있고 worker 수만큼 PostgreSQL pool connection이 늘어납니다. Docker와
PM2가 재시작·로그·graceful shutdown을 동시에 관리하는 문제도 생깁니다.

따라서 현재는 Docker Compose의 단일 Node 프로세스를 유지합니다. 다중
인스턴스가 필요해질 때 PM2 cluster가 아니라 공유 상태를 먼저 도입하고 API
컨테이너를 수평 확장합니다.

## 11. 수평 확장 전제

1. Redis 기반 공유 캐시와 single-flight
2. Redis 또는 gateway 기반 공유 rate limit
3. API 인스턴스 수를 반영한 PostgreSQL connection budget
4. 공급자 전체 호출 예산과 회로 차단
5. 여러 API 컨테이너를 향하는 origin/load balancer

이 조건을 갖춘 뒤 API 컨테이너를 수평 확장합니다.
