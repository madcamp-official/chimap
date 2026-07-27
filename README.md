# CHIMap

CHIMap은 개인의 하루 걸음 목표와 현재 걸음에 맞춰 실제 대중교통 기반 건강
경로를 자동으로 비교·추천하는 Web·iOS·Android 서비스입니다.

- 운영 주소: <https://chimap.madcamp-kaist.org>
- production/staging health 재확인: 2026-07-27 17:44 KST
- 전체 운영 검증 스냅샷: 2026-07-27 14:29 KST
- 런타임: Node.js 24 단일 프로세스 + PostgreSQL 18/PostGIS
- 운영 방식: Docker Compose + Cloudflare Tunnel
- 운영 Web/API 기준선: `feat/mobile/cross-platform-foundation` (`7a99e03`)
- cross-platform 구현 브랜치: `feat/mobile/cross-platform-foundation`
- 버스 위치·지도 시점·TAGO 지하철·migration 7 운영 배포: 2026-07-27 14:28 KST
- staging: `https://staging.chimap.madcamp-kaist.org`, 별도 Compose/DB volume,
  health/readiness 200·guest/Kakao 활성·Apple 비활성, 실제 추천 3건 확인

현재 배포 상태와 남은 운영 조치는
[구현·운영 현황](./docs/current-state.md)에 기록합니다.
현재 공개 readiness는 정류장 227,225개, TAGO 연결 정류장 2,844개,
노선 134개, 노선-정류장 관계 5,731개, 활성 지하철역 1,097개와 TAGO 매핑
706개입니다. 추천 요청이 새 지역의 실제 노선을 동기화하면 버스 관련 수치는
증가할 수 있습니다.

Route Pulse UI, 안내 밀도·동작 줄이기 설정, 동의 기반 익명 UI 이벤트, 자동
건강 경로 UX와 선택형 카카오 로그인이 공개 asset에 반영되어 있습니다.

## 핵심 사용자 흐름

웹에서는 카카오 로그인 없이 모든 경로 검색 기능을 사용할 수 있습니다. 원하면
헤더에서 카카오 로그인해 같은 CHIMap 계정 기반의 향후 모바일·웹 연동을
준비할 수 있습니다. iOS/Android 앱도 guest로 핵심 추천을 사용하고 필요할 때
Kakao 또는 iOS의 Apple 로그인을 선택합니다. 전체 순서는
[cross-platform 계획](./docs/cross-platform-plan.md), iPhone 12 Pro 기준 로컬
절차는 [iOS 개발 운영서](./docs/ios-development.md)에 기록합니다.

1. 출발지와 목적지를 300ms 자동완성 또는 Enter/검색 버튼으로 조회합니다.
2. 캠퍼스 중심·도로명 주소·출입구 표시를 확인하고 검색 결과를 직접
   선택합니다.
3. 최초 이용 시 만 나이·신장·체중·생물학적 성별·하루 목표 걸음으로
   개인화 한 걸음 길이를 계산합니다. 다섯 항목은 모두 필수이며 원본
   신체정보는 브라우저에만 저장합니다. 직접 한 걸음 길이를 입력하거나 일정
   거리를 걷게 하는 측정 절차는 사용하지 않습니다.
4. 헤더에서 현재 걸음을 확인하거나 수정하고 왼쪽 폼에서 `건강 경로 찾기`를
   누릅니다. 사용자가 추가 시간이나 마감시간을 결정할 필요는 없습니다.
5. 서버가 남은 목표와 기본 경로를 바탕으로 15~90분의 자동 추천 범위를
   계산하고 TAGO 버스, Kakao 도보와 도로 매칭 geometry를 조합합니다.
6. 목표 경로는 먼저 내려 걷는 후보를 우선하고, 필요할 때 더 뒤의
   정류장에서 탑승하는 후보를 결합합니다.
7. 빠른 경로, 빠른 경로 대비 약 2배 걸음 경로, 목표 근접 경로의
   시간·수단·도보·환승을 간단히
   비교합니다.
8. 카드를 선택해 NAVER 지도 경로를 바꾸고, 필요한 경로만 `자세히`를
   열어 전체 텍스트 이동 단계와 승하차 정보를 확인합니다.
9. 추천 아래에서 출발·도착 주변 역과 TAGO 시간표 기반 U/D 다음 출발을
   확인합니다. 지연을 반영한 실시간 ETA가 아니며 추천 시간에는 합산하지 않습니다.
10. 화면 설정에서 안내 밀도와 움직임을 조절하고 익명 사용성 정보 공유 여부를
   언제든 바꿀 수 있습니다.

