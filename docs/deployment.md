# 배포·백업·복구 운영서

운영 도메인은 `https://chimap.madcamp-kaist.org`이고 Cloudflare Tunnel
origin은 `http://127.0.0.1:3000`입니다. 명령은 저장소 루트에서
실행합니다.

cross-platform Web/API foundation, Route Pulse UI와 선택형 카카오 로그인은
2026-07-27 11:01 KST 이미지 `sha256:0a2db829...`로 공개 배포했고 11:05 KST
운영 점검과 migration 6 백업·전체 복원을 마쳤습니다. 아래 UI smoke와
asset·인증 확인은 이후 모든 이미지 승격에서도 반복합니다. iOS/Android
스토어 binary 배포는 이 Compose 승격과 별도 release입니다.

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
EXPO_PUBLIC_API_BASE_URL=https://chimap.madcamp-kaist.org
```

server `.env`의 Apple private key, NAVER Client Secret, refresh retry 암호화 key는
mobile binary에 넣지 않습니다. Web/API Compose 승격은 App Store·Play 배포를
자동으로 의미하지 않으며 각 mobile store artifact를 독립적으로 rollback합니다.

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
  -v "$PWD/bus data.csv:/data/bus-stops.csv:ro" \
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
기동할 수 있습니다.

```bash
docker run --rm -d \
  --name chimap-api-candidate \
  --network chimap_internal \
  --env-file .env \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e WEB_ORIGIN=http://127.0.0.1:3001 \
  -e WEB_DIST_PATH=/app/web \
  -p 127.0.0.1:3001:3000 \
  --entrypoint sh \
  chimap:actual-data \
  -lc 'export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"; exec node dist/server.js'

curl -fsS http://127.0.0.1:3001/api/v1/health
curl -fsS http://127.0.0.1:3001/api/v1/readiness
curl -fsS http://127.0.0.1:3001/api/v1/auth/session
curl -fsS http://127.0.0.1:3001/api/v1/mobile-config
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
12. 차량 마커 수가 선택 버스 구간 수 이하
13. 왼쪽 패널 최하단 데이터 제공 안내와 NAVER SDK 기본 저작권 표시 확인
14. localStorage v3 프로필·장소·당일 현재 걸음 저장과 새로고침 복구,
    v2 프로필·목표·장소 이전
15. 1440/768/390/320px overflow
16. 루트 `data-ui-state`가 idle→editing-place→ready→calculating→results→
    route-selected로 전환되고 오류 시 `error`인지 확인
17. 추천 성공 0~2회 `guided`, 3회부터 `compact`이며 설정에서 자동/자세히/
    간결하게를 바꿔도 주요 컨트롤 위치가 유지되는지 확인
18. OS 또는 서비스의 동작 줄이기에서 드로잉·슬라이드·펄스가 제거되는지 확인
19. 계산 중 가상 단계·퍼센트 없이 단일 요청 표시가 보이고 8초 뒤 지연
    안내만 추가되는지 확인
20. 지도 경로 opacity가 비선택 0.18, hover/focus 0.55, 선택 NAVER 0.95·
    SVG fallback 1.0인지 확인
21. 익명 정보 동의 전·거부·철회 시 UI 이벤트 요청이 0건인지 확인
22. 동의 후 허용 이벤트가 `204 No Content`이고 Prometheus
    `chimap_ui_events_total`이 증가하는지 확인
23. 비로그인 상태에서 `/api/v1/auth/session`이 `authenticated=false`,
    `kakaoLoginAvailable=true`인지 확인
24. `/api/v1/auth/kakao/start`가 Kakao authorize로 302 이동하고 state cookie가
    HttpOnly·Secure·SameSite=Lax인지 확인
25. 로그인하지 않아도 검색·추천·지도 전체 흐름이 계속 동작하는지 확인
26. 실제 계정으로 login→callback→사용자 표시→logout을 확인
27. 공개 bundle에서 NAVER server, Kakao OAuth, session 비밀값이 모두
    미검출인지 확인
28. `/api/v1/mobile-config`의 contract/minimum version/maintenance/region과
    guest·Kakao·Apple provider flag가 runtime credential 상태와 일치하는지 확인
29. `schema_migrations`가 1~6 current이고 candidate와 운영 readiness가 모두
    HTTP 200인지 확인

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
외부 URL이 아직 없다면 아래의 구성 지표 `0`과 설정 필요 경보가 정상입니다.

2026-07-26 01:26 KST 현재 Alertmanager와 relay health, 라우팅 설정과
격리 수신처 메시지 변환은 정상입니다. 외부 URL은 비어 있어
`chimap_alert_relay_configured=0`과
`ChimapAlertDeliveryNotConfigured`가 발생하는 상태가 정상입니다. URL 입력
후에는 구성 지표가 `1`인지, 점검 경보와 복구 알림이 실제 운영 채널에 모두
도착했는지 확인해야 활성화가 완료됩니다.

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
