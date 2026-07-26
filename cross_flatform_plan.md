# CHIMap 최종 cross-platform 계획

기준일: 2026-07-26
대상: Web, iOS, Android, 공통 Backend
확정 모바일 기술: React Native + Expo Development Build
제외: Expo Go, WebView 기반 앱, iOS SwiftUI 선행 후 Android 재작성

## 1. 최종 결론

CHIMap은 다음 네 단위로 운영한다.

1. `apps/api`: 모든 frontend가 함께 쓰는 Node.js/PostgreSQL API
2. `apps/web`: 로그인 없이도 쓸 수 있는 React/Vite 웹
3. `apps/mobile`: iOS와 Android가 공유하는 React Native/Expo 앱
4. `packages/*`: API 계약, 순수 도메인 로직, 디자인 token

웹·iOS·Android는 각각 독립적으로 배포하고 롤백한다. 다만 iOS와 Android는
하나의 모바일 코드베이스를 사용한다. 웹 DOM component를 모바일에서
재사용하지 않고, API 계약·검증·계산·오류 mapping만 공유한다.

로그인 정책은 다음과 같이 확정한다.

| Client | 카카오 로그인 | 비로그인 사용 |
| --- | --- | --- |
| Web | 선택 | 장소 검색·추천·지도 등 모든 핵심 기능 허용 |
| iOS | 필수 | 최초 로그인 전 핵심 기능 진입 불가 |
| Android | 필수 | 최초 로그인 전 핵심 기능 진입 불가 |

모바일 개발은 실제 테스트 폰과 Xcode/Android Studio를 사용한다. 네이티브
NAVER 지도, Kakao SDK, HealthKit/Health Connect가 필요하므로 Expo Go는
어떤 단계에서도 사용하지 않는다.

## 2. 현재 상태

### 2.1 이미 존재하는 기반

- React/Vite 웹과 반응형 지도·하단 panel
- Express `/api/v1`
- PostgreSQL/PostGIS 교통 데이터
- Kakao 장소·도보, NAVER 지도·주소, TAGO 버스
- `packages/contracts` Zod 요청·응답 계약
- 계정 없이 브라우저에만 저장하는 개인화 걸음 profile
- 동의 기반 익명 UI event
- Docker Compose, Cloudflare Tunnel, Prometheus, Alertmanager

### 2.2 이번 단계에 구현한 카카오 웹 로그인

코드 구현 완료 항목:

- `GET /api/v1/auth/session`
- `GET /api/v1/auth/kakao/start`
- `GET /api/v1/auth/kakao/callback`
- `POST /api/v1/auth/logout`
- 고유 OAuth `state`와 HMAC 서명, 10분 만료 HttpOnly cookie
- 서버의 인가 코드→카카오 token 교환
- 카카오 사용자 정보 조회와 CHIMap 사용자 upsert
- 256-bit CHIMap session 발급
- session 원문 대신 SHA-256 hash 저장
- `app_users`, `oauth_accounts`, `auth_sessions` migration 3
- 웹 header의 선택형 로그인·사용자 표시·로그아웃
- 로그인 취소 후 비회원 이용 안내
- 공통 auth Zod 계약

보안 경계:

- 카카오 access/refresh token을 DB, cookie, log에 저장하지 않는다.
- email, 전화번호, 성별, 생일을 카카오 로그인에서 요청하지 않는다.
- 선택 동의 가능한 nickname/profile image와 카카오 회원번호만 사용한다.
- 카카오 회원번호는 JavaScript 안전 정수보다 클 수 있어 문자열로 저장한다.
- 운영 session cookie는 `HttpOnly`, `Secure`, `SameSite=Lax`다.
- Kakao/내부 오류 원문과 token은 browser에 노출하지 않는다.

2026-07-26 운영 완료 항목:

