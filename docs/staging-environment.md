# Staging 환경 운영서

이 문서는 Web, iOS, Android가 함께 사용하는 CHIMap staging API와 PostgreSQL을
production에서 격리해 운용하는 기준입니다. 비밀값은 저장소에 기록하지 않고
Git에서 제외된 루트 `.env.staging`에만 둡니다.

## 1. 환경 경계

DB는 frontend별로 나누지 않고 환경별로 나눕니다.

```text
Production Web/iOS/Android
  → https://chimap.madcamp-kaist.org/api/v1
  → Compose project chimap
  → volume chimap-postgres

Staging Web/iOS/Android
  → https://staging.chimap.madcamp-kaist.org/api/v1
  → Compose project chimap-staging
  → volume chimap-staging-postgres
```

같은 환경의 세 frontend는 같은 API와 DB를 사용하므로 계정·서버 프로필·교통
기준 데이터를 공유합니다. 다음 client 상태는 플랫폼과 사용자 namespace별로
보존하고 서로 동기화하지 않습니다.

- Web local/session storage
- iOS·Android AsyncStorage의 선택 경로와 열린 상세 sheet
- TanStack Query cache
- SecureStore token
- HealthKit·Health Connect 원본 자료

staging에서 production DB dump를 그대로 복원하지 않습니다. 공개 교통 기준
자료만 importer로 적재하며 production 사용자, OAuth account, session과 refresh
token family는 복사하지 않습니다.

## 2. 고정 리소스

| 항목 | Production | Staging |
| --- | --- | --- |
| Compose 파일 | `compose.yml` | `compose.staging.yml` |
| project | `chimap` | `chimap-staging` |
| 현재 service project directory | `/root/chimap_web_assets` | `/root/chimap` |
| 현재 service config source | `/root/chimap_web_assets/compose.yml` + `/etc/chimap/compose-runtime.yml` | `/root/chimap_web_assets/compose.staging.yml` |
| 현재 PostgreSQL config source | `/root/chimap/compose.yml` | `/root/chimap/compose.staging.yml` |
| API loopback | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Cloudflare hostname | `chimap.madcamp-kaist.org` | `staging.chimap.madcamp-kaist.org` |
| PostgreSQL volume | `chimap-postgres` | `chimap-staging-postgres` |
| image tag | `chimap:actual-data` | `chimap:staging` |
| env file | `.env` | `.env.staging` |
| monitoring | Prometheus·Alertmanager·relay | API 내부 metrics 활성, 전용 Prometheus는 미구성 |

두 PostgreSQL은 host 5432를 공개하지 않습니다. `docker compose` 명령에는 항상
대상 파일과 env file을 함께 써서 기본 production Compose를 잘못 조작하지 않게
합니다.

현재 서버의 service 재기동은 staging env
`/root/chimap/.env.staging`과 위 절대 경로를 사용합니다. 일반 clone에서 아래
상대 경로 예제를 실행할 때도 clean release tree인지 먼저 확인합니다.

## 3. 환경변수

`.env.staging`은 `.gitignore`의 `.env.*` 규칙으로 제외됩니다.

```bash
git check-ignore -v .env.staging
chmod 600 .env.staging
```

필수 그룹:

