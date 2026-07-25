# 테스트 시나리오

## 자동화 범위

| 계층 | 도구 | 핵심 검증 |
| --- | --- | --- |
| 공유 계약 | Vitest + Zod | 좌표, 장소, 경로, 요청·응답, 저장 V1 |
| Provider 계약 | Vitest | TAGO 단일/배열/빈 응답, 키 마스킹, 직행/환승 방향 |
| 추천 순수 함수 | Vitest | 걸음 계산, 마감, 점수, 중복 제거, 1~3개 선택 |
| API 통합 | Supertest | health, 검색, 정상 추천, 검증, 마감 실패, 부분 실패, rate limit |
| 웹 | Testing Library | 검색/추천, NAVER SDK 어댑터, TAGO 좌표 overlay, 지도 fallback, 저장 |
| E2E | Playwright Chromium | KAIST→대전역 전체 mock 흐름과 reload 복구 |
| 성능 | Node HTTP benchmark | warm-up 후 50회 추천 API p50/p95와 응답 크기 |

## 명령

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm benchmark:mock
```

Linux에서 E2E 브라우저가 없다면 다음을 한 번 실행한다.

```bash
pnpm --filter @chimap/web exec playwright install chromium
pnpm --filter @chimap/web exec playwright install-deps chromium
```

## 대표 시나리오

### TAGO/CSV

- 단일/배열/빈 `item`, 비정상 resultCode, 5xx 재시도와 키 마스킹
- UTF-8 BOM/CP949 CSV, 헤더 별칭, 재실행 upsert
- 파일 정류장번호와 TAGO nodeId 분리
- routeId 교집합, 역방향 nodeOrder 제외, 1회 환승/최대 환승 제한
- 실시간 도착 결합과 배차간격 예상값

### 정상 추천 3개

- 출발지: 한국과학기술원 KAIST
- 목적지: 대전역
- 현재/목표: 5,200 / 8,000걸음
- 최대 추가: 25분
- 보폭: 0.7m
- 기대: FAST, BALANCED, GOAL이 서로 다른 ID로 표시
- 기대: demo, 예상 걸음, 지금 출발 기준 경고
- 기대: 균형 카드 선택 시 상세와 마지막 선택 저장

### 랜딩 인트로

- 첫 세션 진입
- 기대: 경로선 드로잉, CHI/MAP 워드마크, 앱 화면 커튼 리빌
- 기대: 2.2초부터 본문 진입, 3초 뒤 인트로 제거
- 기대: 건너뛰기 버튼으로 즉시 종료
- 기대: 같은 세션의 reload와 reduced motion 환경에서는 자동 생략

### 이미 목표 달성

- 현재 걸음이 목표 이상
- 기대: 남은 걸음 0, 운동 후보 생성 생략
- 기대: FAST만 반환하고 목표 달성 안내

### 촉박한 마감

- 기본 경로도 안전 여유시간을 적용한 마감 이후 도착
- 기대: HTTP 404, `NO_ROUTE_WITHIN_DEADLINE`, request ID

### 후보 일부 실패

- mock provider의 조기 하차 도보 중 일부를 실패시킴
- 기대: 성공 후보는 계속 반환
- 기대: `PARTIAL_CANDIDATE_FAILURE`

### 충분히 다른 후보가 2개

- 기대: 정확히 2개 카드
- 기대: 존재하지 않는 GOAL 빈 카드 없음
- 기대: `LIMITED_ROUTE_VARIETY`

### 잘못된 입력

- 0.1m 보폭, 과거/6시간 초과 마감, 50m 미만 장소, 32KB 초과 body
- 기대: 안정적인 오류 코드와 field errors
- 기대: API 키나 stack trace가 응답에 없음

### 지도 실패

- NAVER Maps Client ID 없음, SDK load 실패 또는 `navermap_authFailure`
- 기대: SVG 경로 미리보기
- 기대: mock에서는 `NAVER 지도 + DEMO 경로` 공급자 표시
- 기대: BUS, SUBWAY, 일반 WALK, 운동 WALK 구분
- 기대: 모든 텍스트 이동 단계와 추천 수치 이용 가능

### NAVER 인증 실패와 재시도

- SDK script 200 뒤 `/v3/auth`가 실패하는 브라우저 상황을 모사
- 기대: `navermap_authFailure`를 오류로 전환하고 SVG fallback·재시도 버튼을 표시
- 기대: namespace 후 500ms 안정화 중 인증 실패면 map/overlay를 생성하지 않음
- 기대: SDK cleanup 중 overlay `setMap(null)` 또는 `Map.destroy()`가 예외여도 page error 없음
- 기대: callback이 `window.naver.maps` namespace보다 먼저 실행돼도 script `onload`로 정상 준비를 재확인

### NAVER 지도 어댑터

- `window.naver.maps`의 Map/Polyline/Marker/LatLng/LatLngBounds를 모사
- TAGO/test recommendation 2개의 6개 leg 전달
- 기대: NAVER Map 1개, Polyline 6개, Marker 3개
- 기대: 선택 경로 opacity/z-index 강조와 `fitBounds(maxZoom=16)`
- 기대: 좌표가 `{lng,lat}`에서 `LatLng(lat,lng)` 순서로 전달
- 기대: 갱신/언마운트 시 예외 안전한 overlay `setMap(null)`과 Map `destroy()`

### 위치 권한 거절

- 브라우저 geolocation 거절
- 기대: 직접 검색할 수 있다는 비차단 상태 메시지
- 기대: 기존 출발지와 폼을 잃지 않음

### 저장소 손상

- 잘못된 JSON, 잘못된 version 또는 범위 밖 값
- 기대: 예외 없이 기본 설정 사용
- 기대: 유효한 V1만 읽고 씀

## E2E 상세

`apps/web/e2e/happy-path.spec.ts`는 실제 Express mock 서버와 Vite 서버를
함께 실행한다. Vite의 `e2e` mode는 루트 `.env`에 실제 NAVER Client ID가
있어도 해당 값만 빈 값으로 compile해 외부 SDK 호출 없이 fallback 흐름을
결정론적으로 검증한다. 별도 `.env.e2e` 파일은 만들지 않는다.

1. demo 배지와 설명 확인
2. 300ms debounce 장소 검색으로 KAIST와 대전역 선택
3. 현재 5,200, 목표 8,000, 추가 25분 입력
4. 추천 요청 후 3개 카드와 지도 fallback 확인
5. BALANCED 선택, 상세 텍스트 단계 확인
6. `chimap:last-trip`, `chimap:preferences` 저장 확인
7. reload 후 장소, 목표, 추가시간 복구 확인

로딩 단계의 문구 전환은 실제 mock API가 너무 빨리 끝날 수 있으므로,
지연을 통제하는 웹 통합 테스트에서 별도로 검증한다.

## 검증 기록

2026-07-24 로컬 환경(문서 갱신 시 재실행):

- 공유 계약: 5개 통과
- API: 49개 통과
- 웹: 20개 통과
- `pnpm test` 전체 74개 통과
- Chromium E2E: 1개 통과
- strict typecheck와 production build 통과
- production web bundle: CSS 34.23kB(gzip 8.87kB),
  JS 354.89kB(gzip 108.04kB)
- 최신 source의 Docker 멀티스테이지 build 통과; runtime `user=node`,
  compiled transit CLI `stats`, same-origin root 200, health `mode=live` 확인
  (placeholder Kakao 값만 사용했으므로 외부 live API smoke는 아님)
- live Kakao/TAGO 추천 smoke: 최신 source의 공개 image 승격 전 미실행
- live TAGO smoke: 현재 공개 컨테이너가 mock image이므로 미실행
- 현재 local transit DB: stops/linkedStops/routes/routeStops 모두 0
- live NAVER 지도 smoke: Client ID는 번들에 존재하나 `/v3/auth`가 401이라 타일 표시는 미통과
- Certbot: `certbot renew --dry-run` 성공, 갱신 후 `chimap-app` health 회복 확인

E2E는 mock API와 Vite `e2e` mode로 실행하며 SVG fallback을 검증한다. 실제
NAVER 지도 성공 여부를 E2E 통과 조건으로 삼지 않는다. 실제 지도와 인증 실패
경로는 MapView 단위 테스트와 별도 수동 smoke에서 검증한다.

같은 날 `pnpm benchmark:mock` 결과:

```json
{
  "requests": 50,
  "p50Ms": 5.66,
  "p95Ms": 12.42,
  "maxMs": 22.1,
  "maxResponseBytes": 6625,
  "thresholdMs": 500
}
```

성능 수치는 하드웨어와 동시 부하에 따라 달라진다. 스크립트는 p95가
500ms를 넘으면 실패하므로 현재 환경에서 다시 측정할 수 있다.

## 수동 release 체크리스트

- [ ] 320px, 390px, tablet, desktop에서 수평 overflow 없음
- [ ] 키보드만으로 장소 선택, 제출, 카드 선택, details 열기 가능
- [ ] focus 표시와 44px 주요 터치 target 확인
- [ ] 색상만으로 이동 모드를 구분하지 않고 범례·텍스트가 함께 표시
- [ ] reduced motion에서 불필요한 animation 중단
- [ ] NAVER Client Secret이 브라우저 source, env 산출물, 로그에 없음
- [ ] NAVER 지도 로고/저작권 UI가 가려지지 않음
- [ ] `NAVER 지도 + TAGO/DEMO 경로` 출처가 실제 모드와 일치
- [ ] `WEB_ORIGIN` 외 CORS 거부
- [ ] SIGTERM 종료와 health probe 확인
- [ ] `certbot renew --dry-run` 후 `chimap-app`이 다시 기동하고 public health가 정상
- [ ] Cloudflare edge TLS와 원본 Certbot 인증서의 역할을 혼동하지 않음
- [ ] live 전환 시 Kakao/TAGO 쿼터·과금과 NAVER Web 서비스 URL 확인
- [ ] NAVER SDK 200뿐 아니라 `/v3/auth`와 실제 지도 타일 확인
- [ ] 영속 SQLite에 전국 정류장 import와 대표 route sync 확인
- [ ] NAVER/Kakao/TAGO 최신 약관상 교차 표시와 브랜드 고지 검토
- [ ] 실제 Kakao API 부하 테스트를 실행하지 않음