추천 계산 중에는 가상 퍼센트나 완료된 것처럼 보이는 단계를 만들지 않고 실제
요청이 진행 중임을 한 경로 추적으로 표시합니다. 8초가 넘으면 교통 정보가
지연되고 있다는 설명과 장소를 수정할 수 있다는 선택지를 제공합니다.

현재 위치 버튼은 브라우저 GPS 좌표를 받아 Kakao→NAVER 순서로 주소를
확인합니다. 주소를 얻지 못해도 좌표 자체를 `현재 위치`로 사용할 수
있습니다.

추천은 출발·도착 각각 500m에서 운행 노선이 있는 정류장을 먼저 찾고,
연결 경로가 없으면 800m, 최대 1.2km까지 단계적으로 확장합니다. 멀어진
승하차 지점까지의 이동은 직선 추정이 아니라 Kakao 실제 도보 경로로
추천에 포함합니다.

## 데이터 공급자와 저장 경계

| 영역 | 공급자/저장소 | 역할 |
| --- | --- | --- |
| 지도 | NAVER Web Dynamic Map | 지도, 경로선, 승하차와 선별 차량 마커 |
| 장소 | Kakao Local | 키워드·주소 검색 |
| 주소 보완 | NAVER Geocoding | Kakao 0건 또는 복구 가능한 장애 시 주소 검색 |
| 역지오코딩 | Kakao→NAVER | GPS 좌표를 주소로 변환 |
| 도보 | Kakao Routing | 실제 도보 거리·시간·좌표 |
| 버스 선 | Kakao Mobility Directions | TAGO 정류장 순서를 보존한 도로 매칭 geometry |
| 버스 | 국토교통부 TAGO | 정류장·노선·도착·차량 |
| 지하철 | 국토교통부 TAGO | 역 검색·역별 시간표 기반 다음 출발 |
| 정적 교통 데이터 | PostgreSQL 18 + PostGIS | 전국 정류장·노선 순서·지하철역과 TAGO 매핑 |

경로 추천은 외부 공급자 응답과 전국 공개 정류장 자료만 사용합니다. 지도 SDK가
준비되지 않으면 같은 추천 응답의 실제 좌표를 SVG로 표시합니다.

사용자 검색어, GPS 좌표, 추천 요청, 실시간 도착·차량 원문은 PostgreSQL에
저장하지 않습니다. 익명 UI 이벤트도 명시적 동의 뒤 허용된 enum만
Prometheus counter로 집계하며 본문을 PostgreSQL에 저장하지 않습니다.
카카오 로그인 사용자는 카카오 회원번호와 선택 동의한 닉네임·프로필 사진,
CHIMap 사용자 ID를 저장합니다. 카카오 access/refresh token은 저장하지 않고,
CHIMap 세션도 원문 대신 SHA-256 hash만 저장합니다.

## 시스템 구성

```text
Browser
  ├─ NAVER Web Dynamic Map
  ├─ 선택형 Kakao Login (비회원 이용 가능)
  └─ HTTPS /api/v1
       ↓
Cloudflare Tunnel
       ↓ 127.0.0.1:3000
Docker Compose
  ├─ chimap-api (Node.js 단일 프로세스)
  ├─ PostgreSQL 18 + PostGIS
  ├─ Prometheus 3.13.1
  ├─ Alertmanager 0.32.1
  └─ alert-relay (Slack/Discord/일반 webhook)
       ↑ API·동기화·백업·알림 전달 상태

Staging Web/iOS/Android
  └─ HTTPS staging.chimap.madcamp-kaist.org/api/v1
       ↓ Cloudflare Tunnel → 127.0.0.1:3001
  chimap-staging Compose
  ├─ staging API
  └─ 별도 PostgreSQL/PostGIS volume

systemd timers
  ├─ 일일 custom-format 백업
  ├─ 월간 별도 PostGIS restore 검증
  └─ 일일 KAIST·대전역 TAGO 노선 동기화
```

프로세스 관리와 재시작은 Docker Compose가 담당합니다. 다중 API 인스턴스로
확장할 때는 Redis 기반 공유 캐시·single-flight·rate limit을 먼저
도입합니다. Compose bridge는 NAVER TLS 연결을 위해 MTU 1400을 사용합니다.

## 저장소 구조