```dotenv
POSTGRES_DB=chimap_staging
POSTGRES_USER=chimap_staging
POSTGRES_PASSWORD=

KAKAO_REST_API_KEY=
KAKAO_APP_ID=
AUTH_MOBILE_ENABLED=1
AUTH_MOBILE_ACCESS_TTL_MINUTES=15
AUTH_MOBILE_REFRESH_TTL_DAYS=30
AUTH_REFRESH_GRACE_SECONDS=120
AUTH_REFRESH_RETRY_ENCRYPTION_KEY=
MOBILE_GUEST_ENABLED=1

NAVER_MAP_NCP_KEY_ID=
NAVER_MAP_NCP_KEY=
VITE_NAVER_MAP_NCP_KEY_ID=

DATA_GO_KR_SERVICE_KEY=
TAGO_BUS_STOP_SERVICE_KEY=
TAGO_BUS_ROUTE_SERVICE_KEY=
TAGO_BUS_ARRIVAL_SERVICE_KEY=
TAGO_BUS_LOCATION_SERVICE_KEY=

TRANSIT_GEOMETRY_V2_ENABLED=1
RECOMMENDATION_PHASED_TIMEOUTS_ENABLED=1
RECOMMENDATION_SELECTED_GEOMETRY_ENABLED=1
BUS_GEOMETRY_PAIR_V3_ENABLED=1
WALKING_ROUTER=KAKAO
VALHALLA_BASE_URL=
VALHALLA_HTTP_TIMEOUT_MS=3500
VALHALLA_HTTP_RETRY_COUNT=1
VALHALLA_WALK_CACHE_TTL_SECONDS=1800
VALHALLA_MAX_SNAP_DISTANCE_METERS=100
VALHALLA_MAX_DETOUR_RATIO=5

PARK_ROUTE_IMPORT_ENABLED=0
PARK_ROUTE_IMPORT_TOKEN=
PARK_ROUTE_INTEGRATION_ENABLED=0
PARK_ROUTE_SEARCH_RADIUS_METERS=800
PARK_ROUTE_MAX_CANDIDATES=3
```

위 provider·park 값은 새 image를 처음 올릴 때의 안전한 시작값입니다. 현재
활성화된 staging의 값과 증거는 문서 끝 2026-07-30 snapshot을 기준으로 합니다.

`POSTGRES_PASSWORD`는 URL에 안전한 hex 값을 사용하고 refresh retry key는 정확히
32바이트를 base64로 인코딩합니다.

```bash
openssl rand -hex 32
openssl rand -base64 32
```

첫 내부 TestFlight 범위에서는 Apple server credential 네 값을 비워
`appleEnabled=false`를 유지합니다. 일부 Apple 값만 입력하면 설정 검증이 기동을
거절합니다.

### Kakao 경계

CHIMap은 Kakao Developers 앱 하나를 서비스 identity로 유지하고, 그 안에서
키를 환경별로 나눕니다.

- `staging-server` REST API key → `.env.staging`의 `KAKAO_REST_API_KEY`
- staging iOS Native App key → Mac mobile `.env`의
  `KAKAO_NATIVE_IOS_APP_KEY`
- staging Android Native App key → Mac mobile `.env`의
  `KAKAO_NATIVE_ANDROID_APP_KEY`
- 숫자 `KAKAO_APP_ID` → 같은 CHIMap Kakao 앱의 App ID

추가 REST key에는 staging server 허용 IP를, iOS Native key에는
`org.madcamp.chimap.staging` Bundle ID를, Android Native key에는 같은 package와
signing key hash를 등록합니다. Web
REST OAuth도 staging에서 시험할 때만 staging callback과 Client Secret을 별도로
구성합니다. Native mobile token 교환만 할 때는 Web OAuth Client Secret이
필수는 아닙니다.

같은 Kakao 앱 안의 key는 App ID·동의 설정·앱 단위 quota를 공유합니다. 별도 App
ID가 필요한 강한 token audience 격리는 Kakao의 test app/서비스 정책을 먼저
확인한 뒤 별도 계획으로 진행합니다.

### NAVER 경계

내부 staging은 기존 production Web/REST Maps Application의 다음 세 값을
재사용할 수 있습니다.

```dotenv
NAVER_MAP_NCP_KEY_ID=
NAVER_MAP_NCP_KEY=
VITE_NAVER_MAP_NCP_KEY_ID=
```

같은 Application이면 두 Client ID는 같을 수 있지만 Client Secret은 browser
bundle에 절대 넣지 않습니다. 기존 Application의 Web 서비스 환경에
`https://staging.chimap.madcamp-kaist.org`를 port와 path 없이 등록합니다.
재사용하면 사용량·과금·한도·key rotation 영향이 production과 합산되므로 공개
staging이나 부하 시험 전에는 별도 Application을 검토합니다.

