# 배포·백업·복구 운영서

운영 도메인은 `https://chimap.madcamp-kaist.org`이고 Cloudflare Tunnel
origin은 `http://127.0.0.1:3000`입니다. 명령은 저장소 루트에서
실행합니다.

cross-platform Web/API foundation, Route Pulse UI와 선택형 카카오 로그인은
2026-07-27 11:01 KST 이미지 `sha256:0a2db829...`로 공개 배포했습니다.
버스 marker·지도 시점 안정화, 3종 추천과 TAGO 지하철 API는 같은 날
14:28 KST code commit `96e2549`의 이미지
`sha256:f497c9a5...`로 후속 승격하고 migration 7, 주변 지하철 UI,
백업·전체 복원을 확인했습니다. 아래 UI smoke와 asset·인증 확인은 이후 모든
이미지 승격에서도 반복합니다. iOS/Android 스토어 binary 배포는 이 Compose
승격과 별도 release입니다.

15:51 KST에는 지하철 routing과 보정 경로 metadata 수정을 포함한 `7a99e03`
이미지 `sha256:6cbd51c8...`를 production에 기동했고 health 200을 재확인했습니다.
마지막 전체 E2E·백업·복구 검증 시각은 앞선 14:29 KST 기록과 구분합니다.
staging은 `https://staging.chimap.madcamp-kaist.org`와 별도 Compose/DB volume을
사용하며 자세한 절차는 [staging 환경 운영서](./staging-environment.md)에 둡니다.
현재 production 기준선은 21:39 KST의 commit `e16684b`, 이미지
`sha256:77f4de84...`이며 서울 실시간 지하철과 멀티모달 추천이 활성화되어
있습니다. 최신 검증은 아래 서울 지하철 실시간 활성화 기록을 기준으로 합니다.

## 1. 사전 조건

- Node.js 24, pnpm 10, Docker와 Docker Compose
- 루트 `.env`에 `.env.example`의 운영 값 입력
- `.env`가 Git에서 제외되는지 `git check-ignore .env`로 확인
- Kakao Map ON, REST 키, 호출 허용 IP와 쿼터 확인
- NAVER Maps Application에서 Dynamic Map, Geocoding, Reverse Geocoding 선택
- NAVER Web 서비스 URL에 포트·경로 없이
  `https://chimap.madcamp-kaist.org` 등록
- TAGO 네 서비스 활용 신청과 키 확인
- 전국 정류장 CSV 준비
- 최소 한 번 restore 검증된 PostgreSQL 백업
- 외부 장애 알림을 활성화하려면 Slack/Discord/일반 webhook URL 준비

## 2. 환경변수 보안 확인

세 NAVER 변수의 역할을 혼동하지 않습니다.

```dotenv
NAVER_MAP_NCP_KEY_ID=       # 서버와 Maps Application의 Client ID
NAVER_MAP_NCP_KEY=          # 서버 전용 Client Secret
VITE_NAVER_MAP_NCP_KEY_ID=  # 브라우저 공개 Client ID
```

같은 Maps Application을 사용하면 두 ID 변수는 같은 Client ID일 수 있습니다.
Client Secret은 `VITE_` 변수에 들어가면 안 됩니다. 현재 API 설정 검증은
`VITE_NAVER_MAP_NCP_KEY_ID === NAVER_MAP_NCP_KEY`인 기동을 거절합니다.

모바일 build는 server container 배포와 별개이며 다음 공개 식별자를 EAS profile에
주입합니다. iOS·Android Client ID는 서로 및 Web Client ID와 분리합니다.

```dotenv
NAVER_MAP_CLIENT_ID_IOS=
NAVER_MAP_CLIENT_ID_ANDROID=
KAKAO_NATIVE_APP_KEY=
APP_ENV=development|staging|production
EXPO_PUBLIC_API_BASE_URL=https://<해당 환경의 API host>
```

server `.env`의 Apple private key, NAVER Client Secret, refresh retry 암호화 key는
mobile binary에 넣지 않습니다. Web/API Compose 승격은 App Store·Play 배포를
자동으로 의미하지 않으며 각 mobile store artifact를 독립적으로 rollback합니다.
`APP_ENV=staging`에는 staging 전용 API/DB만 연결하고 production host를 대입하지
않습니다. production 주소는 production profile과 승인된 guest smoke에만 씁니다.

내부 staging의 NAVER server/Web 세 값은 기존 Maps Application을 재사용할 수
있으며 이 경우 Client ID 기준 사용량·과금·한도와 key rotation 영향이
production과 합산됩니다. mobile native Client ID는 CHIMap release 정책상 Web과
분리하고 iOS/Android도 서로 다른 Application을 사용합니다.

Kakao는 CHIMap 서비스 앱 하나를 유지하고 `staging-server` REST key와
`staging-mobile` Native key를 추가합니다. 두 환경의 key·허용 IP·callback·Bundle
ID는 나누되 App ID와 앱 단위 동의·quota는 공유합니다. 완전히 다른 Kakao App
ID가 필요한 경우에는 test app과 서비스 정책을 먼저 확인합니다.

### Staging 기동 요약

staging 명령에는 항상 두 파일을 함께 명시합니다.

