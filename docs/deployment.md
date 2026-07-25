# 배포 가이드

## 배포 프로필

`chimap.madcamp-kaist.org`는 한 개의 same-origin Docker 배포를 쓴다.

- Express가 `/api/*`를 처리한다.
- 같은 프로세스가 `apps/web/dist`와 SPA fallback을 제공한다.
- Cloudflare Tunnel은 `127.0.0.1:3000` 원본으로 전달한다.

정적 웹 CDN + 별도 API 배포도 가능한 대안이지만 현재 운영 프로필은 아니다.
유료 API 활성화는 자동 수행하지 않는다. 저장소의 최신 TAGO 구현과 현재 공개
컨테이너는 아직 같은 revision이 아니므로 아래 “현재 상태”를 함께 읽어야 한다.

## 배포 전 게이트

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm benchmark:mock
docker build -t chimap .
```

live 키가 있다면 별도 통제 환경에서 Kakao 장소·도보, TAGO 각 서비스,
NAVER 지도 smoke를 소량 수행한다. 전국 정류장 import와 SQLite backup도
release gate다.

## Same-origin Docker 실행

`Dockerfile`은 Node 24 Alpine 멀티스테이지 빌드다. builder에서 contracts와
API, React 웹을 컴파일하고 production API 의존성을 deploy한다. runtime에는
API와 웹 정적 산출물만 복사하고 non-root `node` 사용자로 실행한다.

```bash
docker build -t chimap:0.1.0 .

docker run --rm -p 127.0.0.1:3000:3000 \
  -v /srv/chimap-data:/app/.data \
  -e KAKAO_MODE=live \
  -e KAKAO_REST_API_KEY='<secret>' \
  -e DATA_GO_KR_SERVICE_KEY='<secret>' \
  -e TRANSIT_DB_PATH=/app/.data/transit.sqlite \
  -e PORT=3000 \
  -e WEB_ORIGIN=https://chimap.madcamp-kaist.org \
  -e WEB_DIST_PATH=/app/web \
  -e LOG_LEVEL=info \
  chimap:0.1.0
```

live 웹은 NAVER 공개 Client ID를 build time에 넣고, Kakao/TAGO 비밀키는
runtime에만 넣는다.

```bash
docker build \
  --build-arg VITE_APP_MODE=live \
  --build-arg VITE_NAVER_MAP_NCP_KEY_ID="$NAVER_MAP_NCP_KEY_ID" \
  -t chimap:0.1.0 .

docker run --rm -p 127.0.0.1:3000:3000 \
  -v /srv/chimap-data:/app/.data \
  -e KAKAO_MODE=live \
  -e KAKAO_REST_API_KEY="$KAKAO_REST_API_KEY" \
  -e DATA_GO_KR_SERVICE_KEY="$DATA_GO_KR_SERVICE_KEY" \
  -e TRANSIT_DB_PATH=/app/.data/transit.sqlite \
  -e PORT=3000 \
  -e WEB_ORIGIN=https://chimap.madcamp-kaist.org \
  -e WEB_DIST_PATH=/app/web \
  chimap:0.1.0
```

최초 기동 전 같은 `TRANSIT_DB_PATH`를 사용해 `pnpm bus:import-stops`를
실행하고 대표 지역의 필요한 노선을 `pnpm bus:sync-route`로 동기화한다.
호스트의 `/srv/chimap-data`는 예시이며 실제로는 backup 가능한 명시적 경로를
사용한다. 컨테이너 교체 시 익명 writable layer에 DB를 남기면 안 된다.

runtime image에는 pnpm/tsx가 없지만 TypeScript로 compile된 CLI가 포함된다.
image 자체로 import할 때는 CSV를 read-only, DB 디렉터리를 writable로
마운트한 one-off 컨테이너를 사용한다.

```bash
docker run --rm \
  -v /srv/chimap-data:/app/.data \
  -v /srv/chimap-import/bus-stops.csv:/data/bus-stops.csv:ro \
  -e KAKAO_MODE=live \
  -e KAKAO_REST_API_KEY="$KAKAO_REST_API_KEY" \
  -e DATA_GO_KR_SERVICE_KEY="$DATA_GO_KR_SERVICE_KEY" \
  -e TRANSIT_DB_PATH=/app/.data/transit.sqlite \
  -e BUS_STOPS_DATA_PATH=/data/bus-stops.csv \
  chimap:0.1.0 \
  node dist/cli/transit.js import-stops
