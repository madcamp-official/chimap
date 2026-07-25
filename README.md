# CHIMap

> 목적지는 그대로, 가는 길은 더 건강하게.

CHIMap은 출발지·목적지·도착 마감시간을 유지하면서, 오늘 남은 걸음 수를
채우는 데 도움이 되는 대중교통 경로를 비교하는 5일 MVP입니다. 가장 빠른
경로, 시간과 운동량이 균형 잡힌 경로, 목표 걸음에 가까운 경로를 최대 3개
제공합니다.

운영 경로는 Kakao 장소·도보 API와 국토교통부 TAGO 버스 API를 서버에서
조합합니다. NAVER Maps Client ID를 연결하면 TAGO 정류장 좌표 기반 경로와
실시간 차량 위치를 NAVER Web Dynamic Map 위에 표시합니다.

## 2026-07-24 현재 상태

상태를 혼동하지 않도록 저장소, 공개 서버, 다음 배포 목표를 구분합니다.

| 구분 | 상태 |
| --- | --- |
| 현재 저장소 | Kakao 장소·도보 + TAGO 버스 + SQLite + NAVER/SVG 지도 구현 및 자동 테스트 완료 |
| 공개 주소 | `https://chimap.madcamp-kaist.org` 연결 및 same-origin 응답 정상 |
| 현재 공개 컨테이너 | 이전 `chimap:naver-stable-20260724` 이미지가 실행 중이며 health의 mode는 `mock` |
| 공개 NAVER 지도 | SDK 파일은 200이지만 NAVER `/v3/auth`가 401을 반환함. 앱은 오류 없이 SVG fallback과 재시도를 제공 |
| 현재 로컬 transit DB | `bus:stats` 기준 stops/linkedStops/routes/routeStops 모두 0; import와 sync 미실행 |
| HTTPS | Cloudflare가 공개 TLS를 종료한다. 원본용 Let's Encrypt 인증서도 Certbot으로 발급·갱신 검증됐지만, 현재 Tunnel 원본 연결에는 아직 사용되지 않는다 |
| 다음 release gate | 올바른 Maps Application 인증, TAGO 키, 전국 정류장 import/route sync, live 추천 smoke 후 현재 소스로 이미지 교체 |

따라서 “코드에 구현됨”과 “현재 공개 서버에서 live 데이터로 검증됨”은 같은
의미가 아닙니다. 현재 공개 페이지는 접근 가능하지만 NAVER 타일과 TAGO live
추천을 운영 완료 상태로 간주하지 않습니다.

운영 연결, Certbot 갱신 훅과 공개/원본 TLS 경계는
[`docs/deployment.md`](./docs/deployment.md)를 단일 기준으로 확인합니다.

## 구현 범위

- React 19 + Vite + TypeScript strict 기반 반응형 웹
- Express 5 + Zod 기반 API와 일관된 오류 계약
- Kakao 장소·도보 REST 어댑터와 TAGO 버스 정규화 client
- SQLite 전국 정류장/노선 관계 저장소와 idempotent CSV importer
- NAVER 지도 타일 위에 TAGO WGS84 정류장·차량을 그리는 지도 어댑터
- 조기 하차 후 걷기 및 목적지 주변 POI 우회 후보 생성
- 마감시간, 안전 여유시간, 추가 허용시간, 보폭을 반영한 추천 엔진
- FAST / BALANCED / GOAL 카드, 모드별 경로선, 텍스트 이동 단계
- 경로선 드로잉과 워드마크 리빌을 결합한 접근 가능한 랜딩 인트로
- 지도 키 또는 SDK 실패 시에도 동작하는 SVG 경로 미리보기
- 설정 및 마지막 선택의 버전형 `localStorage` 저장
- 단위·계약·API·웹·Playwright E2E 테스트
- 멀티스테이지 non-root API Docker 이미지와 health check

## 빠른 시작

필수 도구는 Node.js 24, pnpm 10.15.1입니다.

```bash
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm install --frozen-lockfile

cp .env.example .env

pnpm dev
```

웹은 `http://localhost:5173`, API는 `http://localhost:8080`에서 실행됩니다.
실제 키를 입력한 뒤 장소를 선택하면 주변 TAGO 정류장과 실제 버스 노선으로
추천을 계산합니다. API와 Vite는 모두 저장소 루트의 `.env`만 읽습니다.

운영 웹 주소는 `https://chimap.madcamp-kaist.org`입니다. production
번들은 기본적으로 같은 origin의 `/api/v1/*`를 호출하므로 호스팅 계층에서
`/api/*`를 API 서비스로 전달해야 합니다.

## 환경변수

