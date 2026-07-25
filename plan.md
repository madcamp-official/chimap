# CHIMap 5일 MVP 구현 계획

> 문서 상태: 구현 계획과 실행 이력. 현재 운영 사실은 아래 스냅샷 및 `docs/`를 우선한다.
> 작성일: 2026-07-24
> 최종 수정: 2026-07-24
> 대상 저장소: `/root/chimap`
> 제품 슬로건: **“목적지는 그대로, 가는 길은 더 건강하게.”**

## 0. 2026-07-24 구현·운영 스냅샷

이 문서는 5일 MVP를 시작할 때의 계획과 완료 기준을 보존한다. 아래의 과거형
조사 결과·체크리스트는 “현재 상태”가 아니라 당시 계획 기준일 수 있다. 현재
사실의 단일 기준은 `README.md`, `docs/architecture.md`,
`docs/tago-transit-integration.md`, `docs/naver-map-integration.md`,
`docs/deployment.md`다.

| 구분 | 현재 확인된 상태 |
| --- | --- |
| 데이터 공급자 | Kakao는 장소 검색·도보만, TAGO는 버스 정류장·노선·도착·차량만 담당 |
| 영속성 | Node 24 SQLite에 정류장/노선/route-stop만 저장, 실시간 데이터는 TTL cache |
| 환경변수 | API·Vite·CLI가 저장소 루트 `.env` 한 곳을 읽고 템플릿은 루트 `.env.example` 한 곳만 유지 |
| 지도 | NAVER SDK loader, 버스 정류장/승하차/차량 marker, SVG fallback과 재시도 구현 |
| 공개 주소 | `https://chimap.madcamp-kaist.org` → Cloudflare Tunnel → `127.0.0.1:3000` → `chimap-app` |
| 공개 컨테이너 | `chimap:naver-stable-20260724`, health `mode=mock`; 저장소의 TAGO live source는 아직 미승격 |
| NAVER live | Client ID는 번들에 있으나 `/v3/auth` 401으로 타일 smoke 미통과; fallback은 정상 |
| HTTPS | Cloudflare edge가 공개 TLS를 종료. Certbot ECDSA origin certificate은 발급·dry-run 갱신 완료이나 현재 Tunnel origin에는 미사용 |

계획 본문에서 “Kakao 대중교통” 또는 “Client ID 미제공”이라고 적힌 역사적
문맥은 위 스냅샷으로 대체한다. 해당 부분은 구현 설계의 의미를 보존하기 위해
남아 있을 뿐, 배포 판단 근거가 아니다.

## 1. 문서 목적

이 문서는 CHIMap MVP를 5일 안에 실제로 구현하기 위한 실행 기준서다. 단순 작업 목록이 아니라 아래 항목을 한곳에서 관리한다.

- 제품 범위와 비범위
- 기술 구조와 의존성 방향
- 5일 일정과 단계별 완료 게이트
- 외부 API 호출 예산과 장애 대응
- 테스트, 성능, 보안, 접근성 기준
- 구현 중 의사결정 원칙과 위험 완화책
- 최종 인수 조건과 증빙 방법

구현 중 요구사항이 충돌하면 이 문서의 범위 원칙과 원본 프롬프트를 함께 확인한다. 사용자 경험 구조는 [`IA.md`](./IA.md), 데이터와 영속성 계약은 [`db_schema.md`](./db_schema.md)를 기준으로 한다.

---

## 2. 최초 저장소 점검 결과

이 절은 작업 시작 당시 기준선이다. 현재 구현·배포 상태는 0절을 우선한다.

| 점검 항목 | 확인 결과 | 처리 방침 |
|---|---|---|
| Git 브랜치 | `main` | 기존 이력 유지 |
| Git 작업 트리 | 초기 계획 시점의 관찰값 | 현재 작업 트리는 사용자 변경을 보존하며 이 표로 판단하지 않음 |
| 기존 파일 | `README.md` 1개 | 삭제하지 않고 제품 문서로 확장 |
| `AGENTS.md` | 없음 | 별도 저장소 지침 없음 |
| `sources/` | 없음 | 추후 생기더라도 읽기 전용으로 취급 |
| 중첩 `chimap/` | 없음 | 저장소 루트를 제품 루트로 사용 |
| 패키지/잠금 파일 | 없음 | pnpm workspace 신규 구성 |
| `.openai/hosting.json` | 없음 | 기존 호스팅 프로젝트 제약 없음 |
| 기존 사용자 코드 | 없음 | 파괴적 정리 불필요 |
| 현재 런타임 | Node.js 미설치 | 개발/CI 기준 Node.js 24 LTS 명시, 로컬 검증 환경 별도 준비 |
| Kakao REST API 키 | 현재 공개 컨테이너에는 live 검증용 키 미확인 | source는 `live`에서 키가 없으면 명시적으로 시작 실패 |
| NAVER Maps Client ID | 루트 `.env`에 입력되어 build됨 | SDK 200 뒤 인증 401; SVG 폴백 유지 |

### 2.1 재사용할 부분

- 저장소와 Git 이력
- 루트 `README.md` 파일 경로
- 원본 프롬프트의 확정 도메인 모델, 계산식, API 규격

### 2.2 새로 만들 부분

```text
/
├─ apps/
│  ├─ api/                 # Express 5 API
│  └─ web/                 # React 19 + Vite
├─ packages/
│  └─ contracts/           # 공유 Zod 스키마 및 타입
├─ docs/                   # 구조, 알고리즘, Kakao/TAGO, NAVER, 배포, 테스트 문서
├─ plan.md
├─ IA.md
├─ db_schema.md
├─ pnpm-workspace.yaml
├─ package.json
├─ tsconfig.base.json
├─ .env.example
├─ Dockerfile
└─ .dockerignore
```

### 2.3 API 키 없이 가능한 범위

- KAIST → 대전역, KAIST → 유성온천역 데모
- 장소 검색, 기본 경로, 조기 하차 후보, 운동 구간 결합
- FAST/BALANCED/GOAL 선정과 중복 제거
- 마감시간 초과, 2개 결과, 목표 달성, 부분 실패 시나리오
- 전체 모바일 UI와 NAVER 지도 키 부재 시 SVG/텍스트 폴백
- 단위/계약/API/프론트/E2E 테스트
- production build와 Docker build