```

route sync도 같은 volume/key 설정에서 마지막 인자만
`sync-route --cityCode 25 --routeId ...`로 바꾼다. import/sync 완료 후
`stats`를 실행하고 DB 파일 backup을 만든 다음 web/API 컨테이너를 시작한다.

컨테이너 health check는 `/api/v1/health`를 호출한다. 플랫폼 startup probe도
같은 경로를 사용한다. 서버는 SIGTERM을 받으면 연결 수락을 중단하고 최대
10초 안에 종료한다.

## Cloud Run 예시

아래는 명령 예시일 뿐이며 프로젝트, region, secret, billing 승인을 확인한
운영자가 실행해야 한다.

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/chimap/api:0.1.0

gcloud run deploy chimap-api \
  --image REGION-docker.pkg.dev/PROJECT/chimap/api:0.1.0 \
  --region asia-northeast3 \
  --port 3000 \
  --cpu 1 \
  --memory 1Gi \
  --concurrency 8 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars KAKAO_MODE=live,WEB_ORIGIN=https://chimap.madcamp-kaist.org,WEB_DIST_PATH=/app/web,TRANSIT_DB_PATH=/mnt/chimap/transit.sqlite,LOG_LEVEL=info \
  --set-secrets KAKAO_REST_API_KEY=chimap-kakao-rest:latest,DATA_GO_KR_SERVICE_KEY=chimap-tago-key:latest \
  --timeout 20s \
  --allow-unauthenticated
```

위 예시는 secret 연결 형태만 보여 주며 `/mnt/chimap` volume 연결은 생략되어
있다. Cloud Run의 로컬 파일시스템만 쓰면 instance별 DB가 분리되고 재시작 때
지속성을 보장할 수 없다. 실제 배포는 Cloud Storage volume 등 지원되는
영속화 방식을 연결하거나, 초기화된 DB를 immutable artifact로 공급하는
절차를 별도로 설계해야 한다.

위 예시는 same-origin 웹과 API에 공개 ingress를 사용한다.
현재 MVP에는 사용자 인증이 없으므로 공개 배포 전 API Gateway, Cloud Armor
또는 별도 abuse 방어와 조직 정책을 검토한다. 비공개 서비스라면
`--no-allow-unauthenticated`로 바꾸고 웹에 인증 가능한 BFF가 필요하다.

권장 런타임 설정:

- request timeout: 20초 이상
- container concurrency: MVP 초기값 8
- min instances: 데모는 0, latency가 중요하면 1
- max instances: Kakao 쿼터와 예상 비용으로 계산
- CPU/memory: 1 vCPU, 1GiB부터 관찰
- Secret Manager에 Kakao/TAGO 서버 키 저장
- SQLite 영속 volume 또는 재현 가능한 DB 초기화 artifact

## 분리형 웹 호스팅 대안

공식 웹 origin은 `https://chimap.madcamp-kaist.org`다. 웹 환경변수는
build time 값이며, `VITE_API_BASE_URL`을 생략한 production 번들은 같은
origin의 `/api/v1/*`를 호출한다.

```bash
VITE_APP_MODE=live \
VITE_NAVER_MAP_NCP_KEY_ID="$NAVER_MAP_NCP_KEY_ID" \
pnpm --filter @chimap/web build
```

생성된 `apps/web/dist`를 정적 호스팅에 배포한다. SPA의 모든 비파일 경로를
`index.html`로 rewrite하되, 그보다 먼저 `/api/*`를 Cloud Run API로
reverse proxy한다. rewrite 우선순서는 다음과 같다.

