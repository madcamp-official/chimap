# CHIMap iOS 로컬 개발·서버 연동·UI/UX 일관성 계획

- 기준일: 2026-07-27
- 대상: React Native 0.85.3 + Expo SDK 56 Development Build, Node.js 24,
  pnpm 10.15.1, 원격 Node.js/PostgreSQL/PostGIS API

## 1. 목표와 최종 결정

Mac에서 iOS를 개발할 때의 기본 원칙은 다음과 같다.

1. `apps/mobile/src`와 `apps/mobile/app.config.ts`를 실제 source of truth로 둔다.
2. `apps/mobile/ios`는 Expo CNG가 생성하는 로컬 산출물로만 사용하고 Git에는
   올리지 않는다.
3. Xcode에서는 해당 환경의 clean prebuild가 실제 생성한 `.xcworkspace`를 열어
   signing, native build, 실제 기기 log만 확인한다. 현재 staging 생성 결과는
   `CHIMapStaging.xcworkspace`와 `CHIMapStaging` scheme이다. 공용 화면을
   Swift/Xcode에서 중복 구현하지 않는다.
4. 일상 API 개발과 staging Development Build는 독립된 HTTPS staging 서버와 DB만
   사용한다. production URL로 fallback하지 않으며 production smoke는 별도 release
   승인 단계에서만 수행한다.
5. Web과 iOS는 픽셀을 복제하지 않고 정보 구조, 문구, 상태 전이, 선택 규칙,
   접근성 의미를 공유한다. iOS는 safe area, page sheet, Dynamic Type, VoiceOver
   같은 native interaction을 따른다.
6. iOS 전용 수정은 `feat/ios/*`, 공용 React Native UI·state·계약 수정은
   `feat/mobile/*`에 둔다. 장기 `ios` branch는 만들지 않는다.
7. 첫 기준 기기는 iPhone 12 Pro, portrait, iOS 17 이상이다. React Native logical
   reference viewport는 `390×844pt`(`@3x`)로 기록하되 이 크기를 코드에
   하드코딩하지 않고 responsive layout 검증 기준으로만 사용한다.
8. 첫 내부 TestFlight는 `org.madcamp.chimap.staging` 전용 App Store Connect app으로
   배포하며 guest 핵심 기능, HealthKit, Kakao 로그인, refresh/logout/account
   deletion을 포함한다. Apple 로그인 코드는 유지하되 `appleEnabled=false`로
   숨기고 E2E는 외부 TestFlight 전 단계로 미룬다.
9. 첫 내부 TestFlight는 `userInterfaceStyle="light"`로 고정한다. 현재 design
   token은 light 전용이므로 Dark Mode는 semantic light/dark token과 theme
   provider를 갖추는 후속 phase로 분리한다.

최종 개발 loop는 아래와 같다.

```text
apps/mobile/src 또는 shared package 수정
  -> Metro Fast Refresh
  -> iOS Simulator에서 빠른 UI 검증
  -> 실제 iPhone 12 Pro에서 NAVER/Kakao/HealthKit/위치/접근성 검증
  -> mobile unit/typecheck + iOS native verifier
  -> GitHub macOS unsigned simulator compile
  -> staging Development Build E2E
  -> staging store build + 내부 TestFlight
  -> Apple 로그인 추가 뒤 production 외부 TestFlight/App Store
```

## 2. 현재 상태와 먼저 해결할 간극

### 이미 구현된 기반

- 최초 기준은 `feat/mobile/cross-platform-foundation@72612e2`였으며, 2026-07-27
  staging 검증 뒤 서버 staging 운영 문서를 포함한 authoritative remote
  `539a266cda9ed4a00992a41122e5f41cbe110945`로 fast-forward했다. 작업 branch는
  `feat/ios/native-spike`이며 `apps/mobile/src`, `apps/mobile/app.config.ts`,
  `apps/mobile/eas.json`과 세 shared package가 모두 존재한다.

- development/staging/production bundle ID가 각각
  `org.madcamp.chimap.dev`, `org.madcamp.chimap.staging`,
  `org.madcamp.chimap`으로 분리돼 있다.
- iOS와 Android NAVER Client ID, Web Client ID를 서로 재사용하지 못하게
  `app.config.ts`에서 검사한다.
- 공용 API schema는 `@chimap/contracts`, 순수 정책은 `@chimap/app-core`,
  색·간격은 `@chimap/design-tokens`가 소유한다.
- iOS adapter는 위치, NAVER native map, HealthKit, Kakao, Apple 로그인으로
  분리돼 있다.
- Zustand UI state와 TanStack Query 추천 응답을 environment·OS·사용자별로
  저장하고 앱 재실행 시 복원한다.
- mobile 요청은 `X-Client-Platform`, `X-App-Version`,
  `X-Contract-Version`을 한 묶음으로 보낸다.
- GitHub Actions에서 iOS prebuild, CocoaPods 설치와 unsigned simulator compile이
  통과했다.

### 2026-07-27 staging Development Build 검증 현황

- `539a266`은 `compose.staging.yml`, staging/iOS 운영서와 관련 문서만 변경했으며
  `apps/api`, `packages/contracts`, `apps/mobile/src`, dependency lockfile은 바꾸지
  않았다. 따라서 mobile API schema와 runtime source에는 직접적인 version 충돌이
  없다. 원격 `main`은 여전히 초기 commit `321ef96`이고 실제 최신 기준선은
  `origin/feat/mobile/cross-platform-foundation`이다.
- 새 staging 운영서는 production과 다른 Compose project, loopback port, DB volume,
  env file을 명시해 API/DB 격리 기준과 일치한다. 다만 Kakao는 같은 Application의
  환경별 key를 쓰는 정책이라, 별도 staging Kakao Application을 요구해 온 기존 계획과
  다르다. 실제 Kakao 로그인 전에 mobile Native App Key와 server `KAKAO_APP_ID`가
  같은 staging identity인지 provider console에서 확정해야 한다.
- 검증 환경은 Apple Silicon Mac, macOS 26.5.2(25F84), Xcode 26.6(17F113),
  Ruby 2.6.10, CocoaPods 1.16.2, Node.js 24.18.0, pnpm 10.15.1이다.
- 현재 login shell에는 `node`, `pnpm`, `pod`가 상시 설치돼 있지 않아 이번 검증은
  `/tmp`의 격리 toolchain으로 수행했다. 반복 가능한 로컬 loop 전에는 같은 버전을
  영구 설치하거나 저장소 pinning 방식으로 제공해야 한다.
- `https://staging.chimap.madcamp-kaist.org/api/v1/health`는 TLS 오류 없이 HTTP 200,
  `status=ok`를 반환했다.
- `/api/v1/mobile-config`는 HTTP 200이며 `guestEnabled=true`, `kakaoEnabled=true`,
  `appleEnabled=false`다.
- upstream 동기화 뒤 `/api/v1/readiness`는 HTTP 200 `ready`로 바뀌었다. 확인 당시
  stop 227,058건, linked stop 160건, route 43건, route stop 108건이며 subway
  station은 여전히 0건이다. 따라서 readiness는 통과하지만 지하철 범위 완료를
  의미하지는 않는다.
- iOS client header와 현재 contract schema로 KAIST·대전역 장소 검색은 각각 HTTP
  200과 8개 결과를 반환했다. 첫 개인화 추천 요청은 약 22초 뒤 Cloudflare HTML
  504였으나 같은 요청 재시도는 provider/cache가 준비된 뒤 HTTP 200, FAST 1개로
  성공했다. mobile Query는 1회 retry가 있지만 첫 요청 latency와 JSON이 아닌 504
  응답은 실제 기기 E2E에서 계속 관찰해야 한다.