```bash
docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  config --quiet

export APP_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose \
  --env-file .env.staging \
  -f compose.staging.yml \
  up -d --build --wait postgres api
```

고정 경계는 project `chimap-staging`, loopback 3001, volume
`chimap-staging-postgres`입니다. `.env.staging`, production `.env`, 공개 교통 원본
CSV는 commit하지 않습니다. `down -v`는 명시적인 staging DB 초기화 승인 없이는
사용하지 않습니다.

```bash
curl -fsS http://127.0.0.1:3001/api/v1/health
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/health
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/mobile-config
```

readiness 200에는 공개 정류장 import뿐 아니라 노선·노선-정류장과 공급자 key가
필요합니다. 지하철 기능 E2E 전에는 역·토폴로지 import와 TAGO 매핑도 완료합니다.
전체 명령은 [staging 환경 운영서](./staging-environment.md)를 따릅니다.

운영 배포 전:

```bash
git check-ignore .env

node --env-file=.env --input-type=module -e '
  import { existsSync, readFileSync } from "node:fs";
  import { execFileSync } from "node:child_process";
  const secret = process.env.NAVER_MAP_NCP_KEY;
  if (!secret) throw new Error("NAVER server secret이 비어 있습니다.");
  const files = execFileSync("git", ["ls-files", "-z"])
    .toString()
    .split("\0")
    .filter((file) => file && existsSync(file));
  const exposed = files.filter((file) =>
    readFileSync(file).includes(Buffer.from(secret)),
  );
  console.log(`TRACKED_SECRET_MATCHES=${exposed.length}`);
  if (exposed.length > 0) process.exit(1);
'
```

검사는 추적 파일에서 실제 Secret byte를 찾되 Secret 자체를 출력하지
않습니다.

## 3. 공급자 사전 검증

### Kakao

다음 다섯 호출을 운영 서버의 실제 outbound IP에서 HTTP 200으로 확인합니다.

- keyword
- address
- coord2address
- walk
- waypoints directions 도로 geometry

Kakao Map 상태, REST 키 설정과 쿼터는
[Kakao 연동 문서](./kakao-api-integration.md)를 따릅니다.

선택형 웹 로그인 활성화 전에는 별도로 다음을 완료합니다.

1. Kakao Developers에서 카카오 로그인을 활성화하고 nickname/profile 동의
   항목을 검토합니다.
2. 운영 Redirect URI
   `https://chimap.madcamp-kaist.org/api/v1/auth/kakao/callback`을 등록합니다.
3. Client Secret을 활성화한 뒤 `KAKAO_OAUTH_CLIENT_SECRET`,
   `KAKAO_OAUTH_REDIRECT_URI`, 32자 이상 `AUTH_SESSION_SECRET`을 runtime에만
   주입합니다.
4. DB backup 뒤 migration 3을 적용하고 `app_users`, `oauth_accounts`,
   `auth_sessions` 생성을 확인합니다.
5. staging에서 login/cancel/relogin/logout과 비회원 추천 회귀를 확인합니다.
6. DB·log·browser storage에 카카오 token 원문이 남지 않는지 검사합니다.

### NAVER

- 알려진 주소→좌표 Geocoding
- KAIST 인근 좌표→주소 Reverse Geocoding
- 공개 도메인 Web Dynamic Map

REST endpoint는 `maps.apigw.ntruss.com`을 사용합니다. 이전 host로 회귀하지
않는지 확인합니다.

### TAGO

```bash
docker compose run --rm api node dist/cli/transit.js health
```

`stop`, `route`, `arrival`, `location` 네 항목이 모두 `success: true`,
`resultCode: "00"`인지 확인합니다.

## 4. 빌드와 DB 기동

```bash
docker compose build api
docker compose up -d postgres
docker compose ps
```

PostgreSQL health가 `healthy`가 될 때까지 기다립니다. API 시작 시 migration
실행기가 advisory lock을 얻고 checksum을 확인합니다.

Compose 운영값:

| 항목 | 값 |
| --- | --- |
| PostgreSQL image | digest가 고정된 PostGIS 18-3.6 Alpine |
| PostgreSQL memory | 768MiB |
| `shared_buffers` | 128MB |
| `max_connections` | 50 |
| API pool | 최대 10 |
| 공개 주변 정류장 반경 | 최대 500m |
| 추천 정류장 점진 탐색 | 500m→800m→최대 1.2km |
| PostgreSQL host port | 미노출 |
| API host port | `127.0.0.1:3000` |
| API metrics port | Compose 내부 `9091`, host 미노출 |
| Prometheus UI | `127.0.0.1:9090` |
| Alertmanager UI/API | `127.0.0.1:9093` |
| alert-relay | Compose 내부 `9080`, host 미노출 |
| Docker bridge MTU | 1400 |
| restart | `unless-stopped` |

## 5. 최초 정류장 import

```bash
docker compose run --rm \
  -v "$PWD/data/bus_data.csv:/data/bus-stops.csv:ro" \
  api node dist/cli/transit.js import-stops --path /data/bus-stops.csv
```

출력에서 다음을 배포 기록에 보존합니다.

- 감지 encoding
- 실제 import 수
- 제외 행 수
- 인식한 header
- 원본 파일 배포일과 SHA-256

제외율이 1%를 넘으면 transaction 전체가 rollback됩니다.