CHIMap release 정책상 native map Client ID는 Web과 분리하고 iOS와 Android도
서로 다른 Application을 사용합니다. 이 값은 server `.env.staging`이 아니라 Mac
mobile 환경이나 EAS environment에 둡니다.

### Valhalla·공원 경계

`VALHALLA_BASE_URL`은 API host와 실제 `chimap-staging-api` container에서 접근
가능한 private/overlay 또는 엄격한 allowlist endpoint만 사용합니다. URL에
credential, query, fragment를 넣거나 TCP 8002를 인터넷 전체에 공개하지 않습니다.
Valhalla 활성화 전 `TRANSIT_GEOMETRY_V2_ENABLED=1`과
`RECOMMENDATION_SELECTED_GEOMETRY_ENABLED=1`을 함께 설정해야 합니다. base URL의
path prefix는 client가 `/route`를 붙여도 보존됩니다.

공원 snapshot import token은 32자 이상의 무작위 서버 전용 값이며 import하는
짧은 시간에만 `PARK_ROUTE_IMPORT_ENABLED=1`로 엽니다. checksum·152건·active
dataset을 확인하면 즉시 `0`으로 닫고, 추천 사용 여부는 별도
`PARK_ROUTE_INTEGRATION_ENABLED`로 제어합니다. snapshot과 network handoff는
runtime source나 공개 저장소에 넣지 않습니다.

## 4. 구성 검증과 기동

비밀값을 출력하는 `docker compose config` 전체 출력은 보존하지 않습니다.
문법만 확인합니다.

```bash
docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  config --quiet
```

빌드와 기동:

```bash
export APP_COMMIT_SHA="$(git rev-parse HEAD)"

docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  up -d --build --wait postgres api
```

상태와 제한된 log:

```bash
docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  ps

docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  logs --tail=100 api
```

staging은 전용 Prometheus를 실행하지 않습니다. API 내부 metrics를 필요할 때만
container 안에서 조회하며 scraping, retention, alert 평가와 전달은 production
monitoring에만 있습니다.

```bash
docker compose --env-file .env.staging -f compose.staging.yml exec -T api \
  node -e "fetch('http://127.0.0.1:9091/metrics').then(async r => { process.stdout.write(await r.text()); if (!r.ok) process.exit(1) })"
```

기동 확인:

```bash
curl -fsS http://127.0.0.1:3001/api/v1/health
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/health
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/mobile-config
curl -sS -w '\nHTTP %{http_code}\n' \
  https://staging.chimap.madcamp-kaist.org/api/v1/readiness
```

`health`는 liveness라서 빈 DB에서도 200일 수 있습니다. `readiness`는 migration,
공급자 key, 정류장·노선·노선-정류장 자료가 모두 준비된 뒤에만 200입니다.

## 5. 교통 기준 자료 적재

전국 정류장 CSV는 Git에 넣지 않고 host의 `data/bus_data.csv`를 read-only로
mount합니다.

```bash
docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  run --rm \
  -v "$PWD/data/bus_data.csv:/data/bus-stops.csv:ro" \
  api node dist/cli/transit.js import-stops \
  --path /data/bus-stops.csv
```

KAIST와 대전역 노선:

```bash
docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3723 --lng 127.3604 \
  --radiusMeters 1200 --maxRoutes 60 --concurrency 2

docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3321 --lng 127.4342 \
  --radiusMeters 500 --maxRoutes 60 --concurrency 2
```

지하철:

```bash
docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js import-subway-stations

docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js sync-subway-stations --concurrency 4

docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js import-subway-topology

docker compose --env-file .env.staging -f compose.staging.yml \
  run --rm api node dist/cli/transit.js stats
```

공개 교통 자료만 적재한 뒤 `readiness`를 다시 확인합니다.

TAGO 단일 정류장·역 조회가 timeout되면 해당 항목만 실패로 집계하고 나머지
노선·역 seed는 계속합니다. `sync-area`가 부분 실패 code를 반환하면 이미 성공한
노선은 보존되므로 같은 명령을 재실행합니다. `sync-subway-stations` 결과의
`failed` 역은 `PENDING`으로 남아 다음 실행에서 재시도됩니다.