```text
https://chimap.madcamp-kaist.org/api/*  → Cloud Run의 /api/*
https://chimap.madcamp-kaist.org/*      → apps/web/dist/index.html
```

다음을 함께 확인한다.

- HTTPS
- API의 `WEB_ORIGIN=https://chimap.madcamp-kaist.org`
- NAVER Maps Application에서 Web Dynamic Map 활성화
- NAVER Web 서비스 URL에 포트·경로 없이 대표 도메인
  `http://madcamp-kaist.org`와 필요한 preview/localhost origin 등록
- NAVER Client Secret은 build arg, env, 정적 파일에 주입하지 않음
- `index.html`은 짧게 cache, fingerprint asset은 장기 immutable cache
- CSP를 도입하면 NAVER SDK script와 지도 asset, API origin을 최소 범위로 허용

## 현재 Cloudflare Tunnel 연결

2026-07-24 실제 관측 상태:

```text
https://chimap.madcamp-kaist.org
  → Cloudflare Tunnel
  → http://127.0.0.1:3000
  → chimap-app Docker container
```

컨테이너는 `--restart unless-stopped`, Docker와 `cloudflared`는 systemd 자동
시작을 사용한다. 실행 중인 컨테이너는
`chimap:naver-stable-20260724`이며 `/api/v1/health`의 mode는 `mock`이다.
즉, 공개 도메인과 fallback UX는 서비스 중이지만 저장소의 TAGO live
implementation이 아직 이 컨테이너에 배포된 것은 아니다.

저장소의 현재 `TRANSIT_DB_PATH`에서 `pnpm bus:stats`를 실행한 결과도
`stops=0`, `linkedStops=0`, `routes=0`, `routeStops=0`이다. 전국 CSV가
workspace에 존재하는 것과 import 완료는 별개다. 이 상태에서는 최신
production server를 교체해도 실제 버스 추천이 준비됐다고 볼 수 없다.

NAVER 상태도 별도로 분리한다. 현재 정적 번들에는 루트 `.env`와 같은 Client
ID가 들어가 있고 SDK `maps.js` 요청은 HTTP 200이다. 그러나 SDK가 이어서
호출하는 `/v3/auth`는 HTTP 401이며 `ncpKeyId`와 과거 `ncpClientId` query,
등록 후보 URL의 http/https·대표/서브도메인 조합에서도 동일했다. 따라서
script 200만으로 성공 판정하지 않으며 실제 타일 표시를 완료로 기록하지
않는다. 앱은 인증 실패를 감지해 SVG 경로, 안내, `다시 불러오기`를 표시하고
page error 없이 계속 동작한다.

## HTTPS와 Certbot 인증서

2026-07-24에 Certbot 5.7.0으로 `chimap.madcamp-kaist.org`의 Let's Encrypt
ECDSA 인증서를 발급했고, `certbot renew --dry-run`까지 성공했다.

| 항목 | 현재 값 |
| --- | --- |
| 인증서 이름 | `chimap.madcamp-kaist.org` |
| 인증서 파일 | `/etc/letsencrypt/live/chimap.madcamp-kaist.org/fullchain.pem` |
| 개인키 파일 | `/etc/letsencrypt/live/chimap.madcamp-kaist.org/privkey.pem` |
| 유효 기간 | 2026-10-22 09:23:19 UTC까지 (KST 18:23:19) |
| 갱신 방식 | Certbot snap의 systemd timer + standalone HTTP-01, 포트 3000 |
| 갱신 훅 | pre에서 `chimap-app` 중지, post에서 다시 시작 |

발급과 갱신 중 HTTP-01 검증이 포트 3000을 사용하므로 Certbot pre/post hook은
`/etc/letsencrypt/renewal-hooks/pre/10-stop-chimap` 및
`/etc/letsencrypt/renewal-hooks/post/90-start-chimap`에 있다. 훅은 정확히
`chimap-app` 컨테이너만 다루며, `certbot renew --dry-run` 후 health가 회복되는
것을 확인했다.