## 6. 초기 TAGO 노선 동기화

KAIST:

```bash
docker compose run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3723 --lng 127.3604 \
  --radiusMeters 1200 --maxRoutes 60 --concurrency 2
```

대전역:

```bash
docker compose run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3321 --lng 127.4342 \
  --radiusMeters 500 --maxRoutes 60 --concurrency 2
```

`syncedRouteCount`, `failedRouteCount`, `failureCodes`를 기록합니다.
`concurrency`는 CLI에서 1~4, `maxRoutes`는 1~200입니다. 동기화 파일의
반경은 50~2,000m를 검증하고 실제 조회는 애플리케이션의 추천 탐색 상한
기본 1.2km를 적용합니다.

여러 운영 지역과 원자적 상태 기록은 다음 명령을 사용합니다.

```bash
./ops/sync-transit.sh
```

성공 상태는
`/var/backups/chimap/transit-sync/transit-sync-latest.json`에 mode `0600`으로
기록되며 API는 읽기 전용 mount로 Prometheus 지표를 만듭니다.

```bash
docker compose run --rm api node dist/cli/transit.js stats
```

네 통계가 모두 0보다 커야 합니다.

### 지하철 CSV import와 TAGO 매핑

호스트의 `data/`에 둔 지하철 파일은 Compose 컨테이너의
`/data/subway_data.csv`와 `/data/subway-topology/`에 read-only mount됩니다.
운영 DB 백업 후 새 이미지를 올려 migration 7을 적용하고, 아래 순서로 실행합니다.

```bash
./ops/backup-postgres.sh
docker compose run --rm api node dist/cli/transit.js import-subway-stations
docker compose run --rm api node dist/cli/transit.js stats
docker compose run --rm api node dist/cli/transit.js sync-subway-stations \
  --concurrency 4
docker compose run --rm api node dist/cli/transit.js import-subway-topology
docker compose run --rm api node dist/cli/transit.js import-subway-provider-map
docker compose run --rm api node dist/cli/transit.js build-bus-subway-transfers \
  --concurrency 2
docker compose run --rm api node dist/cli/transit.js stats
```

첫 통계에서 `subwayStations=1097`, `activeSubwayStations=1097`을 확인합니다.
매핑은 중단 후 재실행해도 `MAPPED` row를 건너뜁니다. 공개 bundle과 로그에는
`DATA_GO_KR_SERVICE_KEY`가 없어야 하며 시간표 UI는 반드시
`TAGO 시간표 기반 예상`으로 표시합니다. 토폴로지 import 뒤에는 대표 경로에서
SUBWAY leg와 버스↔지하철 혼합 leg를 각각 확인합니다.

멀티모달 배포 순서는 `backup → migration 9 → station/topology import → provider
map import → TAGO mapping sync → transfer edge build → readiness/smoke`입니다.
환승 간선 배치는 route-linked 정류장만 역 반경 500m에서 가까운 10개까지 골라
Kakao 실제 보행 경로가 500m 이하인 결과만 upsert합니다. 실패한 run은
`bus_subway_transfer_build_runs`에 남으며 성공 run 전에는
`TRANSIT_ROUTER_MODE=legacy`로 되돌릴 수 있습니다.

서울 실시간 연동은 다음 조건을 모두 확인한 뒤에만 켭니다.

```dotenv
SEOUL_SUBWAY_ENABLED=1
SEOUL_SUBWAY_ALLOW_INSECURE_HTTP=1
SEOUL_SUBWAY_BASE_URL=http://swopenAPI.seoul.go.kr
SEOUL_SUBWAY_DAILY_REQUEST_LIMIT=900
```

- 공식 host `swopenapi.seoul.go.kr`의 80번 port만 사용함
- 키를 출력하지 않는 도착·위치 smoke가 각각 `INFO-000`으로 응답함
- redirect를 따르지 않고 API key가 서버 밖 로그·응답에 노출되지 않음
- 하루 1,000회 공식 한도보다 낮은 process-local guard를 설정함
- 로그와 browser bundle에 인증키/전체 요청 URL이 없음
- 장애 시 TAGO 시간표와 headway fallback으로 추천이 유지됨

이 예외는 CHIMap의 수신 HTTPS나 Certbot 인증과 별개인 outbound 연결입니다.
서울시 endpoint가 TLS를 제공하기 전까지 API key가 네트워크 구간에서 평문으로
전송되는 잔여 위험이 있으므로 다른 HTTP host에는 절대 재사용하지 않습니다.

## 7. 배포 전 백업

자동화와 같은 경로로 즉시 백업을 실행합니다.

```bash
./ops/backup-postgres.sh
```

스크립트는 Compose PostgreSQL의 환경변수를 컨테이너 안에서 읽고 다음을
순서대로 수행합니다.

1. 중복 실행 `flock` 차단
2. 임시 파일에 `pg_dump -Fc`
3. `pg_restore --list` archive 검증
4. 최종 파일 원자적 이동과 SHA-256 sidecar 생성
5. `/var/backups/chimap/latest.json` 성공 상태 갱신
6. 일간 7개·일요일 주간 4개 보존

배포 기록에는 파일명, byte 크기, SHA-256, DB 통계를 함께 남깁니다.