- staging host와 mobile flag는 확인했지만 DB volume과 provider application이
  production과 물리적으로 분리됐는지는 client endpoint만으로 독립 검증할 수 없다.
  서버 배포 설정과 provider console에서 별도 확인해야 한다.
- Git에서 제외된 `apps/mobile/.env`의 다섯 client 값을 사용했다. API host는 staging
  정확한 주소이며 trailing slash가 없고 NAVER iOS/Android Client ID는 서로 다르다.
  Web Client ID 값이 로컬에 없어 native ID와의 실제 값 비교는 미수행이다.
- working tree의 `app.config.ts`, config test, native verifier에는 Light Mode,
  deployment target 17.0, iPhone-only, staging URL 고정, 공개 provider ID와 server
  secret 분리 검사가 반영돼 있다.
- frozen install, workspace boundaries, 세 shared package build, mobile typecheck,
  mobile test 25건, staging public Expo config, clean iOS prebuild, Pod install,
  native verifier가 통과했다.
- clean prebuild 결과는 `apps/mobile/ios/CHIMapStaging.xcworkspace`, scheme은
  `CHIMapStaging`이다. generated iOS 경로는 Git ignore 상태다.
- 설치된 iPhone 12 Pro Simulator가 없어 iOS 26.5 iPhone 17 Simulator로 unsigned
  Debug compile을 수행했고 성공했다. 생성 앱 설치와 Dev Launcher 기동, staging
  환경으로 실행한 Metro LAN server 탐색까지 확인했다. 외부 scheme 열기 확인 dialog는
  macOS가 자동 keystroke를 허용하지 않아 JS feature smoke는 수행하지 못했다. 이
  결과는 390×844pt UI 검증을 대체하지 않는다.
- 실제 iPhone 12 Pro(iOS 26.5.2)는 연결·pairing·Developer Mode와 Xcode destination을
  확인했다. 다만 현재 Personal Team은 Sign in with Apple capability를 지원하지 않아
  `org.madcamp.chimap.staging` provisioning profile 생성에 실패했다. Apple 코드와
  entitlement를 삭제하는 우회는 하지 않았으며 앱 설치, Metro 연결, physical smoke는
  아직 수행하지 못했다.
- `apps/mobile/eas.json`은 여전히 Ad Hoc용 staging profile이고 Expo owner,
  `extra.eas.projectId`, staging `ascAppId`도 미설정이다. 이번 단계에서는 EAS/App Store
  Connect를 변경하거나 build/submit하지 않았다.

### Web과 비교해 iOS에서 보완할 부분

현재 mobile foundation은 기능의 세로 단면이지만 Web과 완전한 UX parity는 아니다.
다음 항목을 iOS 개발 초기에 명시적으로 정리한다.

1. 현재 mobile은 추천 카드를 누르면 route 선택과 상세 sheet 열기가 동시에
   일어난다. Web처럼 `경로 선택`과 `자세히`를 분리하고, 카드 선택만으로 상세를
   자동으로 열지 않게 한다.
2. 현재 native map은 모든 leg를 하나의 초록색 path로 합친다. Web과 같은
   도보·버스·지하철 의미 색/선, 출발·도착·승차·환승·하차 marker를 구현한다.
3. 차량 marker, 지도 장애와 추천 장애의 분리, 데이터 제공자 안내가 아직
   충분하지 않다.
4. profile 입력이 한 화면에 항상 노출된다. Web처럼 최초 필수 onboarding,
   저장 후 간결한 요약, 명시적인 수정·삭제 흐름으로 정리한다.
5. Web의 `guided/compact`, reduce motion, loading 지연 안내와 오류 code mapping을
   mobile 공용 정책으로 옮길지 결정해야 한다.
6. 앱과 Modal이 React Native core `SafeAreaView`를 사용한다. deprecated core
   component를 `react-native-safe-area-context`의 `SafeAreaProvider`, `SafeAreaView`,
   inset 기반 처리로 교체해야 한다.
7. 신체정보와 걸음 입력의 `twoColumns`, 로그인된 계정의 action row가 항상 가로
   배치다. `useWindowDimensions()`의 `width`와 `fontScale`로 1열 전환해야 한다.
8. `number-pad`/`decimal-pad`에 완료·닫기 동작이 없고 keyboard avoidance가 없다.
   현재 걸음, 신체정보, 장소 검색과 추천 버튼이 keyboard에 가려지지 않게 해야 한다.
9. 장소 검색은 명시적 버튼/submit 요청만 있고 debounce, 이전 요청 취소, 늦게 도착한
   stale result 차단이 없다.
10. design token은 light 위주다. working tree의 `app.config.ts`는 첫 내부
    TestFlight 정책에 맞춰 `userInterfaceStyle="light"`로 고정됐고 config test와
    native verifier도 통과했다. 완전한 Dark Theme는 후속 phase다.
11. 현재 `apps/mobile/eas.json`의 staging profile은 `distribution="internal"`인
    Ad Hoc build다. TestFlight용 store distribution, EAS preview environment,
    staging submit profile로 바꿔야 한다.

이 간극은 Xcode 내부에서 임시 UI로 메우지 않고 `apps/mobile/src/features`와
shared package에 반영한다.

## 3. source of truth와 디렉터리 경계

| 영역 | source of truth | 허용되는 변경 |
| --- | --- | --- |
| iOS/Android 공용 화면 | `apps/mobile/src/features` | React Native component, state, API orchestration |
| iOS adapter | `apps/mobile/src/platform/*.ios.*` | HealthKit, Apple/Kakao callback, iOS 전용 wrapper |
| native 생성 설정 | `apps/mobile/app.config.ts`, `apps/mobile/plugins` | Info.plist, entitlement, URL scheme, capability 생성 |
| API schema | `packages/contracts` | request/response와 error code 계약 |
| 순수 정책 | `packages/app-core` | 날짜, cache 만료, route 선택, UI 상태 규칙 |
| 시각 token | `packages/design-tokens` | 의미 색, spacing, radius; 이후 typography/motion 확장 |
| Web 구현 | `apps/web` | DOM/CSS 전용. Mobile에서 직접 import 금지 |
| generated iOS | `apps/mobile/ios` | 로컬 build/debug 전용, commit 금지 |

`expo prebuild --clean`은 `apps/mobile/ios`를 삭제하고 다시 만든다. Xcode에서
실험한 native 수정이 필요해졌다면 다음 중 하나로 되돌려야 한다.

- Info.plist/entitlement/build setting: `app.config.ts` 또는 config plugin
- native SDK 연결: local Expo Module 또는 `src/platform` wrapper
- CocoaPods 의존성: package/config plugin
- 임시 Xcode 수정: 원인을 확인한 즉시 patch를 source of truth로 옮긴 뒤 clean
  prebuild로 재현

Mac에서 SwiftUI 기본 프로젝트만 보이고 `apps/mobile/src` 또는
`apps/mobile/app.config.ts`가 없다면 새 SwiftUI 앱을 구현하지 않는다. 잘못된
디렉터리나 오래된 checkout으로 판단하고 authoritative Expo monorepo의 합의된
branch/commit을 다시 checkout한다.

## 4. Git branch와 Mac checkout 운용

현재 `main`은 아직 실제 통합 기준선보다 오래됐으므로 무조건 `main`에서 새 iOS
작업을 시작하면 안 된다. 먼저 팀이 합의한 최신 remote 기준 commit을 확인한다.

단기 순서:

1. 현재 server/mobile 변경을 작은 commit으로 정리하고 remote에 push한다.
2. foundation이 `main`에 병합되기 전이면
   `origin/feat/mobile/cross-platform-foundation`을 기준으로 한다.