```text
apps/api                 Express API, 공급자, 추천, 교통 DB/CLI
apps/alert-relay         Alertmanager 메시지 정규화와 외부 webhook 전달
apps/api/src/migrations.ts          실행 migration 순서의 source of truth
apps/api/migrations      version 1 PostgreSQL/PostGIS 참고 DDL
apps/api/test-data       출처와 checksum이 있는 실제 응답 캡처
apps/web                 React 검색·지도·추천 UI와 Playwright E2E
apps/mobile              React Native/Expo iOS·Android 공용 feature와 OS adapter
apps/web/test-data       출처와 checksum이 있는 실제 차량 응답 캡처
packages/contracts       요청·응답·내부 정규화 Zod 계약
packages/app-core        Web/RN 비의존 추천 선택·복원·stale 정책
packages/design-tokens   Web/RN에서 공유하는 의미 기반 token
docs                     아키텍처, 운영, 공급자, 테스트 문서
docs/cross-platform-plan.md  guest-first 선택 로그인과 iOS→Android 실행 계획
docs/staging-environment.md  production과 분리된 staging API/DB 운영
docs/ios-development.md      iPhone 12 Pro·Xcode·TestFlight 개발 기준
docs/user-experience.md  사용자 흐름, 상태, 반응형·접근성 계약
docs/database-schema.md  물리 스키마, API·브라우저 저장 계약
ops                      백업·동기화 timer, Prometheus와 Alertmanager 설정
compose.yml              운영 API, DB, 모니터링과 장애 알림
compose.staging.yml      staging API와 별도 PostgreSQL
.env.example             유일한 환경변수 템플릿
```

## 개발 시작

요구사항:

- Node.js `>=24 <25`
- pnpm `10.15.1`
- Docker Engine과 Docker Compose

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm build
docker compose up -d --build
```

Compose로 실행한 통합 애플리케이션은 `http://127.0.0.1:3000`에서
확인합니다. 루트 `.env`는 Git에서 제외되며 템플릿은
[`.env.example`](./.env.example) 하나만 유지합니다. 새 데이터베이스에서는
아래 초기 적재와 노선 동기화를 마칠 때까지 `/api/v1/readiness`가 `503`을
반환하는 것이 정상입니다.

`pnpm dev`의 Vite 웹은 `http://localhost:5173`, API는
`http://localhost:8080`을 사용합니다. 이 hot reload 형태는 host에서
접근 가능한 별도 PostGIS가 필요합니다. 운영과 같은 DB hostname
`postgres`는 Compose network에서만 해석되고 Compose PostgreSQL은 host에
5432를 공개하지 않습니다. host에서 API·CLI를 직접 실행할 때는
`DATABASE_URL`을 접근 가능한 PostgreSQL 주소로 명시해야 합니다.

## 데이터 초기화

전국 정류장 CSV를 준비한 다음 migration, import, 지역 노선 동기화를
순서대로 실행합니다.

```bash
docker compose up -d postgres

docker compose run --rm \
  -v "$PWD/bus data.csv:/data/bus-stops.csv:ro" \
  api node dist/cli/transit.js import-stops --path /data/bus-stops.csv

docker compose run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3723 --lng 127.3604 --radiusMeters 1200 --maxRoutes 60

docker compose run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3321 --lng 127.4342 --radiusMeters 500 --maxRoutes 40

docker compose run --rm api node dist/cli/transit.js import-subway-stations
docker compose run --rm api node dist/cli/transit.js sync-subway-stations \
  --concurrency 4

docker compose run --rm api node dist/cli/transit.js stats
```

CSV 제외율이 1%를 넘으면 전체 import를 중단합니다. 같은 파일을 다시
import해도 `source_identity` 기준으로 중복되지 않습니다.

## 주요 명령

| 명령 | 목적 |
| --- | --- |
| `pnpm typecheck` | 모든 workspace TypeScript 검사 |
| `pnpm test` | 계약·API·웹·모바일 결정적 테스트와 경계 검사 |
| `pnpm build:all` | 계약→API→웹 및 iOS·Android JavaScript bundle |
| `pnpm test:e2e` | 공개 또는 지정 URL Playwright E2E |
| `pnpm tago:health` | TAGO 네 서비스의 키와 도시코드 호출 확인 |
| `pnpm bus:import-stops -- --path <file>` | 전국 정류장 CSV import |
| `pnpm bus:sync-route -- --cityCode 25 --routeId <id>` | 단일 노선 동기화 |
| `pnpm bus:sync-area -- --lat <lat> --lng <lng>` | 주변 노선 동기화 |
| `pnpm bus:sync-areas -- --path <file> --statusPath <file>` | 여러 운영 지역 동기화와 상태 기록 |
| `pnpm bus:stats` | 정류장·연결·노선·관계 수 확인 |
| `pnpm subway:import-stations` | 15열 전국 지하철역 CSV 원자적 import |
| `pnpm subway:import-topology` | 노선 순서·구간 시간·배차·환승 CSV 원자적 import |
| `pnpm subway:sync-stations` | CSV 역과 TAGO 역 ID의 단일 정확 후보 매핑 |
| `pnpm subway:test-departures -- --stationId <id> --direction U` | TAGO 시간표 기반 다음 출발 확인 |
| `pnpm subway:stats` | 전체·활성·TAGO 매핑 지하철역 수 확인 |
| `./ops/backup-postgres.sh` | 즉시 백업·checksum·보존 정책 실행 |
| `./ops/verify-postgres-backup.sh` | 최신 백업을 별도 PostGIS에 복원 검증 |
| `./ops/sync-transit.sh` | 운영 지역 TAGO 노선과 관계 즉시 갱신 |
| `./ops/check-alert-delivery.sh` | Alertmanager→외부 webhook 실제 전달 확인 |