## 8. restore 검증

운영 DB 안에 시험 DB를 만들지 않고 digest가 고정된 별도
PostgreSQL/PostGIS 18 컨테이너를 사용합니다.

```bash
./ops/verify-postgres-backup.sh
```

스크립트는 최신 일일 백업의 checksum을 먼저 확인하고, PostGIS 이미지
초기화 완료를 기다린 뒤 `template0` 기반 빈 DB를 만들어 archive 전체를
복원합니다. restore 후 최소 다음을 확인합니다.

```sql
SELECT extversion FROM pg_extension WHERE extname = 'postgis';
SELECT version, name, checksum FROM schema_migrations ORDER BY version;
SELECT count(*) FROM bus_stops;
SELECT count(*) FROM bus_stops
  WHERE city_code IS NOT NULL AND node_id IS NOT NULL;
SELECT count(*) FROM bus_routes;
SELECT count(*) FROM bus_route_stops;
```

extension, migration과 네 통계가 모두 성공한 백업만 release rollback
자산으로 사용합니다. 결과는
`/var/backups/chimap/restore-latest.json`에 기록합니다.

현재 검증된 백업은 [구현·운영 현황](./current-state.md)에 기록되어 있습니다.

## 9. systemd timer 설치

```bash
./ops/install-systemd-units.sh
systemctl list-timers --all \
  chimap-backup.timer chimap-backup-verify.timer \
  chimap-transit-sync.timer
```

- 일일 백업: 03:15 KST, 최대 15분 분산, persistent
- 월간 restore: 매월 1일 04:30 KST, 최대 30분 분산, persistent
- 일일 교통 동기화: 01:30 KST, 최대 30분 분산, persistent
- unit은 API 공급자 비밀값을 process 환경으로 주입하지 않습니다.
- 실패 원인은 `journalctl -u chimap-backup.service` 또는
  `journalctl -u chimap-backup-verify.service`,
  `journalctl -u chimap-transit-sync.service`로 확인합니다.

## 10. 후보 이미지 smoke

현재 운영 컨테이너를 바꾸기 전에 별도 loopback 포트에서 새 이미지를
기동할 수 있습니다. 3001은 staging origin이 사용하므로 후보 이미지는 3002를
고정합니다.

```bash
docker run --rm -d \
  --name chimap-api-candidate \
  --network chimap_internal \
  --env-file .env \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e WEB_ORIGIN=http://127.0.0.1:3002 \
  -e WEB_DIST_PATH=/app/web \
  -p 127.0.0.1:3002:3000 \
  --entrypoint sh \
  chimap:actual-data \
  -lc 'export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"; exec node dist/server.js'

curl -fsS http://127.0.0.1:3002/api/v1/health
curl -fsS http://127.0.0.1:3002/api/v1/readiness
curl -fsS http://127.0.0.1:3002/api/v1/auth/session
curl -fsS http://127.0.0.1:3002/api/v1/mobile-config
```

검증 후 정확한 `chimap-api-candidate` 컨테이너만 중지합니다. 같은 이름의
기존 컨테이너가 없는지 먼저 확인합니다. 후보는 `.env`의 오래된
`DATABASE_URL`을 그대로 믿지 않고 Compose와 같은 `POSTGRES_*` 값으로 내부
주소를 만듭니다. 후보의 `WEB_ORIGIN`은 loopback이므로 정적 asset과 로컬 UI를
검증할 수 있지만 운영 OAuth callback 검증은 공개 승격 뒤 수행합니다.

## 11. API·모니터링 승격

```bash
docker compose up -d --no-build \
  api alert-relay alertmanager prometheus
docker compose ps
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/readiness
curl -fsS http://127.0.0.1:3000/api/v1/mobile-config
```

readiness HTTP 200 이후에만 Cloudflare origin을 새 API로 유지하거나
전환합니다.

공개 smoke:

1. `GET /api/v1/health`
2. `GET /api/v1/readiness`
3. 최초 이용 개인화에서 만 나이·신장·체중·생물학적 성별·하루 목표 필수 확인
4. 직접 한 걸음 길이 입력·20m 보행 측정 필드가 없는지 확인
5. 헤더 현재 걸음은 Enter·포커스 이탈에 반영되고 잘못된 값은 이전 값 유지
6. 왼쪽 패널에 출발지·도착지·위치 교환·현재 위치·CTA만 표시되고 지도 위
   검색 패널과 공급자 칩이 없는지 확인
7. KAIST 장소 검색과 명시 선택
8. 대전역 검색과 명시 선택
9. 새 추천 요청 body에 `deadline`, `maxExtraMinutes`,
   `safetyBufferMinutes`가 없는지 확인
10. 8,000보 목표에서 조기 하차 우선 추천과 목표 오차 확인
11. 역지오코딩과 NAVER 지도 경로선
12. ETA 10분 이하 승차 전 접근 차량과 승차~하차 구간 운행 차량만 표시되고
    WebP·흰 전광판·검은 노선번호·상태 title이 일치하는지 확인
13. 차량 10초 갱신을 두 번 이상 지나도 사용자가 바꾼 지도 중심·줌 유지
14. 출발·도착 주변 역과 U/D 다음 출발, 시간표 기반·지연 미반영·추천시간
    미합산 문구 확인
