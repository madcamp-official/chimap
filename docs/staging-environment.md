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
| API loopback | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Cloudflare hostname | `chimap.madcamp-kaist.org` | `staging.chimap.madcamp-kaist.org` |
| PostgreSQL volume | `chimap-postgres` | `chimap-staging-postgres` |
| image tag | `chimap:actual-data` | `chimap:staging` |
| env file | `.env` | `.env.staging` |
| monitoring | Prometheus·Alertmanager·relay | 현재 미구성 |

두 PostgreSQL은 host 5432를 공개하지 않습니다. `docker compose` 명령에는 항상
대상 파일과 env file을 함께 써서 기본 production Compose를 잘못 조작하지 않게
합니다.

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
```

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
- `staging-mobile` Native App key → Mac mobile `.env.local`의
  `KAKAO_NATIVE_APP_KEY`
- 숫자 `KAKAO_APP_ID` → 같은 CHIMap Kakao 앱의 App ID

추가 REST key에는 staging server 허용 IP를, 추가 Native key에는
`org.madcamp.chimap.staging` iOS Bundle ID와 Android package를 등록합니다. Web
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

Mac clone의 `apps/mobile/.env.local`에는 공개 client 값 다섯 개만 둡니다.

```dotenv
APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org
NAVER_MAP_CLIENT_ID_IOS=
NAVER_MAP_CLIENT_ID_ANDROID=
KAKAO_NATIVE_APP_KEY=
```

server Client Secret, Kakao REST key, DB credential, CHIMap token encryption key는
mobile 파일에 넣지 않습니다. 자세한 Xcode 절차는
[iOS 개발 운영서](./ios-development.md)를 따릅니다.

## 7. 갱신·중지·삭제 안전장치

API만 갱신:

```bash
export APP_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose --env-file .env.staging -f compose.staging.yml build api
docker compose --env-file .env.staging -f compose.staging.yml up -d --no-deps api
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