## 6. Mobile 연결

Mac clone의 `apps/mobile/.env`에는 공개 client 값 여섯 개만 둡니다.

```dotenv
APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org
NAVER_MAP_CLIENT_ID_IOS=
NAVER_MAP_CLIENT_ID_ANDROID=
KAKAO_NATIVE_IOS_APP_KEY=
KAKAO_NATIVE_ANDROID_APP_KEY=
```

server Client Secret, Kakao REST key, DB credential, CHIMap token encryption key는
mobile 파일에 넣지 않습니다. 자세한 Xcode 절차는
[iOS 개발 운영서](./ios-development.md)를 따릅니다.

## 7. 갱신·중지·삭제 안전장치

API만 갱신:

```bash
export APP_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose --env-file .env.staging -f compose.staging.yml build api
docker compose --env-file .env.staging -f compose.staging.yml \
  up -d --no-deps --force-recreate --wait api
```

현재 서버에서 이미 빌드·검증된 image로 API만 재기동할 때는 source 혼동을
막기 위해 다음 canonical invocation을 사용합니다. `chimap:staging`은 가변
태그이므로 `--no-build`만으로 release 고정이 보장되지 않습니다. 재기동 전에
image OCI revision이 승인된 source SHA와 같은지 반드시 검사합니다.

```bash
export RELEASE_SHA="$(git -C /root/chimap_web_assets rev-parse HEAD)"
export APP_COMMIT_SHA="$RELEASE_SHA"
export STAGING_IMAGE_REVISION="$(docker image inspect chimap:staging \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
test "$STAGING_IMAGE_REVISION" = "$RELEASE_SHA"
docker image inspect chimap:staging \
  --format '{{.Id}} {{ index .Config.Labels "org.opencontainers.image.revision" }}'
docker compose \
  --project-directory /root/chimap \
  --env-file /root/chimap/.env.staging \
  -f /root/chimap_web_assets/compose.staging.yml \
  up -d --no-deps --no-build --force-recreate --wait api
```

컨테이너 중지와 network 제거는 DB volume을 보존합니다.

```bash
docker compose --env-file .env.staging -f compose.staging.yml down
```

`down -v`는 staging DB를 삭제하므로 명시적인 초기화 승인 없이는 사용하지
않습니다. production 명령에는 `compose.staging.yml`을 붙이지 않고, staging
명령에는 반드시 붙입니다.

production 후보 이미지는 staging이 사용하는 3001과 충돌하지 않도록
`127.0.0.1:3002`에서 smoke합니다.

Valhalla·공원 경로 갱신은 다음 순서를 지킵니다.

1. `WALKING_ROUTER=KAKAO`, park import/integration `0`으로 새 image의
   migration·readiness·기존 추천을 확인합니다.
2. park import만 일시적으로 `1`로 바꾸고 snapshot 검증·적재 후 다시 `0`으로
   닫습니다.
3. host와 API container에서 Valhalla smoke를 통과시킵니다.
4. `WALKING_ROUTER=VALHALLA`로 재기동하고
   `chimap_provider_configured{provider="VALHALLA"} == 1`, provider success와
   응답 leg의 `DETAILED`, 내부 관측 source `VALHALLA_WALK`를 확인합니다.
5. 마지막으로 park integration을 `1`로 켜고 GOAL 경로를 확인합니다.

장애 시 `WALKING_ROUTER=KAKAO`, `PARK_ROUTE_INTEGRATION_ENABLED=0`,
`PARK_ROUTE_IMPORT_ENABLED=0`으로 API만 재기동합니다. dataset row를 삭제하지
않으며 이전 검증 snapshot은 새 dataset ID로 재import합니다.

## 8. 2026-07-27 17:44 KST 확인 스냅샷

