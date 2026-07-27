# iOS 로컬 개발 운영서

이 문서는 Expo/React Native CNG 기반 CHIMap iOS 앱을 Mac과 Xcode에서 개발하는
기준입니다. 기준 기기는 iOS 17 이상 실제 iPhone 12 Pro이며, 첫 내부
TestFlight는 staging 전용 앱으로 guest·HealthKit·Kakao와 전체 CHIMap session
lifecycle을 검증합니다.

## 1. 확정 범위

| 항목 | 기준 |
| --- | --- |
| frontend | `apps/mobile` React Native 0.85.3 + Expo SDK 56 |
| native 생성 | Expo CNG |
| 기준 기기 | iPhone 12 Pro, portrait, iOS 17+ |
| reference viewport | 390×844pt @3x, layout 상수로 사용 금지 |
| 지원 기기 | iPhone only |
| 첫 theme | Light 고정 |
| API | `https://staging.chimap.madcamp-kaist.org` |
| bundle ID | `org.madcamp.chimap.staging` |
| 인증 | guest + Kakao, Apple 코드는 유지하고 flag로 숨김 |
| health | HealthKit read only, background delivery 없음 |
| 첫 배포 | 별도 staging App Store Connect 앱의 내부 TestFlight |

Apple 로그인 E2E와 production audience/provider credential은 외부 TestFlight 전
후속 단계입니다. 내부 build에서 `mobile-config.authentication.appleEnabled`가
`false`이면 버튼을 표시하지 않습니다.

## 2. Source of truth

```text
apps/mobile/src                 공용 React Native 화면·state·API orchestration
apps/mobile/src/platform       iOS/Android SDK adapter
apps/mobile/app.config.ts      bundle, plist, entitlement, native key
apps/mobile/plugins            CNG native 변경
packages/contracts             Web/API/Mobile request·response 계약
packages/app-core              React 비의존 날짜·cache·선택 정책
packages/design-tokens         의미 기반 색·간격·radius
apps/mobile/ios                로컬 생성물, Git commit 금지
```

Xcode에서 지속되어야 할 설정은 generated project에만 남기지 않습니다.

- plist·entitlement·build setting → `app.config.ts` 또는 config plugin
- native dependency → package/config plugin
- iOS 동작 → `src/platform/*.ios.*`
- 공용 화면 → `src/features`

`expo prebuild --clean` 뒤에도 같은 project가 생성되어야 합니다.

## 3. Git 운용

장기 `ios` branch를 만들지 않고 책임별 단기 branch를 사용합니다.

- `feat/ios/*`: signing, entitlement, iOS SDK, Xcode/archive
- `feat/mobile/*`: iOS·Android 공용 RN UI/state/API
- `feat/contracts/*`: additive API 계약
- `feat/api/*`: backend와 staging migration/config

foundation이 `main`에 병합되기 전에는
`origin/feat/mobile/cross-platform-foundation`을 기준으로 합니다. 현재 서버에서
확인한 기준선은 `7a99e03`입니다. Mac의 변경을 버리지 않고 fetch/fast-forward
가능 여부를 먼저 확인합니다.

```bash
git status --short
git fetch origin --prune
git log --oneline --decorate -10
```

generated `apps/mobile/ios`, `.expo`, `dist`, `.env.local`은 commit하지 않습니다.

## 4. Mac 환경 파일

파일:

```text
/Users/seojinlee/Desktop/chimap_monorepo/apps/mobile/.env.local
```

내용:

```dotenv
APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org
NAVER_MAP_CLIENT_ID_IOS=
NAVER_MAP_CLIENT_ID_ANDROID=
KAKAO_NATIVE_APP_KEY=
```

현재 Expo config가 두 native ID를 함께 검증하므로 iOS만 작업해도 Android ID가
필요합니다. iOS·Android ID를 같은 값으로 두거나 Web ID를 임시 복사하지
않습니다. mobile binary에 다음 server 값을 넣지 않습니다.

- `NAVER_MAP_NCP_KEY`
- `KAKAO_REST_API_KEY`, `KAKAO_APP_ID`, OAuth Client Secret
- `DATABASE_URL`, PostgreSQL password
- `AUTH_SESSION_SECRET`, refresh retry encryption key
- Apple `.p8`