15. 왼쪽 패널 최하단 TAGO 버스·지하철 제공 안내와 NAVER SDK 기본 저작권 확인
16. localStorage v3 프로필·장소·당일 현재 걸음 저장과 새로고침 복구,
    v2 프로필·목표·장소 이전
17. 1440/768/390/320px overflow, 320px 주변 역 카드 단일 열
18. 루트 `data-ui-state`가 idle→editing-place→ready→calculating→results→
    route-selected로 전환되고 오류 시 `error`인지 확인
19. 추천 성공 0~2회 `guided`, 3회부터 `compact`이며 설정에서 자동/자세히/
    간결하게를 바꿔도 주요 컨트롤 위치가 유지되는지 확인
20. OS 또는 서비스의 동작 줄이기에서 드로잉·슬라이드·펄스가 제거되는지 확인
21. 계산 중 가상 단계·퍼센트 없이 단일 요청 표시가 보이고 8초 뒤 지연
    안내만 추가되는지 확인
22. 지도 경로 opacity가 비선택 0.18, hover/focus 0.55, 선택 NAVER 0.95·
    SVG fallback 1.0인지 확인
23. 익명 정보 동의 전·거부·철회 시 UI 이벤트 요청이 0건인지 확인
24. 동의 후 허용 이벤트가 `204 No Content`이고 Prometheus
    `chimap_ui_events_total`이 증가하는지 확인
25. 비로그인 상태에서 `/api/v1/auth/session`이 `authenticated=false`,
    `kakaoLoginAvailable=true`인지 확인
26. `/api/v1/auth/kakao/start`가 Kakao authorize로 302 이동하고 state cookie가
    HttpOnly·Secure·SameSite=Lax인지 확인
27. 로그인하지 않아도 검색·추천·지도 전체 흐름이 계속 동작하는지 확인
28. 실제 계정으로 login→callback→사용자 표시→logout을 확인
29. 공개 bundle에서 NAVER server, Kakao OAuth, session·TAGO 비밀값이 모두
    미검출인지 확인
30. `/api/v1/mobile-config`의 contract/minimum version/maintenance/region과
    guest·Kakao·Apple provider flag가 runtime credential 상태와 일치하는지 확인
31. `schema_migrations`가 1~7 current이고 candidate와 운영 readiness가 모두
    HTTP 200이며 지하철 전체·활성·매핑 통계가 기대값인지 확인

자동 E2E:

```bash
E2E_BASE_URL=https://chimap.madcamp-kaist.org \
E2E_REQUIRE_NAVER_MAP=1 \
pnpm test:e2e
```

배포 호스트에서 Playwright Docker image로 strict E2E를 실행할 때 기본
bridge가 `oapi.map.naver.com` 연결을 timeout하면 저장소의 Playwright
version과 같은 image를 `--network host`로 실행합니다. 현재 검증 image는
`mcr.microsoft.com/playwright:v1.61.1-noble`입니다. 이 우회는 테스트
컨테이너의 outbound 경로에만 적용하며 운영 Compose network 설정을
변경하지 않습니다.

### GitHub release gate

`.github/workflows/ci.yml`은 `main`과 `feat/**` push, Pull Request에서 다음
다섯 job을 독립 실행합니다.

- `API and Web quality`
- `Expo iOS and Android JavaScript quality`
- `iOS native compile`
- `Android native compile`
- `PostgreSQL and PostGIS integration`

다섯 job이 성공한 commit만 병합합니다. iOS/Android native job은 각 OS prebuild
직후 platform 전용 config verifier를 실행하고 unsigned simulator/debug compile을
수행합니다. `Public live E2E`는 실제 외부
호출량을 사용하므로 기본 브랜치에 workflow가 반영된 뒤 Actions에서
수동 실행합니다. 구현 commit `965aa88`의 과거 push/PR run은 당시 Web/API 두
job이 성공한 기록입니다. cross-platform foundation commit `f624e9b`의 push
run `30230011225`에서는 위 다섯 job이 모두 성공했습니다. 이후에도 다섯
job을 release gate로 사용합니다. `feat/tago-transit`에서 `main`으로 향하는
draft PR #1을 먼저 병합한 뒤 foundation branch를 갱신된 `main`에 rebase합니다.

### 2026-07-27 승격 기록

- release commit: `f624e9baeda6785d12655bc43f1f5376e5e9264d`
- GitHub Actions: run `30230011225`, 다섯 job 성공
- image: `sha256:0a2db829dc0fa72836a3a8393b0f8eb946cd53812e586cb5f783539b017f4483`
- 공개 asset: `/assets/index-GVl8ucg8.js`, 380,779 bytes
- DB: migration 1~6 current, readiness `227225/2844/134/5731`
- mobile config: guest enabled, 운영 mobile Kakao/Apple credential 입력 전이라
  두 provider disabled
- strict E2E: main·layout 통과, 확장 정류장 upstream 504 1회 후 단독 재실행 통과
- 배포 후 backup: `chimap-daily-20260727T020434Z.dump`, 17,350,161 bytes,
  SHA-256 `829a8a6911dc5e9f69091c993405035a4f75afbd12faebd5f2382d69686f4d0f`