- Web Redirect URI, Client Secret, CHIMap session secret 설정
- migration 3 적용과 배포 전·후 backup/restore
- 운영 이미지 배포와 health/readiness
- 익명 session, 로그인 시작, 보안 state cookie, Kakao authorize 공개 smoke
- 비회원 실제 추천·지도 E2E와 1440/768/390/320px 레이아웃

남은 확인 항목:

1. Kakao Developers의 profile nickname/image 동의항목 최종 검토
2. 실제 카카오 계정으로 동의→callback→사용자 표시→logout E2E
3. auth 성공률·provider 실패 monitoring 보강

카카오 공식 REST 흐름은 서버가 인가 코드를 token으로 교환하고 사용자 정보를
조회한 뒤 서비스 자체 session을 만들어야 한다. `state`는 CSRF 방지를 위해
요청별로 고유해야 한다. 구현은 이 계약을 따른다.
[Kakao Login REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api)

## 3. 목표 architecture

```text
Browser                         iOS / Android
apps/web                       apps/mobile
React + Vite                   React Native + Expo Dev Build
optional Kakao Login           required Kakao Login
NAVER Web Map                  NAVER Native Map SDK
localStorage                   SecureStore + local storage
    │                               │
    ├────── packages/contracts ─────┤
    ├────── packages/app-core ──────┤
    └────── packages/design-tokens ─┘
                    │
              HTTPS /api/v1
                    │
              apps/api
       Kakao/NAVER/TAGO provider
                    │
           PostgreSQL + PostGIS
```