3. foundation 병합 후에는 최신 `origin/main`을 기준으로 바꾼다.
4. Mac에서 별도 worktree 또는 별도 clone을 사용한다.

예시:

```bash
git fetch origin --prune
git worktree add ../chimap-ios \
  -b feat/ios/native-spike \
  origin/feat/mobile/cross-platform-foundation
cd ../chimap-ios
```

작업 분리:

- `feat/ios/native-spike`: signing, capability, iOS SDK, Xcode/archive 문제
- `feat/mobile/ios-ui-parity`: 공용 React Native 화면·상태·문구
- `feat/contracts/<scope>`: API schema가 먼저 바뀌어야 하는 경우
- `feat/api/<scope>`: additive API/migration과 staging 설정
- `feat/ios/release-hardening`: TestFlight, privacy report, archive 설정

iOS branch에서 공용 UI 문제를 발견하면 작은 재현 test와 함께
`feat/mobile/*`로 옮긴다. Android가 나중에 iOS branch의 history를 통째로
가져가게 만들지 않는다.

## 5. Mac 개발 환경 준비

### 필수 도구

- Xcode 26.4 이상과 프로젝트가 요구하는 iOS Simulator runtime
- Xcode Command Line Tools
- Apple Developer Program에 등록된 Apple Account
- Node.js `24.18.x`
- Corepack + pnpm `10.15.1`
- CocoaPods
- 실제 HealthKit·KakaoTalk·location 검증용 iPhone

초기 점검:

```bash
xcode-select -p
xcodebuild -version
node --version
corepack enable
corepack prepare pnpm@10.15.1 --activate
pnpm --version
pod --version
```

첫 성공 build에서 다음 버전을 release 기록에 남긴다.

- macOS, Xcode build 번호, iOS Simulator runtime
- Apple Silicon/Intel
- Ruby와 CocoaPods
- Node와 pnpm
- Expo, React Native, native SDK version

팀원이 둘 이상이면 첫 iOS spike 뒤 `.xcode-version`, `.ruby-version`, `Gemfile`과
`Gemfile.lock` 도입을 검토한다. 처음부터 generated `Podfile.lock`을 Git에
추가하지는 않는다. CNG 정책을 바꿀 때만 별도 결정을 내린다.

### iPhone 준비

첫 필수 기준 기기는 iOS 17 이상을 실행하는 실제 iPhone 12 Pro다. 화면 reference는
portrait `390×844pt`(`@3x`)이지만 layout 상수로 사용하지 않는다.

1. iPhone 12 Pro를 USB로 Mac과 연결하고 `Trust This Computer`를 승인한다.
2. `설정 > 개인정보 보호 및 보안 > 개발자 모드`를 켠다.
3. Xcode `Window > Devices and Simulators`에서 기기와 provisioning 상태를
   확인한다.
4. 처음에는 USB 실행을 성공시킨 다음 wireless debugging을 사용한다.
5. Health 앱에 오늘 걸음 sample이 있는 iPhone 12 Pro를 준비한다.
6. 추가 회귀는 390pt보다 좁은 작은 iPhone과 Pro Max Simulator에서 수행한다.

## 6. 환경변수와 credential 분리

Mac에는 server `.env`를 복사하지 않는다. 현재 로컬 staging 작업은 Git에서 제외된
`apps/mobile/.env`를 명시적으로 로드한다. 팀 정책에 따라
`apps/mobile/.env.staging.local` 같은 동등한 ignored 파일을 써도 되지만, Expo가
우연히 다른 파일을 읽는 것에 의존하지 않고 config/prebuild/Metro를 같은 환경으로
실행한다. 커밋 가능한 키 이름 템플릿은 `apps/mobile/.env.example`이다.

```dotenv
APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org
NAVER_MAP_CLIENT_ID_IOS=<staging iOS Client ID>
NAVER_MAP_CLIENT_ID_ANDROID=<staging Android Client ID>
KAKAO_NATIVE_APP_KEY=<staging Kakao Native App Key>
```

iOS만 생성하더라도 현재 `app.config.ts`가 두 native NAVER ID를 모두 검증하므로
Android ID도 비워 두면 안 된다. 두 값은 같아도 안 된다.

다음 값은 mobile 파일, Xcode scheme, `xcconfig`, source에 절대 넣지 않는다.

- `NAVER_MAP_NCP_KEY`
- `KAKAO_REST_API_KEY`, `KAKAO_OAUTH_CLIENT_SECRET`
- `AUTH_SESSION_SECRET`, `AUTH_REFRESH_RETRY_ENCRYPTION_KEY`
- `APPLE_PRIVATE_KEY_BASE64`
- PostgreSQL password, TAGO service key, alert webhook

`EXPO_PUBLIC_*`와 `Constants.expoConfig.extra`는 client에서 읽을 수 있는 공개
설정이다. `expo config --type public` 출력에 나타나면 비밀값으로 취급할 수 없다.

환경별 application/credential은 다음과 같이 분리한다.

| 환경 | bundle ID | API/DB | NAVER/Kakao/Apple | 용도 |
| --- | --- | --- | --- | --- |
| development | `org.madcamp.chimap.dev` | local 또는 dev HTTPS | 개발용 app/client | Simulator·개발 iPhone |
| staging | `org.madcamp.chimap.staging` | staging 전용 API/DB | staging Kakao app + NAVER iOS/Android client | 내부 TestFlight·auth E2E |
| production | `org.madcamp.chimap` | production | production credential | 외부 TestFlight·App Store |

development/staging/production 앱은 서로 다른 bundle ID라 한 iPhone에 함께
설치할 수 있다. AsyncStorage와 SecureStore namespace도 `APP_ENV + ios + owner`
기준으로 나뉘므로 캐시가 섞이지 않는다.

### EAS project와 staging TestFlight 설정

현재 `apps/mobile/eas.json`의 staging profile은 `distribution="internal"`이므로
TestFlight가 아니라 Ad Hoc 배포다. 내부 TestFlight용 staging profile은 다음
성격으로 변경한다.

```json
{
  "build": {
    "staging": {
      "distribution": "store",
      "environment": "preview",
      "autoIncrement": true,
      "env": { "APP_ENV": "staging" }
    }
  },
  "submit": {
    "staging": {
      "ios": { "ascAppId": "<STAGING_ASC_APP_ID>" }
    },
    "production": {
      "ios": { "ascAppId": "<PRODUCTION_ASC_APP_ID>" }
    }
  }
}
```

- EAS 기본 environment만 사용할 수 있는 계정에서는 `preview`를 CHIMap staging
  값 저장소로 사용한다. 사용 중인 EAS plan이 custom environment를 지원할 때만
  별도 `staging` environment로 이동한다.
- EAS `preview` environment에는 다음 client 공개값을 등록한다.
  - `EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org`
  - `NAVER_MAP_CLIENT_ID_IOS`
  - `NAVER_MAP_CLIENT_ID_ANDROID`
  - `KAKAO_NATIVE_APP_KEY`
- 위 값은 client binary에 포함되는 URL/식별자다. `AUTH_SESSION_SECRET`, DB
  password, Kakao REST secret/client secret, Apple private key, refresh encryption
  key 같은 server secret은 mobile EAS environment에 넣지 않는다.
- bootstrap에서 `app.config.ts`의 Expo `owner`와 `extra.eas.projectId`가 팀의 EAS
  project에 연결됐는지 확인한다. 현재 config에는 둘 다 없으므로 첫 store build
  전에 명시적으로 연결해야 한다.
- staging과 production의 `ascAppId`, bundle ID, App Store Connect app을 분리한다.

실제 EAS 명령 전에 `expo config --type public` 출력으로 `APP_ENV`, bundle ID,
API host, NAVER iOS/Android ID 분리와 Kakao app key 환경을 확인한다. 명령은
`apps/mobile/eas.json`이 있는 디렉터리에서 실행한다.