검증:

```bash
git check-ignore -v apps/mobile/.env.local

set -a
source apps/mobile/.env.local
set +a

pnpm --filter @chimap/mobile exec expo config --type public
```

`apiBaseUrl`, staging bundle와 공개 Client ID만 확인하고 key 전체를 작업 기록에
복사하지 않습니다.

## 5. Staging 사전 점검

Xcode보다 먼저 API를 확인합니다.

```bash
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/health
curl -fsS https://staging.chimap.madcamp-kaist.org/api/v1/mobile-config
curl -sS -w '\nHTTP %{http_code}\n' \
  https://staging.chimap.madcamp-kaist.org/api/v1/readiness
```

내부 범위의 기대값:

```json
{
  "guestEnabled": true,
  "kakaoEnabled": true,
  "appleEnabled": false
}
```

readiness 503이면 응답의 DB/provider/transit 통계를 확인합니다. production URL로
fallback하거나 ATS arbitrary-load 예외를 추가하지 않습니다. 서버 seed와 운영은
[staging 환경 운영서](./staging-environment.md)를 따릅니다.

## 6. Config 완료 조건

첫 내부 TestFlight 전에 `app.config.ts`, config test와 native verifier가 다음을
함께 보장해야 합니다.

- `orientation="portrait"`
- `ios.supportsTablet=false`
- `userInterfaceStyle="light"`
- `expo-build-properties` built-in `ios.deploymentTarget="17.0"`
- staging bundle `org.madcamp.chimap.staging`
- scheme `chimap-staging`
- `NMFNcpKeyId`에 iOS Client ID
- HealthKit usage description·entitlement
- HealthKit background delivery 비활성
- Kakao staging Native key와 URL scheme
- Apple code/entitlement 유지, UI는 server flag로 제어
- server secret 미포함

2026-07-27 `7a99e03` 기준 남은 source gap:

- `userInterfaceStyle`은 아직 `automatic`
- built-in iOS deployment target 17.0 명시·검증 없음
- `eas.json` staging은 아직 Ad Hoc `distribution="internal"`
- Expo owner/project ID와 staging/production `ascAppId` 미입력

이 항목은 확인되지 않은 완료로 표시하지 않습니다.

## 7. Clean prebuild와 Xcode

저장소 루트에서 mobile 환경을 export한 같은 shell을 사용합니다.

```bash
pnpm install --frozen-lockfile
pnpm boundaries:check
pnpm --filter @chimap/contracts build
pnpm --filter @chimap/app-core build
pnpm --filter @chimap/design-tokens build
pnpm --filter @chimap/mobile typecheck
pnpm --filter @chimap/mobile test

pnpm --filter @chimap/mobile exec expo prebuild \
  --clean --platform ios
```

prebuild가 Pods를 끝내지 못했다면:

```bash
cd apps/mobile/ios
pod install
cd ../../..
```

실제 생성된 workspace를 엽니다. `.xcodeproj`가 아니라 `.xcworkspace`입니다.

```bash
open apps/mobile/ios/*.xcworkspace
```

workspace와 scheme 이름을 문서 문자열로 추측하지 않고 생성 결과에서 찾습니다.
Xcode에서는 Development Team을 선택하고 실제 staging bundle ID가 유지되는지
확인합니다. signing 외의 영구 설정을 generated project에만 추가하지 않습니다.

## 8. Simulator와 실제 기기

설치된 runtime 확인:

```bash
xcrun simctl list devices available
```

우선 iOS 17+ iPhone 12 Pro Simulator를 쓰고, 없으면 다른 iOS 17+ Simulator에서
unsigned compile만 확인한 뒤 기준 기기 미검증을 기록합니다. CI와 로컬 compile은
실제 생성된 workspace/scheme으로 다음 조건을 사용합니다.

```text
configuration: Debug
destination: generic/platform=iOS Simulator
CODE_SIGNING_ALLOWED=NO
```

HealthKit sample, KakaoTalk 왕복, 위치와 실제 safe area는 Simulator 결과로 완료
처리하지 않습니다. 실제 iPhone 12 Pro에서 다음을 준비합니다.