Expo는 pnpm workspace monorepo를 공식 지원하며, Development Build는 로컬
Xcode/Android Studio에서 네이티브 library를 포함해 빌드할 수 있다.
[Expo monorepo](https://docs.expo.dev/guides/monorepos/),
[Expo Development Build](https://docs.expo.dev/develop/development-builds/introduction/)

## 4. 저장소 목표 구조

```text
apps/
  api/
    src/auth/                 Kakao, session, mobile token exchange
  web/
  mobile/
    src/app/                  Expo Router screen
    src/features/auth/
    src/features/places/
    src/features/profile/
    src/features/routes/
    src/features/settings/
    src/platform/kakao/
    src/platform/maps/
    src/platform/steps/
    src/platform/location/
    src/platform/storage/
    modules/                  필요한 Swift/Kotlin Expo Module

packages/
  contracts/                 API Zod schema와 TypeScript type
  app-core/                  API client, selector, formatter, error mapping
  design-tokens/             의미 기반 색·간격·typography token
```

공유하는 것:

- 요청·응답 schema와 type
- 보폭 계산과 추천 선택 규칙
- 날짜·시간·거리·걸음 formatter
- API 오류를 사용자 문구로 변환하는 mapping
- captured provider fixture
- 의미 기반 design token

공유하지 않는 것:

- React DOM component와 CSS
- NAVER Web Map wrapper
- 웹 OAuth cookie 처리 UI
- native map view
- HealthKit/Health Connect
- browser/mobile storage implementation
- 각 store의 release pipeline

## 5. 인증 architecture

### 5.1 Web: 선택 로그인

```text
로그인 없이 진입
  → 검색·추천 전체 이용
  → 원할 때 "카카오 로그인"
  → GET /auth/kakao/start
  → Kakao authorize
  → GET /auth/kakao/callback
  → CHIMap HttpOnly session cookie
  → 기존 화면으로 복귀
```

웹 로그인 여부는 추천 API의 필수 조건으로 만들지 않는다. 로그인 API가
장애여도 익명 검색·추천은 계속 동작해야 한다. 로그인한 사용자에게 제공할
첫 편의 기능은 즐겨찾기와 기기 간 비민감 설정 동기화다.

### 5.2 Mobile: 필수 로그인

모바일에서는 Kakao SDK for iOS/Android를 native module로 연결한다. React
Native community wrapper를 바로 신뢰하지 않고 1주 기술 spike에서 최신 Expo
SDK/New Architecture 호환성과 실제 폰 복귀 흐름을 검증한다. 문제가 있으면
Swift/Kotlin의 작은 local Expo Module로 감싼다.

```text
앱 시작
  → SecureStore의 CHIMap refresh token 확인
  → 없거나 만료: 카카오톡 로그인 우선
  → 카카오톡 미설치/실패: 카카오계정 로그인 fallback
  → Kakao access token 획득
  → POST /api/v1/auth/kakao/mobile
  → backend가 Kakao token 정보와 사용자 정보 검증
  → CHIMap access/refresh token 발급
  → refresh token은 SecureStore에 저장
  → 앱 main route 진입
```

카카오 iOS SDK는 카카오톡 로그인과 계정 로그인 흐름을 제공한다.
[Kakao Login iOS](https://developers.kakao.com/docs/ko/kakaologin/ios)

### 5.3 Mobile backend token 계약

모바일 구현 전에 다음 API를 추가한다.

```http
POST /api/v1/auth/kakao/mobile
POST /api/v1/auth/token/refresh
POST /api/v1/auth/mobile/logout
GET  /api/v1/auth/me
```

`POST /auth/kakao/mobile`은 Kakao access token을 그대로 신뢰하지 않는다.

1. Kakao `access_token_info` 조회
2. token의 `app_id`가 CHIMap Kakao app ID와 같은지 확인
3. 만료 여부 확인
4. Kakao `/v2/user/me` 조회
5. 기존 `oauth_accounts`와 같은 CHIMap user로 upsert
6. 카카오 token 폐기
7. CHIMap token pair 발급

권장 CHIMap mobile session:

- access token: opaque random token, 15분, DB에는 hash만 저장
- refresh token: opaque random token, 30일, DB에는 hash만 저장
- refresh 시 rotation하고 이전 refresh token 즉시 폐기
- 재사용 감지 시 해당 mobile session family 전체 폐기
- token은 log와 analytics에 절대 포함하지 않음
- mobile access token은 `Authorization: Bearer`로 전달
- web cookie session과 mobile bearer session은 같은 `app_users`를 참조

JWT는 초기에는 사용하지 않는다. 현재 단일 backend에서는 opaque token이 즉시
폐기와 session 관리가 단순하다. API를 수평 확장할 때 Redis 또는 공유 DB
lookup 비용을 측정한 뒤 변경한다.

### 5.4 계정과 health data의 경계

로그인했다고 다음 값을 자동으로 server account에 동기화하지 않는다.

- HealthKit/Health Connect raw sample
- 나이·키·몸무게·생물학적 성별
- 정확한 GPS history
- 검색어 history
- 실시간 이동 history

추천 요청에는 현재와 같이 현재 걸음, 목표, 파생된 한 걸음 길이를 계산 동안
일시 전송하지만 PostgreSQL과 application log에 저장하지 않는다. 계정 기반
동기화 대상은 사용자가 명시적으로 선택한 즐겨찾기·일반 설정부터 시작한다.

## 6. 모바일 기술 선택

확정:

- React Native
- Expo framework
- Expo Development Build
- Expo Router
- TypeScript strict mode
- TanStack Query
- Zustand
- Zod `@chimap/contracts`
- SecureStore
- NAVER Native Map SDK
- iOS HealthKit
- Android Health Connect

원칙:

- Expo Go를 설치·사용하지 않는다.
- stable Expo SDK와 호환 React Native version을 함께 pin한다.
- `ios/`, `android/`를 CNG로 재생성한다면 모든 native 설정을 config plugin이나
  local Expo Module source로 관리한다.
- Xcode에서 수동으로 바꾼 capability/plist 설정만 남기지 않는다.
- native dependency 변경 시 Development Build를 다시 만든다.
- 일반 TypeScript/UI 변경은 Metro Fast Refresh로 확인한다.

Mac 개발 명령의 목표 형태:

```bash
pnpm --filter @chimap/mobile ios --device
pnpm --filter @chimap/mobile start --dev-client
pnpm --filter @chimap/mobile test
```

Android 단계에서는 같은 MacBook에 Android Studio, SDK, emulator를 추가하고
실제 Android 테스트 폰을 함께 사용한다.

## 7. 기능과 UX 범위

### 7.1 기능 parity

| 기존 Web 기능 | iOS MVP | Android |
| --- | --- | --- |
| 개인화 profile | native onboarding | 공통 UI+Android 조정 |
| 현재 걸음 수동 입력 | 유지 | 유지 |
| 장소 자동완성 | 유지 | 유지 |
| 현재 위치 | When In Use | While In Use |
| 빠른/균형/목표 추천 | 동일 계약 | 동일 계약 |
| NAVER 지도 경로 | native overlay | native overlay |
| 차량 위치 | 전면 선택 경로만 polling | 동일 |
| 상세 이동 단계 | full-screen sheet | full-screen sheet |
| 화면 설정 | native settings | native settings |
| 익명 telemetry | opt-in | opt-in |
| 카카오 로그인 | 필수 | 필수 |

### 7.2 최초 실행 UX

1. 긴 animation 대신 짧은 native splash
2. 앱 가치 한 화면 설명
3. 카카오 로그인
4. 최소 profile과 하루 목표 설정
5. `Apple 건강에서 오늘 걸음 자동 불러오기` 선택
6. home 진입

로그인과 health 권한을 한 화면에서 연속으로 강요하지 않는다. 카카오 로그인
완료 뒤 앱의 효용을 다시 설명하고 사용자가 자동 걸음을 선택했을 때만
HealthKit 권한을 요청한다.

### 7.3 재방문 UX

목표는 세 번 이내의 action으로 추천을 받는 것이다.

```text
오늘 5,240 / 8,000걸음
Apple 건강에서 2분 전 갱신

출발지 [현재 위치]
목적지 [최근 장소 / 즐겨찾기]

[건강 경로 찾기]
```

- session을 조용히 refresh하되 실패하면 입력을 잃지 않고 로그인 화면으로 이동
- 오늘 걸음은 앱 foreground 복귀와 KST 날짜 변경 때 갱신
- 위치 권한은 현재 위치 button을 눌렀을 때만 요청
- 권한이 없으면 직접 검색·수동 걸음 입력 제공
- 마지막 출발·도착과 즐겨찾기 제공
- 오래된 결과에는 생성 시각과 실시간 아님 표시

### 7.4 결과 UX

- 지도 위 bottom sheet
- 빠른·균형·목표 세 route를 한 번에 비교
- route 선택은 지도만 바꾸고 상세를 자동으로 열지 않음
- 상세는 별도 full-screen sheet
- 8초 초과 시 공급자 지연과 장소 변경/취소 제공
- map 장애여도 카드와 text 단계 사용 가능
- 선택 route의 차량만, bus leg당 최대 한 대
- foreground에서만 10~15초 polling
- background 진입 즉시 polling 중단

첫 store version에 turn-by-turn navigation, background 위치 추적, 하차 push를
넣지 않는다. 현재 API에는 음성 maneuver, route 이탈 재탐색, background
navigation 계약이 없기 때문이다. 사용자 검증 뒤 별도 phase로 설계한다.

## 8. 걸음 data와 권한

### iOS

- HealthKit `stepCount` read만 우선 요청
- raw sample 합산 대신 cumulative statistics query 사용
- iPhone/Apple Watch 중복을 HealthKit aggregation에 맡김
- 권한 요청 전 사용 목적과 server 일시 전송 범위를 설명
- 거부/데이터 없음 상태에서 수동 입력 유지
- background HealthKit read는 MVP 범위에서 제외

HealthKit은 read 권한 거부를 앱에 직접 노출하지 않으므로 “권한을 거부했다”고
단정하지 않고 “걸음 데이터를 불러오지 못했다”고 안내한다.
[HealthKit authorization](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)

### Android

- Google Fit 신규 연동 금지
- Health Connect `READ_STEPS`
- 누적 걸음은 aggregate API 사용
- Android 13 이하 Health Connect 설치 여부 fallback
- 지원되지 않는 기기/업무 profile에서 수동 입력 유지

[Health Connect read](https://developer.android.com/health-and-fitness/health-connect/read-data),
[Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)

## 9. NAVER 지도

iOS와 Android는 공식 NAVER Native Map SDK를 사용한다. web용 key를 재사용하지
않고 iOS bundle ID와 Android package name으로 제한된 key를 각각 발급한다.
서버가 반환한 WGS84 coordinate와 polyline만 native overlay로 표시한다.

- 도보: 주황 실선
- bus: 파랑
- subway: 보라
- 출발/탑승/환승/하차/도착 marker 구분
- 선택 route 강조, 비선택 route 희미하게 표시
- NAVER logo와 법적 고지 가리지 않음
- map render 실패와 추천 API 실패를 별도로 안내

[NAVER iOS SDK](https://navermaps.github.io/ios-map-sdk/guide-en/0.html),
[NAVER Android SDK](https://navermaps.github.io/android-map-sdk/guide-en/)

## 10. Backend 선행 보강

모바일 공개 전에 다음을 완료한다.

### API compatibility

- `/api/v1`의 기존 field를 삭제하거나 type 변경하지 않음
- additive 변경을 우선하고 파괴적 변경은 `/api/v2`
- `X-Client-Platform`, `X-App-Version`, `X-Contract-Version`
- `GET /api/v1/mobile-config`
  - minimum supported version
  - maintenance state
  - 지원 지역
  - privacy policy version
  - 차량 polling interval
- 오래된 app version과 contract regression test

### traffic과 rate limit

현재 IP당 장소 60회/분, 추천 10회/분은 통신사 NAT에서 여러 사용자가 공유할 수
있다. 모바일 출시 전 다음을 시험한다.

- IP abuse ceiling 유지
- 인증된 CHIMap user/session 단위의 정상 사용 quota 분리
- session/user ID는 application log에 직접 남기지 않음
- vehicle endpoint rate limit과 shared cache
- 지원 지역 route 사전 sync
- 예상 동시 사용자 부하 test
- 단일 Node 한계를 넘을 때 Redis cache/single-flight/rate limit 먼저 도입

### environment

같은 물리 server에서도 다음 host를 분리한다.

- development: mock/local
- staging: 별도 API container와 별도 DB/schema
- production: 공개 사용자

실제 폰 개발 build를 production provider에 직접 연결하지 않는다.

## 11. 실행 phase와 일정

한 명의 full-time 개발자를 기준으로 한 예상이며, Kakao/NAVER 심사와 외부
승인 대기 시간은 별도다.

### Phase 0 — Web/backend Kakao Login: 1~2주

코드, migration, backup/restore, 운영 배포, 공개 로그인 시작 smoke와 비회원
회귀는 완료했다. 남은 작업:

- 실제 계정 login/callback/logout E2E
- profile nickname/image 동의항목 최종 검토
- auth 성공률·provider 실패 monitoring

Gate:

- 비로그인 web의 기존 E2E가 그대로 통과
- 실제 카카오 계정으로 신규/재로그인 성공
- session cookie에 HttpOnly/Secure/SameSite 확인
- DB에 Kakao token 원문 0건
- logout 즉시 session 무효화

### Phase 1 — Mobile risk spike: 1주

한 screen test app에서 다음만 검증한다.

- Expo Development Build를 실제 iPhone에 설치
- KakaoTalk→앱 복귀와 fallback login
- Kakao mobile token backend 검증
- NAVER native map polyline/marker
- HealthKit 오늘 걸음 aggregate
- staging recommendation Zod parse
- Xcode Archive

어느 하나라도 실패하면 전체 UI 전에 wrapper 교체 또는 local Expo Module을
결정한다.

### Phase 2 — Mobile foundation/backend token: 1~2주

- `apps/mobile`
- Expo Router auth gate
- `packages/app-core`
- mobile auth/refresh/logout API
- SecureStore
- dev/staging/prod config
- API version header
- mobile config endpoint
- CI typecheck/unit/build

Gate: 실제 iPhone에서 로그인→session 복구→logout→재로그인이 되고 web session과
같은 `app_users` identity를 사용한다.

### Phase 3 — iOS feature parity: 3주

- onboarding/profile
- HealthKit와 수동 걸음
- 장소 검색/current location
- 추천 loading/error/result
- native NAVER map
- route detail
- 설정/data 삭제/telemetry consent
- app foreground와 KST day rollover

### Phase 4 — iOS usability/hardening: 2주

- 최근 장소/즐겨찾기
- bottom sheet/keyboard/one-hand UX
- offline/slow network recovery
- Dynamic Type/VoiceOver/Reduce Motion
- memory/battery/map performance
- foreground vehicle polling
- support request ID 화면

### Phase 5 — TestFlight/App Store: 2주

- internal TestFlight
- KAIST/대전 external beta
- privacy policy와 App Privacy
- HealthKit purpose text
- review notes
- staged release/rollback

### Phase 6 — Android: 3~5주

- Android Development Build
- Kakao Android SDK adapter
- NAVER Android Map
- Health Connect
- back gesture/keyboard/device layout
- low-end performance
- Play health declaration/Data Safety
- internal→closed→staged release

## 12. Test 전략

### 자동 test

- contracts schema
- auth state/tamper/expiry
- Kakao token exchange parsing
- session hash/create/revoke
- web anonymous/login/logout UI
- mobile token rotation/reuse detection
- API response Zod validation
- state store와 KST rollover
- route default selection
- native adapter input conversion
- iOS/Android E2E
- old app contract regression

### 실제 device matrix

- 카카오톡 설치/미설치
- 카카오 login cancel/retry/network failure
- refresh token 만료/reuse/logout
- HealthKit data 있음/없음/권한 변경
- Apple Watch+iPhone 걸음
- 위치 Allow Once/When In Use/deny/revoke
- Wi-Fi↔cellular
- request 중 background
- 8초 이상 recommendation
- NAVER SDK 인증 실패
- 실시간 vehicle 없음
- 지원하지 않는 지역
- small/standard/large iPhone
- Dynamic Type 200%, VoiceOver, Reduce Motion
- Android 9~최신 지원 범위와 Health Connect 설치 상태

### release gate

- web anonymous E2E 회귀 없음
- web 실제 Kakao login E2E
- mobile Kakao login 없이는 main API 진입 불가
- 로그인 성공 후 첫 useful screen까지 불필요한 추가 consent 없음
- 권한 거부 시 위치/걸음 수동 fallback
- 검색어·GPS·health raw data가 DB/log에 없음
- crash-free session 목표 99.5% 이상
- 지원 지역 recommendation 성공률/8초 초과율 관측
- server rollback 뒤 직전 app version 정상 동작

## 13. Privacy와 store 준비

privacy policy에는 다음을 구분해 적는다.

- 카카오에서 받는 정보
- CHIMap DB에 저장하는 정보
- 추천 계산 중 일시 처리하는 정보
- 저장하지 않는 health/location/search 정보
- session 보존 기간
- logout과 계정 삭제의 차이
- 동의 철회와 데이터 삭제 방법
- 외부 provider와 역할

모바일은 계정이 필수이므로 App Store/Play 제출 전에 앱 안에서 계정 삭제를
시작할 수 있는 기능을 제공한다. 계정 삭제는 다음을 원자적으로 처리한다.

1. 모든 CHIMap web/mobile session 폐기
2. server 즐겨찾기·설정 삭제
3. `oauth_accounts`와 `app_users` 삭제
4. Kakao 연결 해제가 정책상 필요한지 별도 확인하고 사용자에게 구분 설명
5. 기기의 SecureStore/local data 삭제

## 14. 운영과 관측

추가 metric은 low-cardinality enum만 사용한다.

- auth start/success/cancel/failure
- platform: web/ios/android
- app version의 major/minor
- token refresh success/failure/reuse
- Kakao provider latency bucket
- authenticated/anonymous recommendation outcome 집계

다음을 metric/log label로 사용하지 않는다.

- Kakao user ID
- CHIMap user ID
- session/token/hash
- nickname/profile URL
- 검색어/coordinate/place ID
- health/profile 값

모바일 출시 전 외부 alert webhook을 실제 운영 channel에 연결하고 auth failure,
recommendation failure, provider latency, DB pool, backup/restore에 alert를 둔다.

## 15. 주요 risk와 대응

| Risk | 대응 |
| --- | --- |
| Kakao/NAVER community RN wrapper 중단 | platform adapter 격리, version pin, 1주 spike, local Expo Module fallback |
| Web login 장애가 익명 이용까지 차단 | auth API 분리, web 핵심 API 비인증 유지 |
| Mobile store update가 API보다 느림 | additive v1, minimum version config, old client regression |
| 통신사 NAT rate limit | IP ceiling+인증 session quota, shared cache, load test |
| Kakao token 탈취 | HTTPS, token 비로그, server 재검증, 짧은 CHIMap access token, refresh rotation |
| 건강정보 과수집 | 걸음 read만 우선, raw sample 미전송, 수동 fallback |
| 전국 서비스로 오해 | launch 지원 지역 명시, route 사전 sync |
| 단일 server 장애 | staging, alert, backup/restore, mobile maintenance config |
| 지도/차량 stale | 생성 시각 표시, foreground polling, background 중단 |
| web/mobile UX drift | shared contract/core/fixture, platform별 acceptance test |

## 16. 하지 않을 것

- Expo Go
- web을 WebView로 감싼 store app
- iOS 전체를 SwiftUI로 만든 뒤 Android 재작성
- Kakao token을 CHIMap session으로 직접 사용
- email/전화번호를 로그인 기본 동의로 요청
- health raw sample server 저장
- background location을 MVP에서 요청
- 첫 version의 turn-by-turn navigation
- production API를 일상 개발 backend로 사용
- old `/api/v1` field를 즉시 삭제

## 17. 바로 실행할 순서

1. Kakao Developers web 설정과 staging redirect 등록
2. 운영 secret을 노출하지 않고 staging `.env` 구성
3. migration 3 backup/restore 검증
4. staging 실제 web login/cancel/logout E2E
5. auth monitoring 추가
6. web/backend 운영 배포
7. iPhone용 Expo Development Build 기술 spike
8. mobile auth endpoint와 SecureStore token rotation
9. iOS feature parity
10. TestFlight
11. Android adapter와 Play release

이 순서를 바꾸지 않는다. 특히 실제 Kakao/NAVER/HealthKit spike가 통과하기 전에
전체 모바일 화면을 구현하지 않는다.

## 18. 최종 Definition of Done

전체 cross-platform 목표는 다음이 모두 증명됐을 때 완료다.

- Web: 익명 전체 기능과 선택형 Kakao login이 공개 환경에서 동작
- Backend: web cookie와 mobile bearer가 같은 user identity를 사용
- iOS: Kakao 필수 login, HealthKit, NAVER map, 전체 추천 흐름 공개
- Android: Kakao 필수 login, Health Connect, NAVER map, 전체 추천 흐름 공개
- 세 frontend가 같은 versioned API contract를 사용
- 각 frontend를 독립 build/deploy/rollback 가능
- raw health/search/GPS data 비저장 경계 검증
- store privacy/account deletion 요구 충족
- 실제 device E2E와 server compatibility gate 통과

별도 native macOS 앱이 필요해지면 iOS release 뒤 별도 phase로 검토한다. 초기
Mac 사용자는 현재 반응형 web을 사용한다. React Native/Expo macOS 지원과
NAVER SDK compatibility를 iOS/Android 일정에 섞지 않는다.