```bash
cd apps/mobile
eas build --platform ios --profile staging
eas submit --platform ios --profile staging --latest
```

## 7. 서버 연결 전략

### 권장 우선순위

#### 1순위: HTTPS staging

일상 개발과 로그인 E2E에는 다음 성격의 staging을 만든다.

- 예: `https://staging.chimap.madcamp-kaist.org`
- production과 다른 Compose project/container name
- production과 다른 PostgreSQL DB/volume
- staging 전용 Kakao Native App과 NAVER iOS/Android Application
- `AUTH_MOBILE_ENABLED=1`
- staging 전용 `AUTH_REFRESH_RETRY_ENCRYPTION_KEY`
- mobile config `guestEnabled=true`, `kakaoEnabled=true`, `appleEnabled=false`
- production보다 완화하지 않은 TLS·token·rate-limit 정책
- 실제 개인 계정과 섞이지 않는 test account 정리 절차

같은 물리 server를 사용해도 DB volume, auth credential, backup, monitoring label을
반드시 분리한다. `APP_ENV=staging` 앱이 production DB에 로그인하는 조합은
허용하지 않는다.

Apple provider credential과 `appleEnabled=true` 전환은 이번 staging 내부
TestFlight에서 수행하지 않고 외부 TestFlight 전 phase에서 별도로 진행한다.

#### 별도 release gate: production HTTPS

Production은 staging 장애 시 사용하는 fallback이 아니다. 아래 항목도 release
담당자가 별도로 승인한 read-only 회귀에서만 수행한다.

허용 범위:

- health/readiness/mobile-config 확인
- guest 장소 검색·추천·지도 smoke
- release candidate의 최종 read-only 회귀

금지 범위:

- 반복 부하 테스트
- token theft/reuse와 계정 삭제 실험
- 장애·maintenance·최소 버전 시나리오
- 개발용 provider credential과 production identity 혼합

#### 3순위: Mac local API

Simulator만 쓸 때 `localhost`는 Mac을 가리키지만 plain HTTP는 ATS와 실제 기기
동작 차이를 만든다. 실기기는 `localhost`가 iPhone 자신을 가리킨다.

따라서 local API가 필요하면 HTTPS tunnel을 기본으로 한다.

```text
iPhone/Simulator
  -> HTTPS tunnel URL
  -> Mac localhost:8080 API
  -> Mac local PostgreSQL/PostGIS
```

Tunnel URL을 `EXPO_PUBLIC_API_BASE_URL`에 넣고 Metro를 재시작한다. tunnel에는
임의 공개 접근을 막는 access control과 짧은 수명을 적용한다.

같은 Wi-Fi의 `http://<MAC_LAN_IP>:8080`을 꼭 써야 한다면 development build에만
다음을 명시적으로 설계한다.

- `NSLocalNetworkUsageDescription`
- development-only local network/ATS 설정
- macOS firewall의 Node/API port 허용
- API의 `0.0.0.0` listen 여부
- iPhone과 Mac의 같은 LAN, VPN/Private Relay 영향

`NSAllowsArbitraryLoads=true`를 production에 남기는 해결법은 사용하지 않는다.
IP와 local network에 대한 iOS 정책은 OS version에 따라 달라질 수 있으므로
HTTPS tunnel이 더 재현 가능하다.

### 앱 기동 전 server preflight

```bash
export CHIMAP_API_BASE=https://staging.chimap.madcamp-kaist.org
curl -fsS "$CHIMAP_API_BASE/api/v1/health"
curl -fsS "$CHIMAP_API_BASE/api/v1/readiness"
curl -fsS "$CHIMAP_API_BASE/api/v1/mobile-config"
```

확인할 내용:

- health `ok`; readiness가 `ready`가 아니면 HTTP status와 body의 미준비 항목을 기록
- DB/PostGIS/migration current
- Kakao/NAVER/TAGO provider ready
- `minimumSupportedVersion.ios`와 앱 version의 호환
- maintenance와 supported region
- guest/Kakao/Apple 활성 flag

mobile config의 provider flag가 `false`면 UI에서 해당 로그인 버튼을 숨기는 것이
정상이다. client에서 flag를 강제로 덮어써 production 인증을 시험하지 않는다.

### client-server 계약

- 모든 mobile API 호출은 공통 helper를 통해 세 mobile header를 보낸다.
- request/response는 `@chimap/contracts` Zod schema로 검증한다.
- 426은 강제 업데이트, 503은 점검, 401은 session 만료로 구분한다.
- 네트워크 timeout은 저장된 guest/route 화면을 즉시 지우지 않는다.
- server 원문 오류, token, 검색어, 좌표, 신체정보를 console/analytics에 남기지
  않는다.
- API 계약 변경은 `contracts -> api -> mobile/web` 순서로 additive하게 진행한다.

## 8. iOS native project 생성과 Xcode 열기

native project를 생성하기 전에 `app.config.ts`에 Expo SDK 56 built-in
`ios.deploymentTarget: "17.0"`을 설정하고 `userInterfaceStyle: "light"`를
확정한다. `expo-build-properties`에는 privacy manifest aggregation만 유지하며,
deprecated된 plugin의 `ios.deploymentTarget` 방식은 사용하지 않는다.

`app.config.test.ts`는 deployment target `17.0`, `supportsTablet=false`, portrait,
light style과 환경별 bundle ID를 검사한다. `scripts/verify-mobile-native-config.mjs`는
생성된 `project.pbxproj`의 `IPHONEOS_DEPLOYMENT_TARGET = 17.0`, iPhone-only target
family, Info.plist의 light appearance를 검사한다.

staging client 값이 든 ignored 환경 파일을 같은 shell에 명시적으로 로드한 뒤
실행한다. 아래 예시는 현재 사용하는 `apps/mobile/.env` 기준이다.

```bash
pnpm install --frozen-lockfile
pnpm --filter @chimap/contracts build
pnpm --filter @chimap/app-core build
pnpm --filter @chimap/design-tokens build

cd apps/mobile
set -a
. ./.env
set +a
pnpm exec expo config --type public
pnpm exec expo prebuild --clean --platform ios
cd ../..
node scripts/verify-mobile-native-config.mjs ios
open apps/mobile/ios/CHIMapStaging.xcworkspace
```

반드시 `.xcworkspace`를 연다. `.xcodeproj`를 직접 열면 CocoaPods dependency가
scheme/build에 포함되지 않을 수 있다. 이름은 문서에 하드코딩된 development 이름을
가정하지 말고 clean prebuild 뒤 실제 생성 결과를 확인한다.

Xcode에서 확인한다.

1. Scheme: staging에서는 `CHIMapStaging`
2. Configuration: `Debug`
3. Target bundle ID: `org.madcamp.chimap.staging`
4. Signing: 개발자 Team + Automatically manage signing
5. Capability: HealthKit, Sign in with Apple
6. entitlement: HealthKit read, Apple Sign In; HealthKit background delivery 없음
7. Info.plist: `NMFNcpKeyId`, Kakao scheme, `kakaokompassauth`
8. permission: foreground location과 HealthKit read 설명만 존재
9. Always Location, motion, HealthKit write/background entitlement가 없음
10. Privacy Manifest aggregation이 켜져 있음
11. Deployment target `17.0`, iPhone-only, portrait와 light appearance

개발자 Team 선택이 clean prebuild마다 사라진다면 단기 수동 설정을 반복하지 말고
공개 `IOS_APPLE_TEAM_ID` 같은 별도 build 변수와 `ios.appleTeamId`를
`app.config.ts`에 추가하는 PR을 만든다. server의 Apple `.p8` credential을
client signing 설정과 혼합하지 않는다.

