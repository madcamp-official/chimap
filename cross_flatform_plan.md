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
| iOS | 선택(Kakao/Apple) | 장소·추천·지도 핵심 기능 허용 |
| Android | 선택(Kakao) | 장소·추천·지도 핵심 기능 허용 |

모바일 개발은 실제 테스트 폰과 Xcode/Android Studio를 사용한다. 네이티브
NAVER 지도, Kakao SDK, HealthKit/Health Connect가 필요하므로 Expo Go는
어떤 단계에서도 사용하지 않는다.

### 1.1 2026-07-26 구현 기준선

이 문서의 foundation 항목은 현재 작업 트리에 다음과 같이 반영했다.

- `apps/mobile`: Expo Router, guest-first 선택형 Kakao/Apple 로그인, SecureStore, CNG config
- `packages/app-core`, `packages/design-tokens`: platform-neutral 공유 경계
- Zustand RouteStore와 추천 Query AsyncStorage persistence
- AppState foreground 5분 stale refetch와 route type 기반 선택 복구
- iOS/Android별 NAVER Native Map Client ID와 application identity
- Health Connect 빈 records의 정상 `0` fallback
- migration 4~6과 모바일 token family, Apple provider/refresh credential
- refresh rotation 120초 grace와 동일 token pair 재생
- Web/API와 Mobile을 분리한 CI job, workspace import boundary 검사
- 현재 위치·장소 검색·걸음 입력·추천·NAVER 지도·상세 sheet의 iOS-first 세로 단면
- Apple authorization code server exchange, 암호화 refresh 보관, 계정 삭제 grant revoke
- mobile config/최소 버전/maintenance 계약과 앱 내 계정 삭제

아직 완료로 간주하지 않는 항목은 실제 iPhone/Android Development Build 설치,
NAVER 지도 실기기 렌더링, Kakao 앱 복귀, HealthKit/Health Connect 실제 자료,
스토어 배포 E2E다. 코드 foundation 완료와 device release gate 통과를 구분한다.

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
optional Kakao Login           guest + optional Kakao/Apple
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

### 4.1 디렉터리 ownership과 충돌 방지

| 변경 종류 | 허용 위치 | 금지 경계 |
| --- | --- | --- |
| Backend/DB | `apps/api` | frontend 내부 import |
| Web UI/브라우저 저장소 | `apps/web` | mobile component/native module import |
| iOS·Android 공용 UI/state | `apps/mobile/src/features` | Web DOM/CSS import |
| OS SDK | `apps/mobile/src/platform` | `packages/*` 또는 Web에서 import |
| API schema | `packages/contracts` | platform API와 UI 포함 |
| 순수 계산/선택 정책 | `packages/app-core` | React DOM/RN/native API 포함 |
| 의미 기반 token | `packages/design-tokens` | platform component 포함 |

`ios/`, `android/`, `.expo/`, `.eas/`, native build 결과는 CNG 산출물이므로 Git에
넣지 않는다. plist, manifest, entitlement, Maven repository 변경은
`app.config.ts`나 config plugin에만 둔다. 루트 `pnpm boundaries:check`는 앱끼리의
상대경로 및 workspace package import, platform suffix의 위치를 검사한다.

모바일 로컬 자료는 다음 namespace를 사용한다.

```text
chimap:{development|staging|production}:{ios|android}:{sha256(userId)}:{domain}:v1
```

따라서 같은 테스트 폰의 dev/staging/prod, iOS/Android, 서로 다른 계정의
RouteStore와 Query cache가 충돌하지 않는다. Web localStorage는 별도 구현이며
이 namespace나 AsyncStorage를 공유하지 않는다.

### 4.2 Git branch와 worktree 규칙

현재 Git 기준선은 다음과 같다.

- `main` (`321ef96`): 초기 커밋에 머물러 있어 현재 애플리케이션의 통합 기준선으로
  바로 사용할 수 없음
- `feat/tago-transit` (`b9f7063`): Web/API/교통 기능이 들어 있는 현재 실질 기준선
- `feat/mobile/cross-platform-foundation`: `feat/tago-transit`에서 분기해 이 문서의
  foundation 변경을 격리한 현재 작업 branch

따라서 현재 foundation branch는 `feat/tago-transit`에 명시적으로 의존한다.
병합할 때는 `feat/tago-transit → main`을 먼저 완료하고, 그 다음 foundation을
갱신된 `main`에 rebase한 뒤 PR을 만든다. 두 branch를 동시에 `main`으로 열어
같은 기존 커밋을 중복 포함시키지 않는다. foundation 변경은 이 branch 안에서
구현·CI·문서 commit으로 분리해 검토와 되돌리기 단위를 명확히 유지한다.