- restore: `PostGIS=1/migration=6/227225/2844/134/5731`
- monitoring: Prometheus target 3개 `up`, rule 20개 healthy, Alertmanager ready

### 2026-07-27 버스·지하철·3종 추천 승격 기록

- release source: `96e25490d156386f0dc0860363d26fa672509795`
- image: `sha256:f497c9a50e3791f9d1f3ba72eb7334ac5580b7c6f4048a2a00f9d14c88d5f1bf`
- rollback image: `chimap:rollback-pre-20260727-webp-marker`
  (`sha256:08a54820c48feda9ad0499abb864119fe1a71902d16eb85cc2db9cf2dd10412b`)
- public assets: `/assets/index-BjbF61pt.js`, `/assets/index-CQVn3DWd.css`,
  `/assets/bus_icon-DB1cEqjH.webp`(9,464 bytes)
- validation: 결정적 테스트 182개와 격리 PostGIS 8개(전체 190), typecheck,
  workspace 경계·format, Web/API/iOS/Android `build:all` 통과
- DB: migration 1~7 current, 지하철 원본 1,099행→활성 1,097개,
  TAGO 정확 매핑 706개·미해결 391개·대기 0개
- 공개 API/UI: 대전역 검색·근처 역·U/D 시간표 기반 다음 출발과 추천 결과의
  출발·도착 주변 역 카드 확인
- strict E2E: 추천·주변 역·NAVER 지도·차량 10초 갱신·카메라 보존과
  1440/768/390/320px 통과. 확장 검색은 upstream 일시 실패 후 단독 재실행 통과
- 배포 후 backup: `chimap-daily-20260727T052848Z.dump`, 17,448,666 bytes,
  SHA-256 `40fdf6b44cef23f56954f9213e6ac045c3f1dcc19a3404330b0ed063a7acea8c`
- restore: `PostGIS=1/migration=7/227225/2844/134/5731`, 지하철 table data와
  모든 index archive 포함 확인
- security: 추적 파일·공개 bundle·최근 운영 log에서 서버 비밀값 0건
- monitoring: target 3개 `up`, rule 20개 healthy, Alertmanager ready,
  지하철 미매핑 gauge 391

### 2026-07-27 지하철 routing 보정과 staging 기동 기록

- source: `7a99e03057cf3764415a2d5114678c08eceb30dd`
- production image: `sha256:6cbd51c8…`, 15:51 KST 기동
- staging image: `sha256:7befecd1…`, 16:37 KST 기동
- production/staging local·external health: 16:48 KST HTTP 200
- staging project/volume: `chimap-staging` / `chimap-staging-postgres`
- staging mobile config: guest/Kakao true, Apple false
- staging database: PostGIS·migration current, provider 모두 configured
- staging transit: 정류장 227,054개·연결 7개, 노선/관계/지하철 0
- staging readiness: seed 미완료로 HTTP 503

17:44 KST에는 source `55fec7c`의 TAGO timeout 격리 수정을 staging에만
재배포하고 seed를 완료했습니다.

- staging image: `sha256:02971772…`
- transit: 정류장 227,207개·연결 2,144개·노선 50개·관계 4,178개
- subway: 전체/활성 1,097개·TAGO 매핑 706개
- local/external health·readiness HTTP 200
- KAIST 본원→대전역 실제 추천 3건(`FAST/BALANCED/GOAL`) HTTP 200
- mapping timeout 3건은 `PENDING`으로 보존하고 다음 실행에서 재시도
- seed 전 backup: `chimap-staging-preseed-20260727T080953Z.dump`, 17,293,693 bytes,
  SHA-256 `e1f387d7504574570186dc0ba8a67e196a3e0ec8ab72f9f17ce46f22873fd594`

production의 마지막 전체 strict E2E·백업·restore는 앞선 14:29 KST 기록을
유지합니다. staging은 production DB를 복사하지 않고 공개 교통 seed만 독립
적재했으며 자세한 재실행 절차는 [staging 환경 운영서](./staging-environment.md)를
따릅니다.

### 2026-07-27 요청 범위 멀티모달 routing 승격 기록

- 기능 commits: `4d800a5`, `83efdd3`, `b4c418d`, `43b71a1`
- 공개 E2E 보정 commit: `1d0804c`
- production image: `sha256:ce1caaca95c7b822bad59e790d2ad88560c9c95369573fd04db0ede15bba915d`
- router: `TRANSIT_ROUTER_MODE=multimodal`, 최대 환승 2회
- DB: migration 1~9 current, 정류장 227,225개·연결 2,844개,
  버스 노선 140개·노선 정류장 5,794개
- subway topology: 전체/활성 역 1,097개, TAGO 역 매핑 706개,
  서비스 노선 46개·route-ready 30개·provider mapping 697개
- bus↔subway: 500m 이내 후보 200개 중 실제 Kakao 보행 경로 182개 저장,
  거리·endpoint·LineString 검증 실패 후보는 제외
- 공개 smoke: KAIST→대전역에서 `multimodal-*` 3건, 지하철 포함·환승 포함,
  `TAGO_SUBWAY_TIMETABLE`과 버스 fallback timing source 확인
- strict E2E: NAVER 지도 필수, 지하철 단독 FAST·버스 포함 BALANCED,
  차량 10초 polling 2회 이상·카메라 고정과 4개 viewport 포함 3/3 통과