현재 로컬 Personal Team은 Sign in with Apple capability를 지원하지 않아 자동
provisioning이 실패한다. `appleEnabled=false`는 앱 버튼 노출 정책일 뿐 native
entitlement를 제거하지 않으므로 이 signing 제약을 해결하지 않는다. 실제 staging
App ID에 HealthKit과 Sign in with Apple을 활성화할 수 있는 유료 Apple Developer
Program Team을 Xcode에 추가하고 해당 Team으로 target을 서명해야 한다. 검증을 위해
generated entitlement나 Apple adapter를 삭제하지 않는다.

## 9. Development Build 실행 loop

### 첫 native 설치

Xcode에서 Simulator 또는 연결된 iPhone을 destination으로 선택하고 `Cmd+R`을
실행한다. CLI로 같은 작업을 재현할 때는 다음을 사용한다.

```bash
pnpm --filter @chimap/mobile exec expo run:ios
pnpm --filter @chimap/mobile exec expo run:ios --device
```

### Metro만 반복 실행

native binary가 설치된 뒤 TypeScript/React Native 변경에는 native rebuild가
필요 없다.

```bash
pnpm --filter @chimap/mobile exec expo start --dev-client --clear --lan
```

- Simulator는 터미널에서 `i`로 연다.
- iPhone과 Mac은 같은 Wi-Fi를 우선 사용한다.
- 학교/공용 Wi-Fi가 peer traffic을 막으면 Metro만 `--tunnel`로 전환한다.
- tunnel은 LAN보다 reload가 느리므로 상시 기본값으로 두지 않는다.

API HTTPS 주소와 Metro 연결 주소는 별개다. Metro를 tunnel로 연결해도 앱의
`EXPO_PUBLIC_API_BASE_URL`은 staging/production API를 계속 가리킨다.

### 변경 유형별 rebuild 기준

| 변경 | 필요한 작업 |
| --- | --- |
| `.tsx`, pure TypeScript, style | Fast Refresh 또는 reload |
| API base URL/app config `extra` | Metro 완전 재시작 후 runtime config 확인 |
| native package 추가/upgrade | clean prebuild + `pod install` + Development Build 재설치 |
| `app.config.ts`, config plugin, entitlement | clean prebuild + verifier + 재설치 |
| Bundle ID/NAVER/Kakao scheme | provider console 갱신 + clean prebuild + 재서명 |
| Pod/Xcode build setting | source config/plugin으로 반영 후 clean 재생성 |

## 10. provider와 capability 준비

### NAVER Map iOS

- Web/Android와 다른 iOS Application Client ID를 사용한다.
- NAVER console의 iOS bundle ID에 `org.madcamp.chimap.dev`와 staging/production
  ID를 환경별로 정확히 등록한다.
- generated Info.plist의 `NMFNcpKeyId`가 iOS ID인지 verifier로 확인한다.
- 지도 SDK의 로고·저작권 control을 가리지 않는다.
- 인증 실패, 빈 좌표, 한 좌표, 긴 polyline과 foreground 재진입을 시험한다.

### Kakao Login

- Kakao development Native App Key에 development bundle ID를 등록한다.
- `kakao<NativeAppKey>://oauth`와 `kakaokompassauth`가 generated Info.plist에
  들어가는지 확인한다.
- KakaoTalk 설치/미설치, 성공, 사용자 취소, 앱 복귀, browser fallback을 각각
  시험한다.
- Kakao access token은 server 검증 직후 폐기하며 client log에 출력하지 않는다.
- production mobile auth가 꺼진 동안에는 버튼을 강제로 노출하지 않는다.

### Sign in with Apple

- 기존 Apple adapter, login button, contract와 entitlement 생성 코드는 삭제하지
  않는다.
- 첫 staging 내부 TestFlight에서는 server mobile config의
  `appleEnabled=false`로 버튼을 숨기고 Apple 로그인 E2E를 release gate에서
  제외한다.
- 외부 TestFlight 전 별도 phase에서 production App ID/provider 설정, server
  audience, 최초/재로그인, refresh/logout/account deletion, grant revoke를
  검증한 뒤 `appleEnabled=true` 전환을 승인한다.

### HealthKit

- 오늘 걸음 read만 요청한다. write, clinical record, background delivery는
  사용하지 않는다.
- HealthKit availability를 먼저 확인하고 권한은 사용자가 `건강 앱에서 읽기`를
  눌렀을 때만 요청한다.
- HealthKit의 “오늘”은 현재 구현처럼 기기 `Calendar`의 local day 시작부터 현재까지로
  조회한다. 추천 cache의 한국 날짜 reset은 별도 정책으로 유지한다.
- 기기 timezone이 한국과 다르면 HealthKit local day와 cache reset 날짜가 다를 수
  있다. timezone 변경, 한국 자정, 기기 local 자정을 test fixture로 고정하고 UI에는
  HealthKit이 기기 기준 오늘 걸음이라는 점을 표시한다.
- sample 없음은 정상적인 `0`이며 오류로 취급하지 않는다. HealthKit은 read 권한
  거부를 앱이 확정적으로 판별할 수 없으므로 임의로 “거부됨”이라고 단정하지 않는다.
  읽기 실패·사용 불가는 원인 중립적인 안내와 수동 입력으로 이어진다.
- Simulator 결과만으로 완료하지 않고 실제 iPhone 12 Pro에서 sample 있음, 0건,
  읽기 실패, 수동 fallback을 검증한다.

### SecureStore

- access/refresh pair만 저장하고 추천 응답과 UI state는 AsyncStorage에 둔다.
- iOS Keychain 값은 같은 bundle ID 재설치 뒤 남을 수 있으므로 앱 삭제만으로
  auth test 초기화가 끝났다고 가정하지 않는다.
- logout/account deletion 경로와 development 전용 명시적 session reset을 사용한다.

## 11. Web과 iOS UI/UX 일관성 규칙

### 동일해야 하는 것

- 사용자 용어와 한국어 문구
- onboarding 필수 입력과 validation 범위
- 장소 검색 상태와 명시 선택 원칙
- 현재 위치 실패 시 검색을 계속할 수 있는 fallback
- recommendation request와 route 기본 선택 규칙
- 카드에 표시하는 시간·도보·걸음·환승 정보 우선순위
- 상세가 기본 닫힘이고 사용자가 명시적으로 여는 규칙
- route 변경 시 열린 상세 닫힘
- 날짜 변경 시 현재 걸음 0과 새 추천 자동 요청 금지
- loading, empty, partial success, provider failure의 의미
- 로그아웃·계정 전환 시 사용자 cache 삭제 경계
- privacy/analytics 수집 범위

### platform에 맞게 달라도 되는 것

- Web의 좌측 panel은 iOS에서 scrollable planner와 page sheet로 바꾼다.
- hover는 iOS에 없으므로 press/focus/selected 상태로 대체한다.
- Web dialog는 iOS Modal/page sheet 또는 native alert로 표현한다.
- 브라우저 키보드 조작은 VoiceOver, Dynamic Type, Switch Control과 touch target으로
  번역한다.
- Web SVG fallback과 native map fallback은 구현이 달라도 동일한 오류 의미와
  실제 route 좌표를 사용한다.

### Safe Area, responsive layout와 keyboard

- React Native core `SafeAreaView`를 사용하지 않는다. 이미 설치된
  `react-native-safe-area-context`의 `SafeAreaProvider`를 앱 root에 두고 bootstrap,
  planner, Modal/page sheet에도 safe area를 적용한다.
