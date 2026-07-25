# 배포·백업·복구 운영서

운영 도메인은 `https://chimap.madcamp-kaist.org`이고 Cloudflare Tunnel
origin은 `http://127.0.0.1:3000`입니다. 명령은 저장소 루트에서
실행합니다.

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

다음 네 호출을 운영 서버의 실제 outbound IP에서 HTTP 200으로 확인합니다.

- keyword
- address
- coord2address
- walk

Kakao Map 상태, REST 키 설정과 쿼터는
[Kakao 연동 문서](./kakao-api-integration.md)를 따릅니다.

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
| PostgreSQL host port | 미노출 |
| API host port | `127.0.0.1:3000` |
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
  --radiusMeters 500 --maxRoutes 40 --concurrency 2
```

대전역:

```bash
docker compose run --rm api node dist/cli/transit.js sync-area \
  --lat 36.3321 --lng 127.4342 \
  --radiusMeters 500 --maxRoutes 40 --concurrency 2
```

`syncedRouteCount`, `failedRouteCount`, `failureCodes`를 기록합니다.
`concurrency`는 CLI에서 1~4, `maxRoutes`는 1~200, 반경은 설정된 최대
500m 안에서만 허용합니다.

```bash
docker compose run --rm api node dist/cli/transit.js stats
```

네 통계가 모두 0보다 커야 합니다.

## 7. 배포 전 백업

`.env`를 shell source하지 않고 컨테이너의 환경변수를 사용합니다.

```bash
mkdir -p /var/backups/chimap
docker compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > /var/backups/chimap/chimap-YYYYMMDD-before-release.dump

sha256sum /var/backups/chimap/chimap-YYYYMMDD-before-release.dump
```

백업 파일이 0 byte가 아닌지와 command exit code를 확인합니다. 배포 기록에는
파일명, byte 크기, SHA-256, DB 통계를 함께 남깁니다.

## 8. restore 검증

운영 DB 안에 시험 DB를 만들지 않고 별도 PostgreSQL/PostGIS 인스턴스를
사용합니다. restore 후 최소 다음을 확인합니다.

```sql
SELECT extversion FROM pg_extension WHERE extname = 'postgis';
SELECT version, name, checksum FROM schema_migrations ORDER BY version;
SELECT count(*) FROM bus_stops;
SELECT count(*) FROM bus_stops
  WHERE city_code IS NOT NULL AND node_id IS NOT NULL;
SELECT count(*) FROM bus_routes;
SELECT count(*) FROM bus_route_stops;
```

KAIST 좌표를 기준으로 `ST_DWithin(..., 500)` 반경 검색과 거리 정렬도
실행합니다. extension, migration, 네 통계와 공간 질의가 모두 성공한
백업만 release rollback 자산으로 사용합니다.

현재 검증된 백업은 [구현·운영 현황](./current-state.md)에 기록되어 있습니다.

## 9. 후보 이미지 smoke

현재 운영 컨테이너를 바꾸기 전에 별도 loopback 포트에서 새 이미지를
기동할 수 있습니다.

```bash
docker run --rm -d \
  --name chimap-api-candidate \
  --network chimap_internal \
  --env-file .env \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e WEB_ORIGIN=https://chimap.madcamp-kaist.org \
  -e WEB_DIST_PATH=/app/web \
  -p 127.0.0.1:3001:3000 \
  chimap:actual-data

curl -fsS http://127.0.0.1:3001/api/v1/health
curl -fsS http://127.0.0.1:3001/api/v1/readiness
```

검증 후 정확한 `chimap-api-candidate` 컨테이너만 중지합니다. 같은 이름의
기존 컨테이너가 없는지 먼저 확인합니다.

## 10. API 승격

```bash
docker compose up -d --no-build api
docker compose ps
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/readiness
```

readiness HTTP 200 이후에만 Cloudflare origin을 새 API로 유지하거나
전환합니다.

공개 smoke:

1. `GET /api/v1/health`
2. `GET /api/v1/readiness`
3. KAIST 장소 검색과 명시 선택
4. 대전역 검색과 명시 선택
5. KAIST→대전역 추천 카드
6. 역지오코딩
7. NAVER 지도 경로선
8. 저장·새로고침
9. 1440/768/390/320px overflow

자동 E2E:

```bash
E2E_BASE_URL=https://chimap.madcamp-kaist.org \
E2E_REQUIRE_NAVER_MAP=1 \
pnpm test:e2e
```

## 11. 공개 번들 비밀값 검사

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

## 12. 운영 점검

### 매일

- `docker compose ps`
- API health/readiness
- PostgreSQL `pg_isready`
- custom-format 백업과 checksum
- 검색 0건률·NAVER 보완률
- 공급자별 429/5xx
- API p95·TAGO timeout

### 정기

- 일간 백업 최근 7개, 주간 백업 최근 4개 보관
- 월 1회 별도 DB restore
- 공급자 쿼터와 알림 임계치 확인
- PostgreSQL volume·disk 사용량 확인
- route sync 실패 노선 재확인

로그에는 검색어, 좌표, 키와 공급자 원문을 넣지 않습니다.

## 13. NAVER Client Secret 교체

과거 노출 가능성이 있는 Secret은 NCP 콘솔에서 재발급합니다.

1. Application Services→Maps→Application
2. CHIMap Application→인증 정보→Client Secret 재발급
3. `.env`의 `NAVER_MAP_NCP_KEY`만 변경
4. API 재build·승격
5. NAVER geocode/reverse 200 확인
6. strict Web Dynamic Map E2E
7. 공개 번들 비밀값 미검출 확인

재발급 전 값은 즉시 폐기하며 문서·issue·채팅·로그에 원문을 남기지 않습니다.

## 14. 롤백

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

## 15. 공식 참고자료

- [Kakao Map 사용 방법](https://developers.kakao.com/docs/ko/kakaomap/common)
- [Kakao Map REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [NAVER Maps Application](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)
- [NAVER Maps API 공통 설정](https://api.ncloud-docs.com/docs/application-maps-overview)
- [PostgreSQL 18](https://www.postgresql.org/about/news/postgresql-18-released-3142/)
- [PostGIS ST_DWithin](https://postgis.net/documentation/tips/st-dwithin/)