`.env.example`은 API, 웹, CLI가 사용하는 모든 프로젝트 환경변수의 단일
템플릿입니다. 앱 디렉터리별 `.env`는 두지 않습니다. 아래는 같은 변수들을
기능별로 묶은 표입니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 운영은 `production`; production fixture 금지 |
| `KAKAO_MODE` | `live` | 실제 실행은 `live`; mock은 개발 fixture만 허용 |
| `KAKAO_REST_API_KEY` | 없음 | `live`에서 필수. 브라우저에 노출 금지 |
| `DATA_GO_KR_SERVICE_KEY` | 없음 | TAGO 공통 서버 인증키 |
| `TAGO_BUS_*_SERVICE_KEY` | 없음 | 서비스별 키, 공통 키보다 우선 |
| `TAGO_BASE_URL` / `TAGO_RESPONSE_TYPE` | 공공데이터 URL / `json` | TAGO 공통 transport |
| `TAGO_DEFAULT_CITY_CODE` | `25` | CLI의 기본 도시코드 |
| `BUS_STOPS_DATA_PATH` | 없음 | 전국 정류장 CSV의 서버 경로 |
| `TRANSIT_DB_PATH` | `.data/transit.sqlite` | import 결과와 노선 관계 DB |
| `TAGO_HTTP_TIMEOUT_MS` / `TAGO_HTTP_RETRY_COUNT` | `7000` / `2` | service 요청 보호 |
| `TAGO_*_CACHE_TTL_SECONDS` | 서비스별 10초~24시간 | nearby/route/stops/arrival/location TTL |
| `TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS` | `500` | 주변 정류장 반경 상한 |
| `TRANSIT_MAX_TRANSFER_COUNT` | `1` | 직행 또는 최대 1회 환승 |
| `TRANSIT_*_SPEED_KMH` / `TRANSIT_STOP_DWELL_SECONDS` | `4.5`, `20`, `25` | 도보·버스·정차시간 추정 |
| `USE_MOCK_TRANSIT_DATA` | `false` | 개발/테스트 fixture 전용, production 금지 |
| `PORT` | `8080` | API 포트 |
| `WEB_ORIGIN` | `http://localhost:5173` | 운영은 `https://chimap.madcamp-kaist.org` |
| `WEB_DIST_PATH` | 없음 | 설정 시 Express가 production 웹과 SPA fallback 제공 |
| `LOG_LEVEL` | `info` | Pino 로그 수준 |
| `LIVE_API_TEST` | `0` | 수동 live smoke를 명시적으로 허용하는 표식 |

웹 build 변수:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 개발 시 `http://localhost:8080` | 운영에서 생략하면 same-origin |
| `VITE_APP_MODE` | `demo` | health 조회 전 데모 배지 초기값 |
| `VITE_NAVER_MAP_NCP_KEY_ID` | 없음 | NAVER Web Dynamic Map 공개 Client ID |

`KAKAO_REST_API_KEY`는 서버 비밀이며 `VITE_NAVER_MAP_NCP_KEY_ID`는 브라우저
번들에 포함되는 공개 Client ID입니다. NAVER Cloud Maps Application에는
Web Dynamic Map과 실제 웹 도메인을 등록해야 합니다. NAVER Client Secret은
프론트에 넣지 않습니다. `live` 모드는 Kakao REST 키가 없으면 서버 시작
단계에서 실패하며, NAVER 키가 없을 때는 SVG 경로 미리보기로 계속 동작합니다.

## 명령어

```bash
pnpm dev              # API와 웹 개발 서버
pnpm typecheck        # 전체 strict 타입 검사
pnpm test             # 계약, API, 웹 테스트
pnpm test:e2e         # mock 전체 사용자 흐름
pnpm build            # contracts, API, 웹 production build
pnpm benchmark:mock   # 50회 추천 API p50/p95와 응답 크기
pnpm tago:health      # 키 노출 없는 TAGO 연결 진단
pnpm bus:import-stops # 전국 정류장 CSV upsert
pnpm bus:stats        # 정류장·노선 관계 통계
pnpm format:check     # 프로젝트별 정적 검사
```

Playwright를 처음 실행하는 Linux 환경에서는 브라우저와 OS 의존성이 필요할
수 있습니다.

```bash
pnpm --filter @chimap/web exec playwright install chromium
pnpm --filter @chimap/web exec playwright install-deps chromium
```

## API