- Mac 신뢰와 USB 첫 설치
- iPhone Developer Mode
- iOS 17 이상
- Health 앱의 오늘 sample 또는 의도적인 빈 상태
- KakaoTalk 설치/미설치 시나리오

## 9. Metro와 API 연결

Metro는 Development Build의 JavaScript를 제공하고, staging API는 공개 HTTPS로
독립 연결됩니다.

```bash
set -a
source apps/mobile/.env.local
set +a

pnpm --filter @chimap/mobile start -- --dev-client --lan --clear
```

실제 기기가 Metro에 연결되지 않으면 같은 Wi-Fi, VPN/firewall, USB 첫 설치를
확인하고 LAN이 막힐 때만 Expo tunnel을 씁니다. API URL은 localhost나 production으로
바꾸지 않습니다.

## 10. Provider별 검증

### NAVER

- iOS Client ID Application에 `org.madcamp.chimap.staging` 등록
- generated plist `NMFNcpKeyId` 확인
- 인증 실패 시 Web/Android ID 혼입과 quota부터 확인
- 지도 장애와 추천 API 장애를 별도 UI 상태로 처리

### Kakao

- 같은 CHIMap Kakao 앱의 추가 `staging-mobile` Native key 사용
- Native key에 staging Bundle ID 등록
- KakaoTalk 성공·사용자 취소·미설치 browser fallback 구분
- provider access token을 log·장기 저장하지 않음
- server 교환 뒤 CHIMap refresh token만 SecureStore에 저장

### HealthKit

- read only
- 오늘 local-day 범위와 한국 날짜 기반 추천 cache 기준을 혼동하지 않음
- sample 있음, 빈 결과 `0`, 권한 거부를 별도 검증
- background delivery 비활성

### Lifecycle/auth

- 상세 sheet를 연 상태로 process 종료 후 복원
- online·활성·같은 한국 날짜·5분 초과 query만 foreground quiet refetch
- offline cache launch
- refresh timeout 뒤 120초 grace에서 같은 token pair 재생
- grace 이후 reuse family revoke
- logout/account deletion 후 token과 user namespace 잔존 검사

## 11. UI/UX 기준

iPhone 12 Pro `390×844pt`는 screenshot reference이며 고정 width/height가 아닙니다.

- safe area와 Home Indicator 침범 금지
- 가로 scroll·잘림 금지
- software keyboard와 sheet 충돌 금지
- `width < 390` 또는 큰 `fontScale`에서 복수 열을 세로로 전환
- Dynamic Type 기본/XL/접근성 크기
- VoiceOver label·순서·button role
- Reduce Motion
- 44pt 이상 touch target
- 한국어 긴 장소·노선명

Web과 픽셀을 복사하지 않고 정보 구조, 문구, 경로 선택 규칙, 오류 의미와 design
token을 공유합니다. Web component/CSS를 mobile에서 import하지 않습니다.

## 12. 첫 내부 TestFlight

Xcode 실기기 gate 뒤 staging EAS profile을 다음 방향으로 전환합니다.

- `distribution="store"`
- EAS environment `preview`
- `APP_ENV=staging`
- `autoIncrement=true`
- 별도 staging App Store Connect app과 `ascAppId`
- bundle `org.madcamp.chimap.staging`

EAS environment에도 Mac과 같은 공개 다섯 값을 넣고 server secret은 넣지
않습니다. Apple UI는 계속 숨기며 내부 TestFlight에서 guest, HealthKit, NAVER,
Kakao, refresh/logout/account deletion과 eviction/offline을 확인합니다.

## 13. 완료 gate

- clean checkout에서 같은 workspace 생성
- config test와 native verifier 통과
- unsigned simulator compile 통과
- 실제 iPhone 12 Pro staging 설치
- staging health/readiness 200과 mobile config flag 일치
- NAVER/Kakao/HealthKit/location 실제 기기 E2E
- process eviction·offline·5분 refetch·120초 refresh grace
- 390pt safe area/keyboard/Dynamic Type/VoiceOver 통과
- production DB·credential·cache/session과 혼입 없음
- 생성 iOS와 `.env.local`이 Git에 포함되지 않음
- staging App Store Connect와 production record 분리