Web/iOS/Android 장기 branch를 세 개 유지하지 않는다. 장기 platform branch는
공통 계약 수정이 세 갈래로 복제되고 merge 순서에 따라 drift가 생기기 때문이다.
`main`은 항상 통합 가능한 trunk로 두고 아래 short-lived branch만 사용한다.

- `feat/web/<scope>`: `apps/web` 중심
- `feat/mobile/<scope>`: iOS·Android 공용 `apps/mobile/src/features` 중심
- `feat/ios/<scope>`: iOS adapter/config만
- `feat/android/<scope>`: Android adapter/config만
- `feat/api/<scope>`: API와 additive migration
- `feat/contracts/<scope>`: schema/app-core/design token 선행 변경

이번 foundation처럼 iOS와 Android가 같은 React Native UI/state를 함께 바꾸는
작업은 `feat/mobile/*` 하나에서 진행한다. `feat/ios/*`, `feat/android/*`는 공용
feature가 합쳐진 뒤 HealthKit/Health Connect, native SDK config, OS별 동작처럼
`apps/mobile/src/platform`의 서로 다른 파일을 수정할 때만 만든다.

동시에 작업할 때는 같은 checkout에서 branch를 바꾸지 않고
`../chimap-web`, `../chimap-mobile`, `../chimap-api` 같은 별도 Git worktree를 쓴다.
worktree마다 의존성 디렉터리와 `.env`를 별도로 유지한다. 공통 계약 변경은
`contracts → api → web/mobile` 순서의 작은 PR로 먼저 merge하고, iOS/Android
adapter는 공용 mobile feature가 merge된 뒤 각각 rebase한다.

iOS-first 이후 실제 branch 운용 순서는 다음과 같다.

1. 현재 `feat/mobile/cross-platform-foundation`을 실질 기준선 위에서 검증한다.
2. `feat/tago-transit`을 `main`에 먼저 병합하고 foundation을 갱신된 `main`에 rebase한다.
3. foundation 병합 뒤 `feat/ios/native-spike`를 새 worktree에서 만들고 iOS adapter,
   entitlement, provider console 및 archive 관련 변경만 둔다.
4. iOS에서 발견한 공용 UI/state/API 문제는 `feat/mobile/ios-hardening`으로 옮겨 먼저
   병합한다. iOS branch에서 Android 공용 코드를 장기간 소유하지 않는다.
5. `feat/android/native-spike`는 위 공용 수정이 들어간 최신 `main`에서 분기한다.
   따라서 Android가 이미 해결된 공용 문제를 다시 구현하거나 오래된 계약을 들고
   출발하지 않는다.

즉 iOS와 Android release 작업은 별도 short-lived branch와 CI gate로 격리하지만,
동일 feature/state를 복제하는 영구 platform branch는 만들지 않는다.

PR 하나가 여러 ownership 영역을 건드리면 계약/API의 additive 변경과 각 client
사용 변경을 commit 단위로 분리한다. Git branch 이름은 deployment 환경이
아니며 production/staging 선택은 EAS profile과 `APP_ENV`, bundle/package ID로만
결정한다.

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

### 5.2 Mobile: guest-first 선택 로그인

모바일 핵심 경로는 로그인 없이 사용할 수 있다. 이는 인증 공급자 장애가 추천
기능을 막지 않게 하고 iOS에서 계정이 반드시 필요하지 않은 기능에 로그인을
강제하지 않기 위한 경계다. Kakao SDK는 iOS/Android 공통 선택 수단이며 iOS에는
Sign in with Apple도 같은 수준으로 제공한다. provider wrapper는 platform adapter
아래에 두고 실제 폰 복귀 흐름을 release gate에서 검증한다.

```text
앱 시작
  → SecureStore의 CHIMap refresh token 확인
  → 없거나 만료: guest-local namespace로 핵심 화면 진입
  → 원할 때 Kakao 또는 iOS Apple 로그인
  → POST /api/v1/auth/kakao/mobile 또는 /auth/apple/mobile
  → backend가 provider token/code와 사용자 identity 검증
  → CHIMap access/refresh token 발급
  → refresh token은 SecureStore에 저장
  → 사용자별 namespace로 전환
```