| 메서드 | 경로 | 설명 | 기본 제한 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/health` | 상태와 provider 모드 | 없음 |
| `GET` | `/api/v1/places?query=...&x=...&y=...` | 장소 검색 | 60회/분 |
| `POST` | `/api/v1/recommendations` | 건강 경로 추천 | 10회/분 |
| `GET` | `/api/v1/transit/bus/stops/nearby` | 실제 주변 정류장 | 없음 |
| `GET` | `/api/v1/transit/bus/stops/:nodeId/routes` | 정류장 경유 노선 | 없음 |
| `GET` | `/api/v1/transit/bus/stops/:nodeId/arrivals` | 실시간 도착 | 없음 |
| `GET` | `/api/v1/transit/bus/routes/:routeId` | 노선 상세 | 없음 |
| `GET` | `/api/v1/transit/bus/routes/:routeId/stops` | 경유 정류장 | 없음 |
| `GET` | `/api/v1/transit/bus/routes/:routeId/vehicles` | 실시간 차량 위치 | 없음 |
| `POST` | `/api/v1/transit/recommendations` | 추천 호환 endpoint | 10회/분 |

모든 응답은 공유 Zod 계약으로 검증됩니다. 오류에는 안정적인 `error.code`,
사용자용 한국어 메시지, 추적 가능한 `requestId`가 포함됩니다. 요청 본문과
API 키는 로그에 기록하지 않습니다. transit GET에는 좌표 또는 `cityCode`가
필수이며, 전체 transit router는 `/api/transit` 호환 경로에도 동일하게
마운트됩니다.

## Docker

production 이미지는 React 정적 산출물과 API를 함께 포함합니다. Express가
`/api/*`를 처리하고 그 외 경로는 SPA로 제공하며, 컨테이너는 non-root
`node` 사용자로 실행됩니다.

```bash
docker build \
  --build-arg VITE_APP_MODE=live \
  --build-arg VITE_NAVER_MAP_NCP_KEY_ID='<public-client-id>' \
  -t chimap .
docker run --rm -p 127.0.0.1:3000:3000 \
  -v /srv/chimap-data:/app/.data \
  -e KAKAO_MODE=live \
  -e KAKAO_REST_API_KEY='<secret>' \
  -e DATA_GO_KR_SERVICE_KEY='<secret>' \
  -e TRANSIT_DB_PATH=/app/.data/transit.sqlite \
  -e PORT=3000 \
  -e WEB_ORIGIN=http://localhost:3000 \
  chimap

curl http://localhost:3000/api/v1/health
```

실서비스에서는 REST 키를 이미지에 넣지 말고 Secret Manager 등 런타임
secret으로 주입해야 합니다.

## 저장소 구조

```text
apps/
  api/                 Express API, provider, 추천 엔진
  web/                 React UI, 지도, 브라우저 저장소, E2E
packages/
  contracts/           API/도메인 Zod 계약과 공유 타입
scripts/
  benchmark-mock.ts    테스트 fixture API 성능 게이트
docs/
  architecture.md
  recommendation-algorithm.md
  kakao-api-integration.md
  tago-transit-integration.md
  naver-map-integration.md
  deployment.md
  test-scenarios.md
```

계정, 사용자 이동 이력, 걸음 센서 연동은 없습니다. 정적 버스 정류장과
route-stop 관계만 SQLite에 저장하며 사용자 입력과 실시간 차량/도착정보는
영구 저장하지 않습니다.

## 문서

- [아키텍처](docs/architecture.md)
- [추천 알고리즘](docs/recommendation-algorithm.md)
- [Kakao API 연동](docs/kakao-api-integration.md)
- [NAVER 지도 연동](docs/naver-map-integration.md)
- [배포](docs/deployment.md)
- [테스트 시나리오](docs/test-scenarios.md)
- [TAGO 버스 연동 및 전국 정류장 import](docs/tago-transit-integration.md)
- [구현 계획](plan.md), [정보구조](IA.md), [데이터 모델](db_schema.md)

## 알려진 한계

- TAGO는 완성된 출발지-목적지 경로 탐색 API가 아니므로 CHIMap이
  route-stop 관계로 직행/1회 환승을 계산합니다.
- 대중교통 결과는 미래 시간표 예약이 아니라 요청 시점 출발 기준입니다.
- 걸음 수는 도보거리 ÷ 보폭의 추정값이며 신호, 실내 이동, GPS 오차를
  반영하지 않습니다.
- TAGO 미연계 지역이나 실시간 미제공 노선은 정적 경로와 예상값만 표시할 수
  있습니다.
- Kakao 장소·도보 및 TAGO 버스 경로를 NAVER 지도에 표시하는 공개 live
  서비스는 출시 직전 각 공급자의 최신 이용약관, 출처 표시, 브랜드 지침을
  서비스 운영자가 다시 검토해야 합니다.
- 실제 배포, 비즈월렛 연결, 유료 API 활성화는 자동 수행하지 않습니다.