- Cloudflare hostname과 TLS 발급 완료
- tunnel origin `http://127.0.0.1:3001`
- `chimap-staging-api-1`, `chimap-staging-postgres-1` healthy
- local/external `/api/v1/health` HTTP 200
- `mobile-config`: guest/Kakao true, Apple false
- database/PostGIS/migration과 Kakao/NAVER/TAGO provider 준비
- source/image: `55fec7c` / `sha256:02971772…`
- 전국 정류장 227,207개, TAGO 연결 2,144개
- 버스 노선 50개, 노선-정류장 4,178개
- 활성 지하철역 1,097개, TAGO 매핑 706개
- local/external readiness HTTP 200
- 외부 KAIST 본원→대전역 추천 3건(`FAST/BALANCED/GOAL`) HTTP 200
- TAGO timeout 3개 역은 `PENDING`으로 보존

따라서 staging API는 iPhone 실제 기기 추천 E2E에 사용할 수 있습니다. 남은
외부 gate는 NAVER/Kakao/HealthKit 실기기와 eviction 복원입니다.

## 9. 2026-07-30 Valhalla·공원 경로 확인 스냅샷

- source/image: `f2332827` /
  `sha256:4be33c4f43c2e6995d1f32f4d459ae9ef357ffeb17473b79413e3abf1da2a498`
- `chimap-staging-api-1`, `chimap-staging-postgres-1` healthy, restart 0
- local/external health·readiness·mobile-config HTTP 200, migration 13 current
- readiness: 정류장 227,230개, 연결 3,658개, 노선 108개,
  노선-정류장 6,801개, route-ready 지하철 segment 2,314개
- `WALKING_ROUTER=VALHALLA`, park import 비활성, integration 활성
- 공원 dataset 2개·저장 route 246개, active dataset 선언 route 152개
- `chimap_provider_configured{provider="VALHALLA"} 1`, Valhalla walking success와
  응답 `DETAILED`, 내부 관측 source `VALHALLA_WALK`, 공원 GOAL 포함 확인

이 snapshot과 동일한 immutable image를 production에 승격했습니다. production은
별도 backup·restore와 public E2E를 다시 통과했으며 두 환경 모두 private 또는
명시적으로 승인된 endpoint 정책, Valhalla provider metric과 import 비활성을
유지합니다.

## 10. 2026-07-31 최종 `main` 확인 스냅샷

- source: `7e5687b1102268c97c5d616cd9f8e401bbe1b99a`
- image: `sha256:c62bb9945c000d71f3127ccdb9e689f7e569a124a495f8311ddd16773d579895`
- OCI revision과 runtime `APP_COMMIT_SHA`가 source full SHA와 일치
- `chimap-staging-api-1` healthy, restart 0
- local/external health·readiness HTTP 200, migration 13 current
- readiness: 정류장 227,230개, 연결 3,658개, 노선 108개,
  노선-정류장 6,801개, route-ready 지하철 segment 2,314개
- `WALKING_ROUTER=VALHALLA`, 두 geometry flag 활성, park import 비활성,
  integration 활성, active 공원 경로 152건
- Valhalla configured metric `1`, walking success와
  응답 `DETAILED`, 내부 관측 source `VALHALLA_WALK` 확인
- rollback tag `chimap:rollback-staging-pre-7e5687b1`은 `5c0a380` image 보존
- KAIST 본원→대전역 요청에서 `FAST/BALANCED/GOAL` 3건, GOAL primary,
  response baseline과 최종 FAST 네 필드 일치, 근사 geometry leg 0
- final image의 public route gate 2개(NAVER-strict UI 1개와 API 회귀 1개) 통과

staging public route gate는 production과 대상을 분명히 나눠 실행합니다.

```bash
E2E_BASE_URL=https://staging.chimap.madcamp-kaist.org \
E2E_REQUIRE_NAVER_MAP=1 \
pnpm test:e2e -- happy-path.spec.ts
```

배포 호스트의 Playwright container 기본 bridge에서 NAVER SDK가 timeout되면
[배포·백업·복구 운영서](./deployment.md)의 같은-version `--network host` 명령에서
`E2E_BASE_URL`만 staging으로 바꿉니다. staging E2E는 현재 수동 release gate이며
production을 기본값으로 사용하는 workflow 실행으로 대체하지 않습니다.