- security: 공개 JavaScript 1개에서 SEOUL/TAGO/Kakao 서버 key 이름과 값 0건
- monitoring: Prometheus target 3개 `up`; 외부 webhook 미설정 경고 1개는
  `ALERT_WEBHOOK_URL` 입력 대기 상태와 일치
- 배포 전 backup: `chimap-daily-20260727T092614Z.dump`, 17,611,642 bytes,
  SHA-256 `764dba0e81872eef431b8756f55512ba56ed35abf5d034fd9af4c93051d3fff6`
- 최종 backup: `chimap-daily-20260727T102927Z.dump`, 17,725,228 bytes,
  SHA-256 `e93038a5f59c2df6f36caab0edbd6ef5c21f78fc23e3916623790ca1c36d9f1f`
- 서울 실시간 API: `SEOUL_SUBWAY_API_KEY`는 서버 환경에만 존재하지만 공식
  HTTPS endpoint 연결을 검증하지 못해 `SEOUL_SUBWAY_ENABLED=0` 유지. 운영
  ETA는 TAGO 시간표 또는 배차간격 기반임을 응답에 명시

### 2026-07-27 서울 지하철 실시간 활성화 기록

- source commits: `ffe80d6`, `e16684b`
- production image: `sha256:77f4de84c4baaa11d0c865d6b95bde3ae928b8bc8404dcfeb24d09ff94040887`
- API container commit: `e16684b`, local/public health와 readiness HTTP 200
- 원인: 공식 host의 443/TLS는 connect timeout이고 80/HTTP만 정상. 운영 Docker
  bridge에서는 Node `fetch`도 timeout되어 공식 HTTP 경로를 `node:http`,
  `Connection: close`로 분리
- 보안 경계: exact host·80번 port·명시적 opt-in, redirect 차단, 응답 5MiB 제한,
  KST 일일 900회 process-local guard, 오류·로그에 key/전체 URL 미포함
- 실제 upstream smoke: 서울역 도착 20건, 1호선 위치 81건, HTTP 200/`INFO-000`
- 실제 추천 smoke: 서울역→강남역 HTTP 200, 세 후보 모두 첫 4호선 leg에서
  `SEOUL_REALTIME_ARRIVAL=true`, 이후 환승은 TAGO 시간표 fallback
- 역명 보정: CSV의 `서울역`처럼 끝에 `역`이 붙은 query는 서울 API 요청 전에
  접미사를 제거
- 외부 알림: `EXTERNAL_ALERTS_ENABLED=0`, relay health `disabled`, POST 202,
  `ChimapAlertDeliveryNotConfigured` 활성 경보 0개
- tests/build: API 114개 통과·8개 환경 통합 테스트 skip, relay 4개 통과,
  TypeScript/API/Web production build와 Prometheus 20개 rule 검증 통과
- security: 공개 asset `/assets/index-DVyoPrrl.js`에서 서버 key 이름·값 0건,
  최근 API log에서 key·전체 서울 요청 URL·error 0건
- monitoring: API/relay/Alertmanager target 3개 `up`, 경보 rule 20개 모두 `ok`
- 배포 전 backup: `chimap-daily-20260727T122539Z.dump`, 17,725,228 bytes,
  SHA-256 `12f5ec6f8f63193edff33f71c699d28e75ce3a28f20730f4d72cfbf55750e579`
- 배포 후 backup: `chimap-daily-20260727T123937Z.dump`, 17,736,605 bytes,
  SHA-256 `8ce86625ec1632eedf35a4af509e67854d3e34b441e74fc5554ac56feedc9b0e`

## 12. 공개 번들 비밀값 검사

배포 후 HTML의 JavaScript asset을 받아 서버 Client Secret이 포함되지
않았는지 검사합니다. 검사 스크립트는 비밀값 자체를 출력하지 않고
`present/absent`만 출력해야 합니다.

```bash
node --env-file=.env --input-type=module -e '
  const secret = process.env.NAVER_MAP_NCP_KEY;
  if (!secret) throw new Error("NAVER server secret이 비어 있습니다.");
  const origin = "https://chimap.madcamp-kaist.org";
  const html = await (await fetch(origin)).text();
  const asset = html.match(/src="([^"]+\.js)"/u)?.[1];
  if (!asset) throw new Error("JavaScript asset을 찾지 못했습니다.");
  const bundle = await (await fetch(new URL(asset, origin))).text();
  const present = bundle.includes(secret);
  console.log(`PUBLIC_BUNDLE_SERVER_SECRET=${present ? "present" : "absent"}`);
  if (present) process.exit(1);
'
```

추가로 Docker build context와 Git 추적 파일에 `.env`가 들어가지 않는지
확인합니다.

### Route Pulse asset 버전 확인

새 UI 배포 뒤 공개 HTML이 참조하는 JavaScript asset에서 현재 계약 marker를
확인합니다. 문자열 존재만으로 E2E를 대체하지는 않지만, 이전 bundle이 계속
서비스되는 배포 오류를 빠르게 찾을 수 있습니다.