CLI는 DB pool을 최대 2 connections로 제한합니다.

## 핵심 API

```http
GET  /api/v1/health
GET  /api/v1/readiness
GET  /api/v1/auth/session
GET  /api/v1/auth/kakao/start
GET  /api/v1/auth/kakao/callback
POST /api/v1/auth/logout
GET  /api/v1/places?query=카이스트&scope=suggest&limit=8
GET  /api/v1/places?query=카이스트&scope=resolve&x=127.36&y=36.37&limit=8
GET  /api/v1/places/reverse?x=127.36&y=36.37
POST /api/v1/recommendations
POST /api/v1/ui-events
GET  /api/v1/transit/subway/stations/search?query=대전&limit=10
GET  /api/v1/transit/subway/stations/nearby?lat=36.3315&lng=127.4331
GET  /api/v1/transit/subway/stations/223/departures?direction=U
```

검색 중심 좌표는 전국 검색 범위를 제한하지 않고 결과 순서에만 사용합니다.
첫 번째 검색 결과를 자동 선택하지 않습니다. 전체 계약과 오류 코드는
[API 레퍼런스](./docs/api-reference.md)를 참고합니다.

## 검증

```bash
pnpm typecheck
pnpm test
pnpm build:all
E2E_REQUIRE_NAVER_MAP=1 pnpm test:e2e
```

일반 테스트는 캡처 시각·호출 API·SHA-256 checksum을 기록한 실제 공급자
응답을 사용합니다. PostgreSQL 통합 테스트는 별도 PostGIS DB에
`DATABASE_TEST_URL`을 지정해 실행합니다.

현재 일반 결정적 테스트는 contracts 12개, app-core 3개, alert-relay 3개,
API 104개, web 56개, mobile 14개로 총 192개입니다. 별도 PostGIS DB에서
실행하는 교통·인증 통합 테스트 8개까지 포함하면 총 200개입니다.

```bash
DATABASE_TEST_URL=postgresql://user:password@127.0.0.1:5432/chimap_test \
  pnpm --filter @chimap/api exec vitest run \
  src/transit/transit-repository.integration.test.ts \
  src/auth/mobile-auth-repository.integration.test.ts
```

## 운영

- liveness: `GET /api/v1/health`
- 배포 승인: `GET /api/v1/readiness`
- API DB pool: 최대 10 connections
- PostgreSQL: `max_connections=50`, `shared_buffers=128MB`, 768MiB 제한
- 백업: systemd timer가 매일 `pg_dump -Fc`, 일간 7개·주간 4개 보관
- 복구 검증: systemd timer가 월 1회 별도 PostGIS 18에 restore
- 교통 갱신: systemd timer가 매일 KAIST 1.2km·대전역 500m 노선 동기화
- 관측: Prometheus 15초 수집, 15일·2GiB 보존, loopback UI `:9090`
- 경보: API·검색·DB·TAGO·백업·동기화·알림 전달 20개
- 전달: 필요할 때만 `EXTERNAL_ALERTS_ENABLED=1`로 Alertmanager→alert-relay→Slack/Discord/일반 webhook
- 로그 제외: 검색어, 좌표, 키, 외부 원문

Alertmanager와 relay 서비스 health, 라우팅 설정과 메시지 변환은
검증됐습니다. 외부 운영 채널은 현재 `EXTERNAL_ALERTS_ENABLED=0`으로 명시적으로
비활성화되어 있습니다. webhook 설정과 실제 전달 확인 순서는
[배포·백업·복구 운영서](./docs/deployment.md)의 장애 알림 절차를 따릅니다.

## 문서

- [구현·운영 현황](./docs/current-state.md)
- [사용자 경험과 화면 상호작용](./docs/user-experience.md)
- [시스템 아키텍처](./docs/architecture.md)
- [API 레퍼런스](./docs/api-reference.md)
- [데이터베이스 스키마와 저장 계약](./docs/database-schema.md)
- [배포·백업·복구](./docs/deployment.md)
- [Kakao 연동](./docs/kakao-api-integration.md)
- [NAVER 연동](./docs/naver-map-integration.md)
- [TAGO 연동](./docs/tago-transit-integration.md)
- [추천 알고리즘](./docs/recommendation-algorithm.md)
- [검증 시나리오](./docs/test-scenarios.md)