중요: 이 인증서는 **현재 공개 응답에 제시되는 인증서가 아니다.** 현재 흐름은
Cloudflare Tunnel이 외부 HTTPS를 종료하고 Tunnel이 `http://127.0.0.1:3000`으로
전달한다. 따라서 브라우저가 보는 인증서는 Cloudflare edge 인증서이며, 위
Certbot 인증서는 원본에 보관·자동갱신만 되고 있다. 원본 TLS까지 실제 사용하려면
Nginx/Caddy 같은 로컬 reverse proxy를 `127.0.0.1:443`에 두고 fullchain/privkey를
마운트한 뒤 Cloudflare Tunnel의 origin service를 HTTPS로 변경하는 별도 변경이
필요하다. 이 변경 전에는 “Certbot 인증서가 공개 도메인에 적용됐다”고 기록하지
않는다.

상태 확인은 비밀값을 출력하지 않고 다음처럼 한다.

```bash
sudo certbot certificates --cert-name chimap.madcamp-kaist.org
sudo certbot renew --cert-name chimap.madcamp-kaist.org --dry-run --no-random-sleep-on-renew
curl -fsS https://chimap.madcamp-kaist.org/api/v1/health
```

갱신 훅은 짧게 컨테이너를 멈춘다. 가용성 손실 없이 원본 인증서를 쓰려면
HTTP-01 대신 DNS-01 또는 별도 TLS 종단 구조를 설계해야 한다.

외부 확인은 다음 경로와 브라우저 network를 기준으로 한다.

```bash
curl -fsS https://chimap.madcamp-kaist.org/
curl -fsS https://chimap.madcamp-kaist.org/api/v1/health
```

### 최신 소스 승격 체크리스트

1. NAVER Application에서 Web Dynamic Map 선택, 발급 Client ID, Web 서비스
   URL을 재확인하고 `/v3/auth` 2xx 및 실제 타일을 브라우저에서 확인한다.
2. Kakao REST와 네 가지 TAGO 서비스 키를 진단 명령으로 확인한다.
3. 전국 정류장 CSV를 영속 DB에 import하고 `bus:stats`를 기록한다.
4. 대표 직행·1회 환승 노선을 sync한 뒤 nearby/arrival/route/vehicle smoke를
   실행한다.
5. 현재 commit으로 immutable image를 빌드하고 staging에서
   `KAKAO_MODE=live` health, 추천, NAVER overlay, 10초 차량 polling을 확인한다.
6. 기존 컨테이너 정보를 보존한 채 교체하고 root/health/live 추천을 외부에서
   다시 확인한다.

## 관측과 알람

로그는 다음 allowlist 필드를 JSON으로 남긴다.

- `event`, `requestId`, `method`, `path`, `httpStatus`, `durationMs`
- `mode`, `candidateCount`, `recommendationCount`, `routeApiCallCount`
- 안정적인 내부 `errorCode`

원문 장소, 좌표, 요청 body, Kakao 키, upstream 응답을 로그로 수집하지 않는다.

권장 알람:

- 5xx 또는 504 비율
- 추천 p95와 15초 timeout 비율
- 429 비율
- health 실패와 인스턴스 재시작
- Kakao 장소·도보와 TAGO 서비스별 일일 쿼터 사용률
- 유료 API가 활성화된 경우 일일 비용 상한

## 롤백

1. immutable 이미지 태그 또는 digest를 사용한다.
2. 새 revision에 TAGO health와 실제 대전 smoke를 실행한다.
3. 낮은 비율로 traffic을 옮기고 오류율·latency를 관찰한다.
4. 문제가 생기면 직전 revision으로 traffic을 복귀한다.
5. 외부 API 장애 때 개발 fixture를 운영 대체로 사용하지 않는다.

SQLite migration은 이전 이미지와 호환되는 additive 변경만 사용하고, 배포 전
DB 파일을 별도 백업한다.
브라우저 저장 형식은 `version: 1`로 검증되어 새 버전에서도 모르는 형식을
안전하게 무시해야 한다.