- `useWindowDimensions()`의 `width`와 `fontScale`을 layout 판단 기준으로 사용한다.
  `width < 390` 또는 `fontScale >= 1.3`이면 걸음/신체정보 `twoColumns`와 로그인된
  account action row를 세로로 쌓는다.
- `390×844pt`는 iPhone 12 Pro screenshot reference일 뿐 style width/height로
  하드코딩하지 않는다. content는 safe area 안에서 가용 폭을 사용한다.
- 일반 화면과 page sheet는 세로 `ScrollView`로 planner, 검색 결과, 지도, 추천 카드,
  상세의 모든 action에 접근할 수 있어야 한다.
- `number-pad`와 `decimal-pad`에는 toolbar의 Done 또는 동등한 명시적 닫기 동작을
  제공한다. `KeyboardAvoidingView`, scroll-to-focused-input 또는 동등한 처리로 현재
  걸음, 신체정보, 장소 검색과 추천 버튼이 keyboard에 가려지지 않게 한다.
- 모든 interactive control의 touch target은 최소 `44×44pt`로 유지한다.

### design token 확장

현재 공용 token은 색, spacing, radius만 제공한다. 다음 token을 공용 semantic
계약으로 추가하되 Web CSS나 React Native style object를 서로 import하지 않는다.

- typography role: display/title/body/label/caption
- control min height와 touch target `44pt` 이상
- route color: walk/bus/subway/selected/warning
- elevation/surface hierarchy
- motion duration과 reduced-motion의 `0ms` 대체
- focus/pressed/disabled/error 상태

### iOS 화면 검증 matrix

- 실제 iPhone 12 Pro portrait `390×844pt`를 필수 기준으로 하고 작은 iPhone과 Pro
  Max Simulator를 회귀 기준으로 사용한다.
- portrait 기본; 현재 app config에 따라 landscape는 지원하지 않음
- 첫 내부 TestFlight는 Light Mode만 검증한다. Dark Mode는 theme phase 이후 추가한다.
- Dynamic Type 기본과 접근성 크기; text/button 겹침과 잘림이 없어야 함
- VoiceOver on/off
- Reduce Motion on/off
- 한국어 긴 장소명·노선명
- software keyboard 표시, number/decimal pad, sheet와 keyboard 충돌
- offline, 3G/high latency, provider 504, API maintenance, update required
- iPhone 12 Pro screenshot set: bootstrap/update/maintenance, guest/account panel,
  profile/걸음 입력, 장소 검색 결과, 추천 목록+지도, 상세 page sheet, HealthKit 상태,
  Kakao 진행·취소·오류

## 12. 구현 phase

### Phase 0 — 기준선 고정: 0.5일

- `feat/mobile/cross-platform-foundation@72612e2` 이상과 필수 monorepo 경로 확인
- Mac toolchain version 기록
- mobile 전용 ignored `.env` 작성과 `.env.example` 유지
- 공개 server preflight
- `expo config --type public`에서 비밀값 미포함 확인
- Expo `owner`, `extra.eas.projectId`, staging/production App Store Connect app 연결 확인

Gate: clean checkout에서 generated iOS를 만들 수 있다.

### Phase 1 — Xcode Development Build: 1일

- built-in `ios.deploymentTarget="17.0"`, iPhone-only, portrait, Light Mode 설정
- app config test와 native verifier에 deployment/device/style 검증 추가
- clean iOS prebuild와 verifier
- CocoaPods 설치
- clean prebuild가 생성한 staging `CHIMapStaging.xcworkspace` open
- Simulator unsigned build
- HealthKit·Sign in with Apple을 지원하는 Development Team으로 실제 iPhone 12 Pro 설치
- Metro LAN/tunnel 연결 확인

Gate: Xcode와 CLI가 같은 Debug app을 재현하고 Fast Refresh가 동작한다.

### Phase 2 — HTTPS staging과 mobile auth: 1~2일

- staging subdomain/API/DB/volume 분리
- staging mobile config와 minimum version
- production과 분리된 staging Kakao app과 NAVER iOS/Android Client ID
- `guestEnabled=true`, `kakaoEnabled=true`, `appleEnabled=false`
- Kakao login, token rotation, logout, account deletion 활성화
- monitoring에 environment와 client platform label 추가

Gate: production DB를 건드리지 않고 guest/Kakao/refresh/logout/account deletion
E2E가 가능하고 Apple UI는 기존 코드를 유지한 채 숨겨진다.

### Phase 3 — Web UX parity: 3~5일

- onboarding/profile summary 구조
- route 선택과 `자세히` action 분리
- 상세 sheet state persistence 유지
- leg별 path/marker/vehicle/provider 안내
- 장소 검색 debounce, 이전 요청 취소, stale result 방지
- safe-area-context 전환과 width/fontScale 기반 2열/1열 responsive layout
- 숫자 keyboard Done/닫기와 keyboard avoidance
- 공용 오류 code-to-copy mapping
- loading 지연 안내, reduce motion, accessibility

Gate: Web과 iOS parity checklist를 같은 fixture로 통과한다.

### Phase 4 — iOS native provider hardening: 2~3일

- NAVER camera/path/marker와 인증 실패
- foreground location 권한·거부·좌표 fallback
- HealthKit sample 있음/0건/읽기 실패와 수동 fallback
- KakaoTalk 왕복·취소·fallback
- iPhone 12 Pro safe area, keyboard, Dynamic Type, VoiceOver screenshot 회귀

Gate: 실제 iPhone에서 provider별 독립 시나리오를 모두 통과한다.

### Phase 5 — lifecycle/offline/auth 안정화: 2일

- process 종료 뒤 route와 열린 상세 복원
- 5분 초과 foreground background refetch
- 같은 한국 날짜/다음 날짜 전환
- airplane mode에서 cached recommendation
- refresh timeout 뒤 120초 grace same-pair replay
- grace 이후 reuse family revoke
- logout/account switch/Keychain 잔존 검사

Gate: 저장 상태와 token family가 environment/user를 넘어 섞이지 않는다.

### Phase 6 — release hardening: 1~2일

- staging EAS profile을 store/preview/autoIncrement로 전환하고 submit ascAppId 분리
- public Expo config와 staging bundle/API/provider ID preflight
- Privacy Manifest report
- App Store privacy/HealthKit 설명
- `org.madcamp.chimap.staging` store build와 내부 TestFlight
- crash-free launch, cold start, network/power profile
- production guest smoke 뒤 mobile auth flag를 별도 승인으로 활성화

Gate: TestFlight 실제 기기 E2E와 rollback/maintenance 절차가 문서화돼 있다.

### Phase 7 — 외부 TestFlight와 App Store 전 Apple 로그인: 후속

- Apple provider/App ID/server credential과 production audience 설정
- 기존 Apple code의 최초/재로그인, refresh/logout/account deletion, grant revoke E2E
- production mobile config `appleEnabled=true` 승인
- Dark Mode를 도입한다면 light/dark semantic token, theme provider와 전체 screenshot
  matrix를 이 phase 또는 별도 UI phase에서 구현

Gate: Kakao와 동등한 Apple 로그인 및 account deletion을 production 실제 기기에서
검증한 뒤 외부 TestFlight를 시작한다.

## 13. 자동 검증과 수동 release gate

### 매 PR

현재 `apps/mobile/package.json`에는 별도 `lint` script가 없으므로 lint를 기존 release
gate로 적지 않는다. lint 도입은 formatter/rule/CI 영향까지 정하는 별도 작업으로
분리한다. 현재 실제 검증 기준은 workspace boundaries, shared package build, mobile
typecheck/test, public Expo config, clean iOS prebuild, native verifier, pod install,
unsigned simulator compile이다.