```bash
node --input-type=module -e '
  const origin = "https://chimap.madcamp-kaist.org";
  const html = await (await fetch(origin)).text();
  const asset = html.match(/src="([^"]+\.js)"/u)?.[1];
  if (!asset) throw new Error("JavaScript asset을 찾지 못했습니다.");
  const bundle = await (await fetch(new URL(asset, origin))).text();
  const current = bundle.includes("route-pulse-v1");
  console.log(`ROUTE_PULSE_BUNDLE=${current ? "current" : "stale"}`);
  if (!current) process.exit(1);
'
```

## 13. 운영 점검

### 매일

- `docker compose ps`
- API health/readiness
- PostgreSQL `pg_isready`
- `systemctl status chimap-backup.timer`
- `systemctl status chimap-transit-sync.timer`
- 최신 custom-format 백업, checksum과 `latest.json`
- 최신 교통 동기화 성공 시각과 실패 노선 수
- Prometheus target과 rule health
- Alertmanager와 alert-relay health

```bash
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS 'http://127.0.0.1:9090/api/v1/targets?state=active'
curl -fsS http://127.0.0.1:9090/api/v1/rules
```

Prometheus에서 검색 0건률·NAVER 보완률, 공급자별 429/5xx, API p95,
DB pool 대기, TAGO timeout과 백업 시각·크기를 확인합니다. API 9091은
host에 publish하지 않습니다. 교통 동기화 성공 시각·최근 실패 노선 수와
외부 알림 전달 성공·실패도 함께 확인합니다. UI 정보 공유를 활성화한 뒤에는
`chimap_ui_events_total` label이 계약의 허용 enum만 사용하는지도 확인합니다.

### 정기

- 일간 백업 최근 7개, 주간 백업 최근 4개 보관
- 월 1회 별도 DB restore
- 공급자 쿼터와 알림 임계치 확인
- PostgreSQL volume·disk 사용량 확인
- route sync 실패 노선 재확인

로그에는 검색어, 좌표, 키와 공급자 원문을 넣지 않습니다.

## 14. NAVER Client Secret 교체

과거 노출 가능성이 있는 Secret은 NCP 콘솔에서 재발급합니다.

1. Application Services→Maps→Application
2. CHIMap Application→인증 정보→Client Secret 재발급
3. `.env`의 `NAVER_MAP_NCP_KEY`만 변경
4. API 재build·승격
5. NAVER geocode/reverse 200 확인
6. strict Web Dynamic Map E2E
7. 공개 번들 비밀값 미검출 확인

재발급 전 값은 즉시 폐기하며 문서·issue·채팅·로그에 원문을 남기지 않습니다.
현재 운영 교체와 재검증 결과는
[구현·운영 현황](./current-state.md)에 기록되어 있습니다.

## 15. 장애 알림 활성화와 확인

외부 URL은 루트 `.env`에만 둡니다.

```dotenv
EXTERNAL_ALERTS_ENABLED=1
ALERT_NOTIFICATION_PROVIDER=slack
ALERT_WEBHOOK_URL=
```

지원 provider는 `slack`, `discord`, `generic`입니다. 입력 후:

```bash
docker compose up -d --no-build --force-recreate alert-relay
./ops/check-alert-delivery.sh
```

확인 스크립트는 Alertmanager API에 실제 점검 경보를 넣고 relay의 마지막
전달 성공 시각이 갱신되는지 확인한 뒤 경보를 복구 상태로 바꿉니다.
현재처럼 외부 알림을 사용하지 않으면 `EXTERNAL_ALERTS_ENABLED=0`으로 둡니다.
이때 relay는 `/alerts`를 `202 disabled`로 수신 종료하고 health에
`enabled:false`를 표시하며, `ChimapAlertDeliveryNotConfigured` 경보도
평가하지 않습니다. 사용을 시작할 때만 flag와 URL을 함께 설정하고 아래 전달
검사를 실행합니다.

외부 알림을 다시 켠 뒤에는 구성 지표가 `1`인지, 점검 경보와 복구 알림이 실제
운영 채널에 모두 도착했는지 확인해야 활성화가 완료됩니다.

## 16. 롤백

코드만 문제이고 schema가 호환되면 직전 검증 이미지로 API만 되돌립니다.
DB 변경이 하위 호환되지 않으면 운영 volume을 직접 덮어쓰지 않고 다음
순서를 따릅니다.

1. 현재 DB 추가 백업
2. 새 named volume 또는 별도 PostgreSQL 생성
3. 직전 검증 백업 restore
4. migration·PostGIS·통계·공간 질의 확인
5. 직전 API 이미지 연결
6. readiness 200
7. Cloudflare origin 전환

검증되지 않은 이미지나 외부 공급자 계약과 다른 데이터로는 롤백하지
않습니다.

## 17. 공식 참고자료

- [Kakao Map 사용 방법](https://developers.kakao.com/docs/ko/kakaomap/common)
- [Kakao Map REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [NAVER Maps Application](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)
- [NAVER Maps API 공통 설정](https://api.ncloud-docs.com/docs/application-maps-overview)
- [PostgreSQL 18](https://www.postgresql.org/about/news/postgresql-18-released-3142/)
- [PostGIS ST_DWithin](https://postgis.net/documentation/tips/st-dwithin/)
- [Prometheus Alertmanager 구성](https://prometheus.io/docs/alerting/latest/configuration/)