### 2.4 구현 전 위험과 현재 판정

1. Kakao 장소·도보와 TAGO 네 서비스는 운영 키·데이터를 갖춘 staging에서
   별도 live smoke가 필요하다.
2. NAVER Maps Client ID는 존재하지만 Application 인증이 401이므로 실제 지도 타일 smoke를 통과하지 못했다.
3. TAGO raw 응답의 객체/배열/빈 item과 문자열 숫자를 방어적으로 처리한다.
4. CSV 정류장번호와 TAGO node ID를 분리하고 30m·이름 단일 후보만 연결한다.
5. 후보 예산 9회 외에도 각 transit 계산의 TAGO service 호출을 TTL cache와
   single-flight로 보호해야 한다.
6. 서로 다른 공급자의 지도와 경로를 결합하므로 공개 전 NAVER/Kakao/TAGO
   최신 약관, 표시 의무, 상표 지침을 서비스 소유자가 재검토해야 한다.
7. 5일 일정에서 지도 SDK, 추천 엔진, 접근성, E2E를 모두 다뤄야 하므로 완료 게이트가 엄격해야 한다.

위험별 대응은 [17. 위험 관리](#17-위험-관리)에 정의한다.

---

## 3. 제품 범위

### 3.1 MVP 목표

사용자가 출발지, 목적지, 현재/목표 걸음 수, 도착 마감시간, 추가 허용시간, 평균 보폭을 입력하면 “지금 출발” 기준으로 대중교통과 도보를 조합한 건강 경로를 1~3개 추천한다.

### 3.2 핵심 기능 요구사항

문서 간 추적을 위해 다음 ID를 사용한다.

| ID | 요구사항 | 인수 기준 |
|---|---|---|
| FR-01 | 출발지/목적지 검색과 선택 | 300ms 디바운스, 요청 취소, 키보드 선택 가능 |
| FR-02 | 운동 목표 입력 | 숫자 직접 입력, 실시간 부족 걸음 표시, 유효성 검증 |
| FR-03 | 기본 대중교통 경로 | 가장 빠른 정상 경로를 baseline으로 계산 |
| FR-04 | 조기 하차 운동 후보 | 목적지 인근 마지막 3~6개 정류장 검토, 최대 4개 경로 후보 |
| FR-05 | 실제 POI 폴백 | 정류장 해석 실패 시 실제 공원/광장/역/공공시설 최대 2개 |
| FR-06 | 시간 제약 | 안전 여유와 추가 허용시간을 모두 통과한 경로만 추천 |
| FR-07 | FAST/BALANCED/GOAL | 정의된 계산과 정규화 점수로 선정 |
| FR-08 | 경로 중복 제거 | 동일 경로를 다른 타입 카드로 반복 노출하지 않음 |
| FR-09 | 공급자 분리 지도 시각화 | NAVER Web Dynamic Map 위에 TAGO 버스·Kakao 도보 정규화 경로를 버스/일반 도보/운동 도보로 구분 |
| FR-10 | 텍스트 경로 상세 | 지도 없이도 모든 이동 단계를 이해 가능 |
| FR-11 | 데모 모드 | API 키 없이 완전 동작하며 “데모 데이터”를 명시 |
| FR-12 | 설정/선택 저장 | 버전형 localStorage, 파싱 실패 시 안전 복구 |
| FR-13 | 단계별 상태 | 검색/기본 경로/후보 계산/부분 실패 등을 별도 안내 |
| FR-14 | 현재 위치 | 권한 성공 시 검색 중심 활용, 거절 시 수동 검색 유지 |
| FR-15 | mock/live 전환 | 동일한 내부 계약을 쓰며 Kakao/TAGO raw 모델은 서버에 격리 |

### 3.3 비기능 요구사항

| ID | 요구사항 | 목표 |
|---|---|---|
| NFR-01 | 모바일 우선 | 390×844 우선, 320px에서도 핵심 기능 유지 |
| NFR-02 | 접근성 | label, 44px 터치 영역, 키보드, 포커스, 비색상 구분 |
| NFR-03 | mock 성능 | 추천 API p95 500ms 이하 |
| NFR-04 | live 성능 | 대부분 8초 이내, 전체 처리 15초 상한 |
| NFR-05 | 응답 크기 | 추천 응답 2MB 이하 |
| NFR-06 | 보안 | 비밀 키 서버 격리, Helmet/CORS/rate limit/body limit |
| NFR-07 | 개인정보 | 정확한 위치와 원시 걸음 수를 일반 로그/분석 도구에 미전송 |
| NFR-08 | 복원력 | 일부 후보 실패 시 성공 후보 반환, baseline 실패 시 명시적 실패 |
| NFR-09 | 배포 준비 | non-root Docker, SIGTERM, health, Cloud Run 20초 |
| NFR-10 | 쿼터 보호 | 경로 API 9회 상한, 동시성 3, 단기 캐시 |

### 3.4 명시적 비범위

- 미래 출발/도착 대중교통 시간표 검색
- 실시간 운행 지연 반영과 도착 보장
- 턴바이턴 실시간 내비게이션
- 회원가입, 서버 사용자 계정, 데이터베이스
- HealthKit, Health Connect, 스마트워치
- 결제, 비즈월렛 연결, 유료 API 자동 활성화
- 사용자 승인 없는 외부 배포
- 실제 Kakao API를 이용한 부하 테스트

---

## 4. 제품 성공 기준

### 4.1 사용자 관점

1. 사용자가 mock 모드에서 2분 안에 KAIST → 대전역 추천 흐름을 끝낼 수 있다.
2. 결과 카드만 보고 예상 도착시간, 추가시간, 예상 걸음, 목표 달성률, 환승, 요금을 비교할 수 있다.
3. 지도 로딩에 실패해도 텍스트 단계로 경로를 사용할 수 있다.
4. 목표 달성이 불가능하거나 결과가 1~2개뿐인 이유를 숨기지 않는다.
5. 데모와 실제 데이터가 명확히 구분된다.

### 4.2 기술 관점

1. `pnpm test`와 `pnpm build`가 mock 기본값에서 통과한다.
2. 공유 계약 이외의 Kakao/TAGO raw 타입이 웹 번들에 들어가지 않는다.
3. deadline 또는 max extra 제약을 위반한 추천이 0개다.
4. 한 추천 요청의 경로 API 호출 수가 9회를 넘지 않는다.
5. 실제 비밀 값이 저장소, 클라이언트 DOM, 응답, 로그에 없다.
6. API 키가 없을 때 live처럼 보이는 가짜 성공을 만들지 않는다.

---

## 5. 확정 기술 구조

### 5.1 스택

- Node.js 24 LTS
- TypeScript strict mode
- pnpm workspace
- React 19, Vite, Tailwind CSS
- TanStack Query, Zustand
- Express 5
- Zod 공유 계약
- Pino, Helmet, CORS, `express-rate-limit`
- `p-limit`, `lru-cache`
- Node 24 built-in SQLite와 SQL migration
- Vitest, Testing Library, Supertest
- Playwright(mock E2E)

### 5.2 의존성 방향

```text
apps/web
  ├─ packages/contracts
  ├─ CHIMap REST API
  └─ NAVER Maps JavaScript API v3 (지도 타일·오버레이 표시 전용)

apps/api
  ├─ packages/contracts
  ├─ PlaceSearchService
  ├─ MobilityProvider
  │   ├─ MockMobilityProvider
  │   ├─ KakaoMobilityProvider (장소·도보)
  │   └─ TagoTransitMobilityProvider
  ├─ TransitService / TagoClient / TransitRepository
  ├─ CandidateGenerator
  ├─ RecommendationEngine
  ├─ RouteDeduplicator
  └─ Cache / SingleFlight / RateLimiter
```

다음 규칙은 예외 없이 지킨다.

- `packages/contracts`는 웹과 API가 공유하는 공개 모델만 포함한다.
- Kakao/TAGO raw 응답 타입과 인증은 `apps/api` provider/client 내부에만 둔다.
- 추천 엔진은 Express나 공급자 raw 모델에 의존하지 않는 순수 로직으로 만든다.
- NAVER 지도 SDK 객체는 웹 `MapView` 어댑터 경계에서만 생성한다.
- 좌표는 지도 SDK 호출 직전까지 `{lng, lat}`를 사용한다.
- 웹은 Kakao Map JavaScript SDK를 로드하지 않고, API는 NAVER 길찾기 API를 호출하지 않는다.

### 5.3 런타임 모드

| 항목 | mock | live |
|---|---|---|
| 장소·도보/버스 원천 | 익명 fixture | Kakao REST 장소·도보 + TAGO 버스 API |
| 서버 키 | 불필요 | `KAKAO_REST_API_KEY`와 TAGO 공통/서비스별 키 |
| 버스 DB | fixture 내장 | 전국 CSV import와 TAGO route sync SQLite |
| 지도 원천 | NAVER Web Dynamic Map 또는 SVG 폴백 | NAVER Web Dynamic Map 또는 SVG 폴백 |
| 지도 공개 키 | 웹 `VITE_NAVER_MAP_NCP_KEY_ID`, 없어도 폴백 | 웹 `VITE_NAVER_MAP_NCP_KEY_ID` |
| UI 표시 | “데모 데이터” 상시 표시 | 실제 조회 모드 표시 |
| 테스트 기본값 | 사용 | `LIVE_API_TEST=1`일 때만 smoke |
| 실패 처리 | fixture 시나리오에 따라 명시 | 정규화된 upstream 오류 |

`mock/live`는 장소·도보와 버스 데이터의 API provider 모드이며 지도 공급자 모드가
아니다. mock 경로도 NAVER 키가 있으면 NAVER 지도 위에 표시할 수 있고, live
경로도 NAVER 키가 없으면 SVG 폴백으로 표시한다.

### 5.4 지도·경로 공급자 분리 계약

```text
브라우저 ── ncpKeyId ──> NAVER Web Dynamic Map (타일/축척/줌/저작권 UI)
브라우저 ── 공개 JSON ──> CHIMap API ── REST 비밀키 ──> Kakao 장소/도보
                                      │
                                      ├─ 공공데이터 키 ──> TAGO 버스
                                      └─ WGS84 {lng,lat} 정규화
브라우저 <──────────── Recommendation.legs[].coordinates
브라우저 ── NAVER Polyline/Marker ──> 정규화된 Kakao/TAGO 경로·차량 오버레이
```

- basemap, 줌/이동, 지도 로고와 데이터 저작권 컨트롤은 NAVER SDK가 담당한다.
- 장소 검색·도보는 Kakao REST, 버스 정류장·노선·도착·차량은 TAGO, 후보/추천은 API가 담당한다.
- 두 공급자 사이에는 SDK 객체나 raw 응답을 공유하지 않고 WGS84 공개 계약만
  경계로 사용한다.
- live는 `NAVER 지도 + TAGO 경로`, mock은 `NAVER 지도 + DEMO 경로` 칩으로
  실제 데이터 출처를 오인하지 않게 한다.
- NAVER 로고/지도 데이터 컨트롤은 끄거나 가리지 않는다.
- 기술 구현 완료와 별개로, 공개 서비스 전에는 각 공급자 최신 약관상 교차 표시
  허용 범위와 필요한 고지를 서비스 운영자가 확인한다.

---

## 6. 핵심 도메인 계산 계획

모든 계산은 한 순수 함수 모듈에서 구현하고 API 응답과 UI가 그 결과를 재사용한다.

```text
remainingSteps = max(goalSteps - currentSteps, 0)

targetTripWalkDistanceMeters =
  remainingSteps × strideLengthMeters

routeEstimatedSteps =
  round(routeWalkDistanceMeters / strideLengthMeters)

baseEstimatedSteps =
  round(baseWalkDistanceMeters / strideLengthMeters)

additionalNeededDistanceMeters =
  max(targetTripWalkDistanceMeters - baseWalkDistanceMeters, 0)

shortfallCoverageRate =
  remainingSteps == 0
    ? 1
    : min(routeEstimatedSteps / remainingSteps, 1)

expectedTotalStepsAfterTrip =
  currentSteps + routeEstimatedSteps

dailyGoalCompletionRate =
  min(expectedTotalStepsAfterTrip / goalSteps, 1)
```

### 6.1 시간 제약

```text
departureAt = 서버가 추천 요청을 받은 시각
arrivalAt = departureAt + route.durationSeconds
effectiveDeadline = deadline - safetyBufferMinutes

deadlineConstraint =
  arrivalAt <= effectiveDeadline

extraTimeConstraint =
  route.durationSeconds
  <= baseline.durationSeconds + maxExtraMinutes × 60
```

두 제약을 모두 만족한 후보만 추천 대상으로 사용한다. 후보가 없으면 deadline 위반 경로를 추천으로 둔갑시키지 않고 `NO_ROUTE_WITHIN_DEADLINE` 또는 적절한 “최선 경로 안내” 상태를 반환한다.

### 6.2 추천 점수

```text
stepError =
  min(
    abs(routeEstimatedSteps - remainingSteps)
      / max(remainingSteps, 1000),
    1
  )

timePenalty =
  min(
    max(routeExtraMinutes, 0)
      / max(maxExtraMinutes, 1),
    1
  )

transferPenalty =
  min(routeTransferCount / 3, 1)

balancedScore =
    0.55 × stepError
  + 0.30 × timePenalty
  + 0.10 × transferPenalty
  + 0.05 × connectionPenalty
```

- FAST: 유효 후보 중 소요시간 최소
- BALANCED: 유효 후보 중 `balancedScore` 최소
- GOAL: `abs(routeEstimatedSteps - remainingSteps)` 최소, 동점이면 더 빠른 경로
- 이미 목표 달성: FAST 우선, 불필요한 추가 걷기 비권장

### 6.3 중복 제거

다음 조건이 모두 맞으면 같은 경로로 본다.

- 노선 이름 조합 동일
- 환승 횟수 동일
- 도보거리 차이 250m 미만
- 총 시간 차이 3분 미만
- 주요 형상 유사

선정 후 같은 후보가 겹치면 목표/시간 제약을 만족하는 대체 후보를 찾는다. 대체 후보가 없으면 중복 카드 대신 결과를 1~2개로 줄이고 이유를 warning으로 전달한다.

---

## 7. 후보 생성 전략

### 7.1 단계

1. 출발지 → 목적지 대중교통을 1회 조회한다.
2. 반환된 정상 경로 전부를 기본 후보로 포함한다.
3. 가장 빠른 경로를 baseline으로 선택한다.
4. 각 경로의 마지막 BUS/SUBWAY leg에서 마지막 정류장을 제외한 목적지 쪽 3~6개 정류장명을 모은다.
5. 정류장명을 목적지 중심 Kakao 장소 검색으로 해석한다.
6. 교통 카테고리, 이름 유사도, 경로선까지 거리로 신뢰도를 계산한다.
7. 필요한 추가 걷기 거리의 50~100%에 가까운 실제 정류장 최대 4개를 선택한다.
8. 각 지점에 대해 출발지 → 지점 대중교통, 지점 → 목적지 도보를 조회한다.
9. 연결 간격, 중복, 목적지 종점, 거리 합계를 검증한다.
10. 부족할 때만 실제 POI 폴백을 최대 2개 사용한다.

### 7.2 연결 후보 불변식

- 별도 도보 leg는 `isExerciseSegment=true`.
- 결합 경로의 마지막 좌표는 목적지와 허용 거리 안에 있어야 한다.
- 대중교통 끝 좌표와 도보 시작 좌표가 과도하게 멀면 폐기한다.
- 누락 연결을 직선 임의 좌표로 채우지 않는다.
- 바다, 하천, 도로 중앙 등 검색으로 검증되지 않은 좌표를 후보로 만들지 않는다.
- 일부 후보 실패는 warning으로 남기고 성공 후보를 유지한다.

### 7.3 외부 호출 예산

| 종류 | 최대 호출 |
|---|---:|
| 기본 대중교통 | 1 |
| 조기 하차/POI 대중교통 | 4 |
| 조기 하차/POI 도보 | 4 |
| 합계 | 9 |

- 후보 생성 동시성: 3
- 장소 검색 timeout: 3초
- 대중교통/도보 timeout: 각 5초
- 추천 전체 timeout: 15초
- 서버 timeout 목표: 20초
- 재시도: 429/502/503/504만 최대 1회
- 새 사용자 요청: 이전 브라우저 요청을 AbortController로 취소

---

## 8. API 구현 계획

### 8.1 공개 엔드포인트

| Method | Path | 역할 | 제한 |
|---|---|---|---|
| GET | `/api/v1/health` | 상태와 모드 | 비밀 미노출 |
| GET | `/api/v1/places` | 정규화 장소 검색 | IP당 60회/분 |
| POST | `/api/v1/recommendations` | 건강 경로 추천 | IP당 10회/분 |
| GET | `/api/v1/transit/bus/stops/nearby` | 주변 정류장 | 좌표/radius 검증 |
| GET | `/api/v1/transit/bus/stops/:nodeId/routes` | 경유 노선 | `cityCode` 필수 |
| GET | `/api/v1/transit/bus/stops/:nodeId/arrivals` | 실시간 도착 | `cityCode` 필수 |
| GET | `/api/v1/transit/bus/routes/:routeId` | 노선 상세 | `cityCode` 필수 |
| GET | `/api/v1/transit/bus/routes/:routeId/stops` | 경유 정류장 | `cityCode` 필수 |
| GET | `/api/v1/transit/bus/routes/:routeId/vehicles` | 실시간 차량 | `cityCode` 필수 |
| POST | `/api/v1/transit/recommendations` | 추천 호환 endpoint | IP당 10회/분 |

transit router는 `/api/transit`에도 호환 마운트된다.

### 8.2 계약

- 요청/응답은 `packages/contracts`의 Zod 스키마로 검증한다.
- API 경계 시간은 ISO 8601, 표시만 Asia/Seoul로 변환한다.
- 응답 좌표는 `{lng, lat}`.
- 오류는 항상 `error.code`, `error.message`, `error.requestId`.
- HTTP 상태와 도메인 오류 코드를 구분한다.
- 원본 Kakao/TAGO 상태·본문·URL·stack은 클라이언트에 보내지 않는다.

### 8.3 주요 오류 분류

| HTTP | 코드 예시 | 사용자 의미 |
|---:|---|---|
| 400 | `VALIDATION_ERROR`, `LOCATIONS_TOO_CLOSE` | 입력 수정 필요 |
| 404 | `PLACE_NOT_FOUND`, `NO_TRANSIT_ROUTE` | 장소/경로 없음 |
| 408/504 | `UPSTREAM_TIMEOUT` | 외부 조회 시간 초과 |
| 429 | `RATE_LIMITED`, `UPSTREAM_RATE_LIMIT` | 잠시 후 재시도 |
| 502 | `UPSTREAM_ERROR`, `TRANSIT_NOT_CONFIGURED` | 공급자 처리/설정 오류 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 서버 오류 |

### 8.4 보안 미들웨어 순서

1. request ID 부여
2. Pino 요청 로깅(민감 필드 제거)
3. Helmet
4. 명시적 CORS
5. JSON body 제한
6. 엔드포인트별 rate limit
7. Zod 검증
8. route handler
9. not found
10. 공통 오류 변환

---

## 9. 웹 구현 계획

상세 정보 구조와 상태 전이는 [`IA.md`](./IA.md)를 따른다.

### 9.1 주요 구성

- 앱 헤더와 demo badge
- 출발지/목적지 combobox, 교환, 현재 위치
- 운동 목표 바텀시트
- NAVER 지도 어댑터(Map/Polyline/Marker/fitBounds)
- live/mock에 따라 `NAVER 지도 + TAGO/DEMO 경로` 공급자 칩
- 지도 실패 폴백 패널
- 추천 진행 단계
- 1~3개 추천 카드
- 선택 경로 상세 단계와 범례
- 상태/오류/부분 성공 안내

### 9.2 상태 관리 경계

- TanStack Query: 서버 상태, 검색 취소, 추천 요청
- Zustand: 선택 장소, 폼 상태, 선택 경로, 바텀시트 단계
- localStorage: 버전형 사용자 선호와 마지막 선택 요약
- 컴포넌트 로컬 상태: 포커스, 펼침/접힘, 키보드 인덱스

### 9.3 지도 장애 원칙

- NAVER `ncpKeyId` 없음, 12초 timeout 또는 SDK 실패 시 빈 영역을 만들지 않는다.
- 지도 영역에 공급자를 명시한 오류 안내와 SVG 경로 미리보기를 표시한다.
- 추천 카드와 단계 목록은 지도와 독립적으로 작동한다.
- 선택 경로 상태는 지도 성공 여부와 무관하게 유지한다.
- Kakao/TAGO 경로 API 실패와 NAVER 지도 실패는 서로 다른 상태로 관리한다.
- `navermap_authFailure`와 script load/timeout을 감지하고 재시도를 제공한다.

### 9.4 NAVER 지도 렌더링 규칙

- 앱 최초 진입에도 기본 대전 중심의 NAVER 지도를 표시한다.
- 선택 경로는 불투명도와 z-index를 높이고 나머지는 비교용으로 흐리게 둔다.
- 버스/지하철/일반 도보/운동 도보를 색, 패턴, 굵기로 함께 구분한다.
- 출발·운동 시작·도착은 NAVER HTML Marker로 표시한다.
- 선택 경로의 버스 차량을 marker로 표시하고 visible 탭에서 10초마다 갱신한다.
- 모바일 NAVER 지도 DOM 높이를 바텀시트 위의 실제 가시 영역으로 제한한다.
- 선택 경로 좌표와 양 끝점을 `LatLngBounds`로 계산하고 상단 검색 패널을
  고려한 여백으로 `fitBounds`한다.
- 컴포넌트 갱신/언마운트 때 모든 overlay에 `setMap(null)`을 호출하고 Map을
  `destroy()`해 중복 DOM과 이벤트를 남기지 않는다.

---

## 10. 캐시와 영속성 계획

상세 스키마는 [`db_schema.md`](./db_schema.md)를 따른다.

### 10.1 MVP 영속성 원칙

- Node 24 SQLite에는 정류장·노선·route-stop만 저장
- 사용자 설정과 마지막 선택 요약만 localStorage
- 정확한 전체 경로 좌표는 localStorage에 저장하지 않음
- 공급자 원본 응답과 실시간 도착·차량은 파일/DB에 장기 저장하지 않음
- 서버 캐시는 프로세스 메모리의 짧은 TTL LRU만 사용

### 10.2 캐시 TTL

| 데이터 | TTL |
|---|---:|
| 장소 검색 | 1시간 |
| 정류장명 → 좌표 | 6시간 |
| 대중교통 | 1~2분 |
| 도보 | 30분 |
| 완성 추천 | 현재 미적용(도입 시 60초 설계) |
| TAGO 주변 정류장 | 5분 |
| TAGO 노선/경유 정류장 | 24시간 |
| TAGO 도착/차량 | 20초/10초 |

- 전체 상한: 128MB
- 좌표: 소수점 5자리
- 검색어: 공백/대소문자 정규화
- 경로: route mode 포함
- 시간 의존 키: 5분 버킷
- 동일 동시 요청: single-flight 공유

---

## 11. 5일 실행 일정

### Day 1 — 기반과 계약

**오전**

- 저장소/런타임 기준선 고정
- pnpm workspace와 strict TypeScript 구성
- `apps/web`, `apps/api`, `packages/contracts` 뼈대
- 환경변수와 실행 스크립트

**오후**

- Coordinate, Place, Route, API 스키마
- mock/live provider 인터페이스
- Express health, 보안 기본 미들웨어
- 웹 shell과 demo badge

**종료 게이트 D1**

- web/api 동시 실행
- health 응답에 `mode=mock`
- 공유 Zod 계약이 양쪽에서 typecheck
- 비밀 값이 저장소에 없음

### Day 2 — Provider와 기본 경로

**오전**

- 공식 Kakao 문서 기준 raw parser
- 장소/대중교통/도보 정규화
- timeout, retry, upstream 오류 분류

**오후**

- 익명 mock fixture 6종
- 장소 검색 API/UI
- baseline 계산
- 지도/텍스트에 기본 경로 표시

**종료 게이트 D2**

- provider 계약 테스트 통과
- KAIST → 대전역 mock 기본 경로 표시
- BUS/SUBWAY/WALK 및 빈 path/요금 없음 처리

### Day 3 — 후보 생성과 추천 엔진

**오전**

- 정류장명 해석과 신뢰도 점수
- 최대 4개 조기 하차 후보
- 연결 검증, 실제 POI 폴백
- p-limit 3, 9회 호출 예산

**오후**

- 걸음 계산, 시간 필터
- FAST/BALANCED/GOAL
- 경로 중복 제거와 다양성
- 부분 성공 warning

**종료 게이트 D3**

- deadline 위반 추천 0개
- 1~3개 서로 다른 추천
- 후보 일부 실패 시 부분 결과
- 핵심 순수 함수 단위 테스트 통과

### Day 4 — 제품 UI와 복원력

**오전**

- 목표 바텀시트와 고급 설정
- 단계별 로딩/오류/빈 상태
- 추천 카드, 선택, 상세

**오후**

- 경로별 지도 스타일과 bounds
- localStorage 저장/복구
- 위치 권한 거절/지도 실패
- 접근성/320~desktop 반응형

**종료 게이트 D4**

- 모바일 주요 흐름 수동 완주
- 목표 달성/촉박한 마감/2개 결과 상태 확인
- 키보드 검색과 지도 없는 경로 확인

### Day 5 — 검증과 배포 준비

**오전**

- API/프론트 통합 테스트
- Playwright mock E2E
- 성능/응답 크기/로그 민감정보 점검

**오후**

- production build
- 멀티스테이지 non-root Docker build
- SIGTERM/health 확인
- README와 5개 운영 문서
- 최종 인수 체크와 제한 기록

**종료 게이트 D5**

- `pnpm test`, `pnpm build` 성공
- Docker build 및 health 확인
- mock E2E 통과
- live 미검증 범위와 키 설정 위치 문서화

---

## 12. 세부 구현 단계와 완료 게이트

5일 일정 안에서 실제 작업은 아래 10단계로 추적한다.

### P0. 기준선과 도구

- 저장소 지침/변경/호스팅 파일 확인
- Node 24, pnpm 버전 확인
- `.gitignore`, `.env.example`

**증빙:** `git status`, 버전 출력, 비밀 패턴 검색

### P1. Workspace와 공유 계약

- workspace/package scripts
- strict TS
- 공개 Zod 모델

**증빙:** `pnpm typecheck`, 계약 단위 테스트

### P2. API 기반

- Express app/server 분리
- health, request ID, Pino, Helmet, CORS, limits
- 공통 오류 구조, graceful shutdown

**증빙:** Supertest health/error/rate limit

### P3. Provider 계층

- 개발 fixture, Kakao 장소·도보, TAGO transit 구현
- TAGO client, SQLite repository/migration, CSV importer
- REST timeout/retry/abort
- raw 응답 정규화 및 오류 분류

**증빙:** fixture 계약 테스트, raw 타입 웹 미노출 검사

### P4. 추천 코어

- 계산, 제약, 점수
- candidate generator
- deduplicator
- selection

**증빙:** 계산/필터/선정/중복 단위 테스트

### P5. API 완성

- places/recommendations
- 캐시/single-flight/p-limit
- 응답 warning과 관측 로그

**증빙:** 정상/검증/촉박/부분 실패 통합 테스트

### P6. 웹 검색과 목표 입력

- combobox/debounce/cancel
- 목표 폼/실시간 계산
- 위치/교환

**증빙:** Testing Library 폼/장소/권한 테스트

### P7. 결과와 지도

- 추천 카드/상세
- 지도 overlay와 선택 상태
- SDK 실패 폴백

**증빙:** 카드 선택/2개 결과/지도 실패 테스트

### P8. 저장/접근성/반응형

- versioned localStorage
- 키보드/label/focus/reduced motion
- 320/390/tablet/desktop

**증빙:** 저장 복구 테스트, axe 또는 수동 체크리스트, viewport 스크린샷

### P9. 운영 준비와 최종 검증

- Docker/Cloud Run 문서
- 전체 test/build/E2E
- 제한 및 live smoke 절차

**증빙:** 명령 결과, health 확인, 최종 체크리스트

---

## 13. 테스트 전략

### 13.1 테스트 피라미드

| 계층 | 도구 | 핵심 범위 |
|---|---|---|
| 순수 단위 | Vitest | 계산, 시간, 점수, 선택, 중복, geometry |
| Provider 계약 | Vitest + fixture | Kakao 장소·도보, TAGO raw/경로/CSV 정규화와 상태 분류 |
| API 통합 | Supertest | endpoint, validation, rate limit, 오류 |
| 웹 컴포넌트 | Vitest + Testing Library | 폼, 검색, 로딩, 카드, 저장, 폴백 |
| E2E | Playwright | KAIST → 대전역 전체 mock 흐름 |
| Live smoke | 조건부 | `LIVE_API_TEST=1`일 때 각 API 최소 1회 |

### 13.2 필수 시나리오 추적

| 시나리오 | 단위 | API | 웹 | E2E |
|---|:---:|:---:|:---:|:---:|
| 정상 3개 추천 | ✓ | ✓ | ✓ | ✓ |
| 목표 이미 달성 | ✓ | ✓ | ✓ |  |
| 마감시간 촉박 | ✓ | ✓ | ✓ |  |
| 후보 2개뿐 | ✓ | ✓ | ✓ |  |
| 일부 후보 실패 |  | ✓ | ✓ |  |
| 잘못된 좌표/보폭 | ✓ | ✓ | ✓ |  |
| 지도 SDK 실패 |  |  | ✓ | ✓ |
| localStorage 손상 | ✓ |  | ✓ |  |
| rate limit |  | ✓ |  |  |
| Kakao/TAGO status 비정상 |  | Provider ✓ |  |  |
| TAGO 직행·역방향·환승 제한 | ✓ | ✓ |  |  |
| NAVER auth 실패/재시도/cleanup |  |  | ✓ |  |

### 13.3 시간 테스트 안정성

- 서버 시각은 주입 가능한 clock으로 만든다.
- 테스트는 고정 `departureAt`을 사용한다.
- KST 표시는 `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })`로 검증한다.
- 테스트에서 실제 현재 시각과 네트워크에 의존하지 않는다.

---

## 14. 성능과 관측 계획

### 14.1 성능

- 검색 300ms 디바운스와 이전 요청 취소
- 추천 후보 외부 호출 동시성 3
- 단기 LRU + single-flight
- 지도 표시 좌표만 3~5m 허용 오차로 단순화
- JSON compression 가능한 서버 구성
- route response 2MB 방어 검사
- mock 추천 벤치마크로 p95 500ms 확인

### 14.2 구조화 로그 허용 목록

- request ID
- endpoint와 HTTP status
- provider mode
- 외부 API 종류와 지연시간
- 후보 수, 성공 후보 수, 추천 결과 수
- 캐시 hit/miss
- 오류 코드

### 14.3 로그 금지 목록

- Kakao REST API 키/Authorization
- 정확한 출발지/목적지 좌표
- 원시 현재 걸음 수
- 전체 요청/응답 본문
- stack trace의 클라이언트 노출

---

## 15. 보안과 개인정보 체크

- [x] `.env`와 키 파일 gitignore
- [x] REST 키는 API 환경변수에서만 읽음
- [x] NAVER Maps Client ID의 Web 서비스 URL 제한 문서화
- [x] NAVER Client Secret은 웹 변수/번들/로그에 넣지 않음
- [x] Helmet 기본 정책 적용
- [x] 운영 CORS는 정확한 `WEB_ORIGIN`
- [x] JSON body 크기 제한
- [x] places 60회/분, recommendations 10회/분
- [x] 로그 redaction
- [x] 오류 응답에 stack/raw upstream 없음
- [x] localStorage에는 정확한 경로 좌표 없음
- [x] 외부 분석 도구 없음
- [x] 유료 설정/배포 자동 실행 없음

---

## 16. 배포 준비 계획

### 16.1 API — Cloud Run

- 리전: `asia-northeast3`
- 1 vCPU, 1 GiB
- port 8080
- concurrency 8
- min instances: 개발 0, 발표 1
- max instances: 2
- timeout: 20초
- 영구 디스크/DB 없음
- SIGTERM 수신 후 신규 연결 종료 및 진행 요청 정리
- non-root 사용자로 실행

### 16.2 웹

- Vite 정적 산출물
- production은 `VITE_API_BASE_URL`을 생략해 same-origin `/api` 사용
- `VITE_NAVER_MAP_NCP_KEY_ID`는 Web Dynamic Map이 활성화되고
  `chimap.madcamp-kaist.org`가 Web 서비스 URL에 등록된 Client ID
- 정적 호스팅이 SPA fallback을 제공하도록 문서화

### 16.3 VPS 대안

- 2 vCPU, RAM 2GB, SSD 20GB
- HTTPS reverse proxy
- Node API 프로세스 1개
- 같은 서버에 PostgreSQL 설치 금지
- DB 필요 시 관리형 DB를 별도 도입

실제 배포, 비즈월렛, 유료 API 활성화는 사용자 승인과 자격증명 없이는 수행하지 않는다.

---

## 17. 위험 관리

| ID | 위험 | 가능성/영향 | 예방 | 발생 시 대응 |
|---|---|---|---|---|
| R-01 | live 응답 변형 | 중/높음 | 방어적 Zod parser, 선택 필드 | raw fixture 추가 후 정규화 계층만 수정 |
| R-02 | 정류장명 오매칭 | 높음/높음 | 이름+카테고리+경로선 거리 점수 | 낮은 신뢰도 폐기, 실제 POI 폴백 |
| R-03 | Kakao/TAGO 쿼터 소모 | 높음/높음 | 9회 후보 상한, service cache | 후보 수 축소, 사용량 경고 |
| R-04 | 추천 처리 지연 | 중/높음 | p-limit 3, timeout, partial success | 성공 후보만 반환, warning |
| R-05 | 경로 연결 불연속 | 중/높음 | 시작/끝 거리와 종점 검증 | 후보 폐기, baseline 유지 |
| R-06 | 중복 카드 | 중/중 | route signature + geometry | 결과 수를 줄이고 이유 표시 |
| R-07 | 지도 SDK/auth 장애 | 중/중 | auth callback, timeout, 독립 텍스트 UI | SVG 폴백과 재시도 |
| R-08 | localStorage 손상 | 중/낮음 | Zod safeParse/version | 잘못된 키만 제거하고 기본값 |
| R-09 | 5일 일정 과부하 | 높음/중 | 매일 종료 게이트 | 비범위 준수, 핵심 플로우 우선 |
| R-10 | Node 환경 불일치 | 중/중 | engines/packageManager 고정 | Node 24 설치 절차와 CI 명시 |
| R-11 | 마감시간 오해 | 중/높음 | “예상”, “지금 출발” 반복 | 보장 표현 제거, safety buffer |
| R-12 | 민감 정보 로그 | 낮음/높음 | allowlist logging/redaction | 로그 중단, 키 회전 지침 |
| R-13 | NAVER 허용 URL 불일치 | 중/높음 | localhost/운영 origin 사전 등록 | 콘솔 URL과 실제 origin 비교 |
| R-14 | TAGO 정류장선과 실제 NAVER 도로 형상 차이 | 중/중 | WGS84 검증, 추정 안내와 텍스트 기준 정보 | 경로선/leg fixture와 live smoke |
| R-15 | 교차 공급자 표시 정책 불확실 | 중/높음 | 출시 전 각 공급자 최신 약관·브랜드 지침 검토 | 확인 전 공개 live 전환 보류 |
| R-16 | SQLite instance 유실/분기 | 중/높음 | 명시적 volume/artifact, backup | 직전 DB와 이미지로 rollback |
| R-17 | TAGO 지역별 실시간 미제공 | 높음/중 | 정적 route fallback, 예상/partial 표시 | 가짜 실시간 없이 경로 유지 |

---

## 18. 공식 공급자 검증 체크포인트

구현 시작 시와 live smoke 직전에 공식 문서를 다시 확인한다.

- [카카오맵 이해하기](https://developers.kakao.com/docs/ko/kakaomap/common)
- [카카오맵 REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [쿼터](https://developers.kakao.com/docs/ko/getting-started/quota)
- [신규 API 및 무료 쿼터 공지](https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222)
- [공공데이터포털](https://www.data.go.kr/)
- [NAVER Maps Application 등록](https://guide.ncloud-docs.com/docs/maps-app)
- [NAVER Maps 인증키 가이드](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html)
- [NAVER Maps JavaScript API v3 시작하기](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)
- [NAVER Map 기본 동작](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Map.html)
- [NAVER Marker](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Marker.html)

2026-07-24 구현 기준:

- 버스: 국토교통부 TAGO 정류소·노선·도착·위치정보 OpenAPI
- 도보: `GET /v2/routing/walk`
- 장소: `GET /v2/local/search/keyword.json`
- Kakao 인증: `Authorization: KakaoAK ${KAKAO_REST_API_KEY}`
- TAGO 인증: 서버 공공데이터 일반 인증키, 서비스별 키 우선
- 지도: `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=...`
- 지도 인증: 브라우저 공개 Client ID만 사용하고 Client Secret은 사용하지 않음
- NAVER Web 서비스 URL: `http://localhost`, `http://madcamp-kaist.org`
- script 200과 `/v3/auth` 성공·실제 타일 표시를 각각 확인

정책, 쿼터, 요금은 변할 수 있으므로 운영 전 각 콘솔과 공식 문서에서 다시
확인하고 이 계획의 과거 수치를 비용 승인 근거로 사용하지 않는다.

---

## 19. 단계별 진행 보고 형식

각 단계 완료 시 아래 형식으로 짧게 보고한다.

```text
[P3 Provider 완료]
- 구현: Kakao 장소·도보 + TAGO transit + fixture, 정규화, retry/timeout
- 검증: provider 계약 테스트 N개 통과
- 남은 위험: 실제 키·지역 데이터 smoke 여부
- 다음: 추천 코어 구현
```

테스트 실패나 미검증 항목은 숨기지 않는다.

---

## 20. 최종 인수 체크리스트

### 제품

- [x] 키 없이 mock 실행 가능
- [x] “데모 데이터” 배지와 안내
- [x] KAIST → 대전역 전체 흐름
- [x] FAST/BALANCED/GOAL 1~3개
- [x] 예상 도착/추가시간/걸음/목표율/환승/요금
- [x] 목표 달성 불가와 부분 성공을 정직하게 표시
- [x] 목표 이미 달성한 사용자 처리

### 경로/알고리즘

- [x] Kakao 장소/도보와 TAGO 버스 정규화
- [x] baseline 가장 빠른 경로
- [x] 조기 하차 최대 4개
- [x] 실제 POI 폴백 최대 2개
- [x] deadline과 extra time 동시 필터
- [x] normalized balanced score
- [x] 중복 제거와 결과 수 축소

### UI

- [x] NAVER 지도 어댑터와 모바일 바텀시트
- [x] Kakao/TAGO 경로 좌표를 NAVER Polyline/Marker로 표시
- [x] 실제 모드에 맞는 `NAVER 지도 + TAGO/DEMO 경로` 공급자 표시
- [x] 카드 선택 시 지도 강조/bounds/상세
- [x] 지도 실패 텍스트 폴백
- [x] 모든 명시 상태 화면
- [x] 스킵/reduced-motion을 지원하는 경로선 랜딩 인트로
- [x] 320/390/tablet/desktop 반응형
- [x] 키보드/label/focus/reduced motion
- [x] versioned localStorage

### 서버/운영

- [x] 보안 미들웨어와 rate limit
- [x] 9회 호출 상한, 동시성 3
- [x] cache/single-flight
- [x] SQLite migration, CSV import, TAGO route sync 명령
- [x] request ID와 민감정보 없는 로그
- [x] graceful shutdown
- [x] Docker non-root
- [x] Cloud Run 문서
- [x] `chimap.madcamp-kaist.org` same-origin 배포 설정

### 검증

- [x] 단위 테스트
- [x] provider 계약 테스트
- [x] API 통합 테스트
- [x] 프론트 테스트
- [x] mock E2E
- [x] production build
- [x] Docker build/health
- [x] live 미검증 범위 명시

### 공개 live 승격 잔여 게이트

- [ ] NAVER `/v3/auth` 성공과 실제 지도 타일 확인
- [ ] Kakao 장소·도보 및 TAGO 네 서비스 health/smoke
- [ ] 영속 SQLite volume에 전국 정류장 import와 대표 route sync
- [ ] 최신 소스 image에서 `mode=live` health와 실제 추천 확인
- [ ] 선택 경로 차량 10초 polling과 background 중지 확인
- [ ] 기존 mock 컨테이너의 rollback 정보 보존 후 image 교체

---

## 21. 최종 보고서 형식

최종 보고는 다음 순서를 유지한다.

1. 완성된 결과
2. 바로 실행하는 방법
3. demo/live 및 저장소/공개 revision 차이
4. 루트 `.env`의 Kakao/TAGO 키와 NAVER Maps Client ID
5. 핵심 알고리즘
6. 테스트와 빌드 결과
7. 알려진 제한
8. 다음 우선순위
9. 주요 변경 파일

미완료 항목이 있으면 완료라고 표현하지 않고, 미완료 범위·이유·필요 정보·현재 폴백·다음 한 단계를 함께 기록한다.