```bash
pnpm boundaries:check
pnpm --filter @chimap/contracts build
pnpm --filter @chimap/app-core build
pnpm --filter @chimap/design-tokens build
pnpm --filter @chimap/mobile typecheck
pnpm --filter @chimap/mobile test
pnpm --filter @chimap/mobile exec expo config --type public
pnpm --filter @chimap/mobile exec expo prebuild \
  --clean --platform ios --no-install
node scripts/verify-mobile-native-config.mjs ios
```

Mac CI에서는 추가로 실행한다.

```bash
cd apps/mobile/ios
pod install
cd ../../..
xcodebuild \
  -workspace apps/mobile/ios/CHIMapStaging.xcworkspace \
  -scheme CHIMapStaging \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

### 실제 iPhone 필수 gate

다음 항목은 iOS 17 이상 실제 iPhone 12 Pro portrait에서 통과해야 한다.

1. guest 장소 검색·추천·NAVER 지도
2. foreground 위치 성공·거부
3. HealthKit 실제 steps, 빈 데이터 `0`, 읽기 실패와 수동 입력
4. KakaoTalk 성공·사용자 취소·KakaoTalk 미설치 browser fallback을 서로 다른
   결과로 처리
5. refresh/logout/account deletion; Apple 버튼은 `appleEnabled=false`에서 숨김
6. guest/current user/environment별 Query, Zustand, SecureStore 격리
7. 상세 sheet를 연 상태에서 process 종료·재실행 복원
8. offline launch와 foreground 5분 refetch
9. VoiceOver, Dynamic Type, Reduce Motion
10. notch와 Home Indicator 침범 없음
11. 390pt 폭에서 가로 잘림과 가로 scroll 없음
12. page sheet, 지도, 장소 검색 결과, 추천 카드가 세로 scroll로 모두 접근 가능
13. keyboard가 현재 걸음, 신체정보, 장소 검색, 추천 버튼을 가리지 않음
14. Dynamic Type 기본·접근성 크기에서 text와 button이 겹치지 않음
15. VoiceOver focus 순서가 보이는 화면 순서와 일치
16. 모든 control의 touch target이 최소 44pt

작은 iPhone과 Pro Max Simulator에서는 동일 flow의 responsive regression을 수행하고,
iPhone 12 Pro에서는 화면별 reference screenshot을 저장해 diff를 검토한다.

## 14. 운영 관측과 디버깅

development build에는 현재 환경과 API host를 보여 주는 숨겨진 diagnostics
화면을 추가한다. 다음 값만 표시한다.

- app version/build, `APP_ENV`, platform
- API hostname, contract version
- mobile config 수신 시각과 provider flag
- query cache 최종 성공 시각
- session 상태 guest/authenticated/expired

token, 사용자 ID, 검색어, 좌표, 건강정보는 표시하거나 log하지 않는다.

Xcode/Metro debugging 순서:

1. `/health`와 `/mobile-config`를 Mac `curl`로 확인
2. 앱 diagnostics에서 실제 API host 확인
3. Expo network inspector에서 status/timeout 확인
4. Xcode console에서 native SDK error code만 확인
5. server structured log를 request ID로 대조
6. provider dashboard의 bundle ID/Client ID/quota 확인

## 15. 자주 발생할 문제와 판단 기준

### Simulator는 되지만 iPhone이 Metro에 연결되지 않음

- 같은 Wi-Fi와 VPN/firewall을 확인한다.
- USB 첫 설치를 먼저 성공시킨다.
- Metro `--lan`이 막히면 `--tunnel`을 사용한다.
- API URL과 Metro URL을 혼동하지 않는다.

### iPhone이 Mac local API를 호출하지 못함

- `localhost` 대신 HTTPS tunnel을 사용한다.
- LAN IP를 쓴다면 Local Network purpose string과 ATS 설정을 development에서만
  검토한다.
- production에 arbitrary-load 예외를 추가하지 않는다.

### NAVER 지도가 인증 실패

- development bundle ID와 iOS Application 등록을 대조한다.
- generated Info.plist의 `NMFNcpKeyId`가 Android/Web ID가 아닌지 확인한다.
- 지도 Client ID와 server geocoding secret을 혼동하지 않는다.

### clean prebuild 뒤 signing/capability가 사라짐

- Xcode 수동 설정에 의존한 증거다.
- app config/config plugin 또는 명시적인 team build setting으로 옮긴다.
- verifier를 추가해 다시 발생하지 않게 한다.

### 앱 재설치 후 로그인 상태가 남음

- iOS Keychain/SecureStore의 정상 가능성이다.
- logout/account deletion 또는 development session reset을 실행한다.
- production 사용자 데이터를 임의로 지우는 debug button은 넣지 않는다.

### Web과 iOS 결과가 다름

- 같은 request fixture와 contract version인지 먼저 확인한다.
- server response가 같으면 client route selection/formatting 문제로 분리한다.
- Web component/CSS를 복사하지 말고 `app-core` 정책과 design token을 수정한다.

## 16. 완료 정의

iOS 로컬 개발 기반은 다음을 모두 만족해야 완료다.

- 새 Mac checkout에서 문서 명령만으로 workspace 생성·Xcode build 가능
- Xcode 수동 수정 없이 clean prebuild가 같은 entitlement/config를 재현
- Simulator와 iOS 17 이상 실제 iPhone 12 Pro가 HTTPS staging API와 통신
- production은 승인된 guest/release smoke 외에 개발 test로 오염되지 않음
- Web/iOS가 같은 계약·선택 규칙·문구·오류 의미를 사용
- core `SafeAreaView`가 제거되고 앱 root·일반 화면·page sheet가
  `react-native-safe-area-context`를 사용
- iPhone 12 Pro의 notch/Home Indicator를 침범하지 않고 390pt 폭에서 가로 잘림이나
  가로 scroll이 없음
- page sheet, 지도, 검색 결과, 추천 카드가 세로 scroll로 접근 가능하고 keyboard가
  현재 걸음·신체정보·장소 검색·추천 버튼을 가리지 않음
- Dynamic Type 기본·접근성 크기에서 text/button이 겹치지 않고 VoiceOver focus
  순서가 화면 순서와 일치하며 모든 touch target이 최소 44pt
- NAVER/Kakao/HealthKit/location 실제 기기 E2E 통과; Apple E2E는 외부 TestFlight 전
  phase의 완료 조건으로 분리
- eviction/offline/token grace/account cleanup 통과
- 다섯 GitHub CI job과 TestFlight release gate 통과
- iOS/Android/Web cache, Client ID, bundle ID, DB가 환경별로 충돌하지 않음
- staging store build가 `org.madcamp.chimap.staging`, EAS preview 환경, staging
  `ascAppId`로 내부 TestFlight에 배포되고 production App Store app과 분리됨

## 17. 공식 참고자료

- [Expo local app development](https://docs.expo.dev/guides/local-app-development/)
- [Expo development build 사용](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Expo Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)
- [Expo iOS Developer Mode](https://docs.expo.dev/guides/ios-developer-mode/)
- [Apple App Transport Security](https://developer.apple.com/documentation/security/preventing-insecure-network-connections)
- [Apple Local Network purpose string](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription)
- [Apple HealthKit 설정](https://developer.apple.com/documentation/healthkit/setting-up-healthkit)
- [Apple Sign in with Apple 설정](https://developer.apple.com/documentation/xcode/configuring-sign-in-with-apple)
- [NAVER Map iOS SDK 시작](https://navermaps.github.io/ios-map-sdk/guide-en/1.html)
- [Kakao iOS SDK 시작](https://developers.kakao.com/docs/ko/ios/getting-started)

## 18. 현재 구현과 필요한 변경 추적표

| 항목 | 현재 구현 상태 | 필요한 변경 | 담당 branch | 자동 검증 | iPhone 12 Pro 수동 검증 | 완료 조건 |
| --- | --- | --- | --- | --- | --- | --- |
| Source of truth/CNG | `apps/mobile/src`, `app.config.ts`, config plugin이 존재하고 staging clean prebuild/Pods가 성공; generated iOS는 ignore됨 | generated `apps/mobile/ios` 직접 수정·commit 금지 유지; Xcode는 실제 생성된 `CHIMapStaging.xcworkspace`에서 build/sign/log만 사용 | `feat/ios/*` | clean prebuild, native verifier, Git status | 유료 Development Team 서명 뒤 staging workspace 실행 | Xcode 수동 변경 없이 재생성 가능 |
| iOS 17/iPhone-only | working tree에 portrait, `supportsTablet=false`, built-in deployment target 17.0, Light가 반영됐고 config test/verifier/unsigned compile 통과 | source 설정 유지; 실제 기기 provisioning과 설치 gate 완료 | `feat/ios/*` | app config test, verifier의 pbxproj/device/style 검사 | iOS 17+ iPhone 12 Pro 설치 | deployment 17.0, iPhone-only, portrait/light 일치 |
| Safe Area | planner, bootstrap, Modal이 core `SafeAreaView` 사용 | root `SafeAreaProvider`, 모든 화면/sheet를 safe-area-context로 교체 | `feat/mobile/*` | component render test, core import 금지 검사 | notch/Home Indicator와 sheet inset 확인 | system 영역 침범 없음 |
| Responsive layout | 걸음·신체정보 `twoColumns`, account action row가 항상 가로 배치 | `useWindowDimensions`; width<390 또는 fontScale>=1.3이면 세로 배치 | `feat/mobile/*` | width/fontScale component test | 390×844pt, 작은 iPhone, 접근성 글자 크기 | 가로 잘림·scroll·text/button 겹침 없음 |
| Route 선택/상세 | `selectRoute`가 선택과 sheet open을 동시에 수행 | `selectRoute`와 `openDetail` 분리; 카드 선택은 지도만, `자세히`가 sheet open | `feat/mobile/*` | route-store migration/unit/component test | 카드 선택, 자세히, route 변경, 재실행 | 선택/상세가 독립되고 상태 복원 통과 |
| NAVER Map | 모든 leg 좌표를 단일 path로 합치고 첫 좌표 camera만 사용 | WALK/BUS/SUBWAY별 style, 출발·도착·승차·환승·하차/차량 marker, 전체 route camera fit | `feat/ios/*` | map-contract/overlay 변환 test | 긴/짧은/단일 좌표, marker, foreground 복귀 | 전체 경로와 의미별 overlay가 한 화면에 적절히 표시 |
| 장소 검색 | submit/button 요청만 있고 timeout AbortController만 존재 | debounce, 이전 요청 취소 signal, sequence/request key로 stale result 차단 | `feat/mobile/*` | fake timer·race·abort component test | 빠른 연속 입력, empty/error, keyboard search | 마지막 검색어 결과만 표시 |
| 숫자 keyboard | number/decimal pad에 완료 동작과 avoidance 없음 | Done/닫기 toolbar와 KeyboardAvoidingView 또는 동등 처리 | `feat/mobile/*` | focus/keyboard layout component test | 모든 숫자 입력 후 닫기와 추천 버튼 접근 | keyboard가 입력/action을 가리지 않음 |
| 접근성 | 일부 role/state와 44pt 입력은 있으나 전체 audit 없음 | touch target 44pt, VoiceOver label/focus, Dynamic Type wrap 보완 | `feat/mobile/*` | accessibility query/component test | 화면 순서대로 focus, 접근성 크기 screenshot | focus 순서·label·크기 gate 통과 |
| Theme | working tree의 `userInterfaceStyle=light`와 native Info.plist 검증 통과; token은 light 전용 | Light 고정과 screenshot 기준 유지; Dark Theme는 후속 semantic token/provider phase | `feat/ios/*` | app config test, verifier | Light Mode screenshot set | system Dark에서도 의도한 light UI로 일관 표시 |
| HealthKit 날짜 | 기기 local day로 조회하고 cache는 한국 날짜로 reset | 두 날짜 정책 문서화, timezone/자정 fixture, 0건 정상 처리와 중립적 오류 문구 | `feat/mobile/*` | local/Korean day boundary unit test | sample 있음, 0건, 읽기 실패, 수동 fallback | timezone 차이에도 걸음·cache 상태가 예측 가능 |
| Kakao/auth | exchange, refresh, logout, deletion 구현; login 오류는 한 문구로 합침 | 성공·사용자 취소·KakaoTalk 미설치 browser fallback을 구분해 UI/state 처리 | `feat/ios/*` | adapter/auth/session test | 세 Kakao 흐름과 refresh/logout/delete | staging에서 전체 session lifecycle 통과 |
| Apple 로그인 | adapter/contract/button 존재하고 mobile-config flag로 표시 제어 | 코드 유지, staging `appleEnabled=false`; 외부 TestFlight 전 provider E2E | `feat/ios/*`, 후속 | flag별 button test | 내부 build에서 미노출 확인 | 내부 범위에서 숨김, 외부 release 전 별도 gate |
| 저장 격리 | Query/Zustand는 environment·OS·owner hash, SecureStore는 environment·OS로 분리 | route/detail 분리 후 migration·cleanup regression 유지 | `feat/mobile/*` | persistence/auth-storage tests | guest→user→logout→다른 환경 전환 | cache/session이 owner/environment를 넘지 않음 |
| Staging API/auth | health/readiness 200, mobile-config guest/Kakao true·Apple false; bus route seed는 일부 준비됐고 subway는 0건. 첫 추천 cold 요청은 HTML 504 뒤 retry에서 FAST 1개로 성공. native NAVER ID 둘은 분리됐지만 DB/provider의 production 격리는 미확인 | subway seed 완료; cold recommendation latency/504 관찰·개선; 서버 배포/DB volume과 Kakao·NAVER console의 production 격리 확인 | `feat/api/*`, 계약 변경 시 `feat/contracts/*` | contract/API integration test, readiness/mobile-config, cold/warm recommendation smoke | staging hostname과 provider identity, guest/Kakao session lifecycle 확인 | 안정적인 cold 추천, 필요한 transit seed와 production DB/credential 완전 격리 |
| 실제 iPhone signing | iPhone 12 Pro 연결·pairing·Developer Mode·destination 확인; Personal Team이 Sign in with Apple을 지원하지 않아 provisioning 실패 | staging App ID의 HealthKit·Sign in with Apple capability를 지원하는 유료 Apple Developer Team을 Xcode에 추가하고 자동 서명 | `feat/ios/*` | signed device `xcodebuild` | 설치·launch·Metro와 전체 physical smoke | Apple entitlement를 유지한 staging Debug app이 실제 기기에서 실행 |
| EAS 내부 TestFlight | staging이 `distribution=internal`, submit staging 없음, owner/projectId 없음 | store/preview/staging/autoIncrement, staging ascAppId, project 연결, public config preflight | `feat/ios/*` | eas.json schema, public config/bundle/host verifier | 설치된 staging 앱의 이름·bundle·API 확인 | 별도 staging App Store Connect app 내부 TestFlight 배포 |
| CI | boundaries, shared build, mobile typecheck/test, config/prebuild/verifier, pod/xcodebuild 존재; deployment/device/style 검증도 working tree에서 통과했고 lint script는 없음 | 공용 UI 변경에 맞춘 component test 추가; lint는 별도 도입 전 gate에서 제외 | 책임 변경과 동일 branch | 기존 5개 CI job | CI build를 실제 기기 smoke와 대조 | 현재 존재하는 검증과 iPhone gate가 모두 통과 |