카카오 iOS SDK는 카카오톡 로그인과 계정 로그인 흐름을 제공한다.
[Kakao Login iOS](https://developers.kakao.com/docs/ko/kakaologin/ios)

### 5.3 Mobile backend token 계약

모바일 구현 전에 다음 API를 추가한다.

```http
POST /api/v1/auth/kakao/mobile
POST /api/v1/auth/apple/mobile
POST /api/v1/auth/token/refresh
POST /api/v1/auth/mobile/logout
POST /api/v1/auth/mobile/account/delete
GET  /api/v1/auth/me
GET  /api/v1/mobile-config
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
- refresh 시 새 generation으로 rotation하고 이전 token hash row는 family 만료까지 보존
- 이전 token은 `grace_period_expires_at`까지 120초간 재시도를 허용
- grace 안 재시도는 AES-256-GCM으로 보관한 직전 access/refresh pair를 그대로 반환
- grace가 지난 이전 token 재사용만 해당 mobile session family 전체 폐기
- token은 log와 analytics에 절대 포함하지 않음
- mobile access token은 `Authorization: Bearer`로 전달
- web cookie session과 mobile bearer session은 같은 `app_users`를 참조

JWT는 초기에는 사용하지 않는다. 현재 단일 backend에서는 opaque token이 즉시
폐기와 session 관리가 단순하다. API를 수평 확장할 때 Redis 또는 공유 DB
lookup 비용을 측정한 뒤 변경한다.

Apple 로그인은 native identity token의 issuer/audience/nonce를 검증한 뒤 5분
유효한 authorization code를 Apple `/auth/token`에서 교환한다. Apple refresh
token만 server 암호화 키로 AES-256-GCM 보관하며 앱이나 로그에는 노출하지
않는다. 앱 내 계정 삭제는 CHIMap 계정·세션을 transaction으로 제거한 뒤 Apple
`/auth/revoke`를 시도하며, 공급자 장애나 이미 철회된 grant가 내부 삭제를
되돌리지 않게 한다. CHIMap refresh 때 Apple grant의 마지막 검증이 24시간을
넘었으면 재검증하며 `invalid_grant`만 family 폐기로 처리한다.

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

상태 복원 원칙:

- RouteStore는 선택 ID/type, 상세 sheet, 마지막 요청/hash만 version 1로 저장
- 비동기 hydration 전에는 복원 완료 화면을 그리지 않음
- 성공한 추천 Query만 사용자별 AsyncStorage에 최대 24시간 저장
- auth, health, place 자동완성, 차량 위치, mutation은 persistence 대상에서 제외
- foreground 복귀 시 5분보다 오래된 active 추천만 online 상태에서 조용히 refetch
- route ID가 바뀌면 같은 FAST/BALANCED/GOAL type, 그다음 primary 순으로 복원

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
| 로그인 | 선택(Kakao/Apple) | 선택(Kakao) |

### 7.2 최초 실행 UX

1. 긴 animation 대신 짧은 native splash
2. 앱 가치 한 화면 설명
3. 로그인 없이 home 진입(로그인은 계정 영역에서 선택)
4. 최소 profile과 하루 목표 설정
5. `Apple 건강에서 오늘 걸음 자동 불러오기` 선택

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

- session을 조용히 refresh하되 실패하면 입력을 잃지 않고 guest로 전환
- 오늘 걸음은 앱 foreground 복귀와 KST 날짜 변경 때 갱신
- 위치 권한은 현재 위치 button을 눌렀을 때만 요청
- 권한이 없으면 직접 검색·수동 걸음 입력 제공
- 마지막 출발·도착과 즐겨찾기 제공
- 오래된 결과에는 생성 시각과 실시간 아님 표시

### 7.4 결과 UX

- 지도 위 bottom sheet
- 빠른·균형·목표 세 route를 한 번에 비교
- route card 선택은 지도를 바꾸고 별도 page/full-screen 상세 sheet를 엶
- 상세를 닫아도 선택 route는 유지하며 eviction 뒤 열린 sheet까지 복원
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
- 당일 `Steps` records 합산, 빈 records는 오류가 아닌 `0`으로 처리
- 여러 data origin 중복이 확인되면 Health Connect aggregate API로 교체
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

- development: 로컬 API container와 개발 provider application
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

현재 코드/생성물 gate는 통과했다. Expo prebuild 결과에서 iOS/Android identity,
NAVER key 분리, Apple/HealthKit entitlement, Kakao URL scheme, Health Connect
permission delegate, foreground-only 위치 권한을 자동 확인한다. 실제 폰 설치,
provider console credential과 Xcode Archive는 외부 release gate로 남는다.

### Phase 2 — Mobile foundation/backend token: 1~2주

- `apps/mobile`
- Expo Router guest-first session boundary
- `packages/app-core`
- mobile auth/refresh/logout API
- SecureStore
- dev/staging/prod config
- API version header
- mobile config endpoint
- CI typecheck/unit/build

현재 작업 트리에서는 위 코드 foundation과 migration 4~6까지 구현했다. 남은 Gate는
실제 iPhone/Android에서 Kakao SDK 복귀, SecureStore 재실행, NAVER SDK와 health
권한을 확인하는 것이다.

로컬 자동 gate는 workspace 경계, 전체 typecheck, 148개 결정적 테스트,
7개 PostGIS 통합 테스트, Expo prebuild native 설정 검증, Web production build 및
iOS·Android JavaScript bundle export까지 통과했다. macOS Xcode와 Android SDK가
필요한 native compile job은 CI에 구성했지만 이 Linux 작업 환경에서는 실행하지
않았으므로, 첫 push/PR의 성공 결과를 별도 release gate로 기록한다.

Gate: 실제 iPhone에서 guest 추천과 선택 로그인→session 복구→logout→재로그인이
되고 web session과 같은 `app_users` identity를 사용한다.

### Phase 3 — iOS feature parity: 3주

- onboarding/profile
- HealthKit와 수동 걸음
- 장소 검색/current location
- 추천 loading/error/result
- native NAVER map
- route detail
- 설정/data 삭제/telemetry consent
- app foreground와 KST day rollover

현재 코드 완료: profile/수동·HealthKit 걸음/current location/장소 검색/추천
loading·error·result/NAVER path/detail sheet, eviction 복원, 앱 내 계정 삭제.
남은 것은 실제 데이터로 디자인·접근성·키보드·지도 marker/차량 UX를 검증하고
설정·telemetry·최근 장소/즐겨찾기를 제품 범위에 맞게 완성하는 일이다.

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
- aggregate Privacy Manifest와 archive의 Required Reason API report 검증
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
- Expo prebuild 결과의 entitlement/manifest/URL scheme 검증
- macOS iOS simulator unsigned native compile와 Android debug native compile
- iOS/Android 실제 기기 E2E
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
- guest 상태에서 인증 장애와 무관하게 장소·추천·지도 사용 가능
- 선택 로그인 성공 후 첫 useful screen까지 불필요한 추가 consent 없음
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

모바일 계정은 선택 사항이지만 생성한 계정은 앱 안에서 삭제를 시작할 수 있다.
현재 구현은 access/refresh가 같은 session family인지 확인하고 다음을 처리한다.

1. 모든 CHIMap web/mobile session 폐기
2. server 즐겨찾기·설정 삭제
3. `oauth_accounts`와 `app_users` 삭제
4. Apple refresh grant 철회(실패해도 내부 삭제 진행), Kakao 연결 해제 정책 검토
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
3. migration 4~6 backup/restore와 refresh family/Apple credential 검증
4. staging 실제 web login/cancel/logout E2E
5. auth monitoring 추가
6. web/backend 운영 배포
7. Apple/Kakao/NAVER 개발 credential을 development bundle ID에 등록
8. iPhone용 Expo Development Build 설치와 native SDK 기술 spike
9. 실제 device에서 guest 추천, 선택 로그인, SecureStore와 grace retry 검증
10. TestFlight
11. Android adapter와 Play release

코드 세로 단면이 준비된 현재부터는 실제 Kakao/NAVER/HealthKit spike 결과를 먼저
반영한 뒤 화면 범위를 넓힌다. native SDK 문제가 생기면 공용 feature를 흔들지
않고 `src/platform` adapter 또는 config plugin만 교체한다.

## 18. 최종 Definition of Done

전체 cross-platform 목표는 다음이 모두 증명됐을 때 완료다.

- Web: 익명 전체 기능과 선택형 Kakao login이 공개 환경에서 동작
- Backend: web cookie와 mobile bearer가 같은 user identity를 사용
- iOS: guest+선택 Kakao/Apple login, HealthKit, NAVER map, 전체 추천 흐름 공개
- Android: guest+선택 Kakao login, Health Connect, NAVER map, 전체 추천 흐름 공개
- 세 frontend가 같은 versioned API contract를 사용
- 각 frontend를 독립 build/deploy/rollback 가능
- raw health/search/GPS data 비저장 경계 검증
- store privacy/account deletion 요구 충족
- 실제 device E2E와 server compatibility gate 통과

별도 native macOS 앱이 필요해지면 iOS release 뒤 별도 phase로 검토한다. 초기
Mac 사용자는 현재 반응형 web을 사용한다. React Native/Expo macOS 지원과
NAVER SDK compatibility를 iOS/Android 일정에 섞지 않는다.
