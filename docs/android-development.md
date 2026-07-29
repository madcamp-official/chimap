# CHIMap Android 개발·Play Internal 운영

이 문서는 Expo SDK 56 / React Native 0.85.3 공용 앱을 Android에서 개발하고,
Galaxy 실기기 staging 검증을 거쳐 `org.madcamp.chimap` AAB를 Play Internal의
draft로 올리는 기준 절차입니다. backend/Web 배포와 production rollout은 이
절차의 범위가 아닙니다.

## 1. 고정 환경과 저장소 원칙

로컬 기준 버전은 다음과 같습니다.

- Node.js 24, pnpm 10.15.1
- JDK 17
- Android Studio와 Android SDK Platform 36
- Android Build Tools 36.0.0
- Android Platform Tools
- Android Command-line Tools 최신판
- NDK 27.1.12297006
- bundletool 1.18.3 이상

`apps/mobile/android`와 `apps/mobile/ios`는 Expo CNG 산출물입니다. 항상 clean
prebuild로 다시 만들며 Git에 추가하거나 generated Gradle/Manifest 파일을 직접
수정하지 않습니다. 네이티브 변경은 `app.config.ts` 또는 config plugin에 둡니다.

저장소 루트의 `app_icon.png`은 canonical 원본입니다. 원본을 덮어쓰지 않으며
파생 자산은 `apps/mobile/assets/branding`에서 관리합니다.

공용 브랜드는 `apps/mobile/src/components/images/logo.png`과
`apps/web/public/images/logo.png`의 동일 PNG를 사용합니다. 두 파일의 SHA-256은
`d28d13cfa0bb057925f5024b98a8cbe5952e52c75fafcb61a805f2b722bec9b7`이며,
색상·비율·투명 여백을 임의로 바꾸지 않습니다. 지도 bitmap은
`apps/mobile/src/platform/maps/images`에만 둡니다.

### 공용 동작 호환성

- Web·iOS·Android는 `transit-v2` 경로 계약과 추천 순위·ETA·요금·환승 의미를
  공유합니다.
- `APPROXIMATE` 도보·버스 구간은 흐린 점선, `DETAILED`는 실선입니다.
- 출발·환승·도착 마커는 `@chimap/app-core`에서 파생하며 개별 승하차 마커를
  반복하지 않습니다.
- 버스 진행 방향은 공용 방위 계산을 사용하고 5m 미만 위치 흔들림에는 직전
  방향을 유지합니다.
- 도착시각은 host timezone과 무관하게 `Asia/Seoul`로 표시합니다.
- 최초 목표는 만 18~59세 8,000보, 만 60~90세 7,000보이며 기존 사용자 목표를
  자동으로 덮어쓰지 않습니다.

## 2. macOS 개발 환경 설치

Homebrew 기준 설치 예시는 다음과 같습니다. JDK는 Temurin 17 또는 OpenJDK 17
중 하나만 활성화하면 됩니다.

```bash
brew install node@24 openjdk@17 bundletool
brew install --cask android-studio android-commandlinetools
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
corepack enable
corepack prepare pnpm@10.15.1 --activate
```

bundletool은 AAB의 protobuf Manifest를 XML로 해석해 EAS/Play 산출물도 APK 없이
직접 검사하는 데 사용합니다.

현재 셸에 Android/JDK 경로를 고정합니다. 사용자별 SDK 경로가 다르면
`ANDROID_HOME`만 실제 위치로 바꿉니다.

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

필수 SDK를 설치하고 라이선스에 동의합니다.

```bash
sdkmanager \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "cmdline-tools;latest" \
  "ndk;27.1.12297006"
yes | sdkmanager --licenses
```

설치 확인:

```bash
node --version
pnpm --version
java -version
adb version
sdkmanager --list_installed
```

EAS CLI는 전역 설치하지 않습니다. 모든 EAS 명령은 `pnpm dlx eas-cli`로
실행합니다.

EAS profile은 Node 24와 pnpm 10.15.1을 명시하고 `corepack` 옵션은 사용하지
않습니다. EAS worker는 profile의 pnpm을 global로 설치하므로, Node 24에서 먼저
Corepack shim을 활성화하면 같은 실행 파일 경로가 충돌해 `EEXIST`로 builder가
중단됩니다. 로컬과 CI는 workspace root의 `packageManager`를 통해 같은 pnpm 버전을
사용합니다.

## 3. 환경 변수와 secret 경계

`apps/mobile/.env`에는 client binary에 포함될 수 있는 다음 값만 둡니다.

```dotenv
APP_ENV=staging
EXPO_PUBLIC_API_BASE_URL=https://staging.chimap.madcamp-kaist.org
KAKAO_NATIVE_IOS_APP_KEY=
KAKAO_NATIVE_ANDROID_APP_KEY=
NAVER_MAP_CLIENT_ID_IOS=
NAVER_MAP_CLIENT_ID_ANDROID=
```

다음 값은 `.env`에 두지 않습니다.

- `EXPO_TOKEN`
- Play service-account JSON 또는 그 경로
- Android keystore와 password
- Kakao REST key/OAuth client secret
- NAVER server secret
- DB, session, refresh-token 암호화 secret

EAS `preview` environment에는 staging의 다섯 공개 build 값(API URL과 네 native
client key)을, `production` environment에는 production 값을 별도로 등록합니다.
`APP_ENV`는 `eas.json` profile이 고정합니다. production API URL은
`https://chimap.madcamp-kaist.org`만 허용됩니다.

Expo 인증 토큰이 필요한 CI에서는 CI secret store를 사용합니다. 개발자 로그인은
interactive `pnpm dlx eas-cli login`을 사용하고 토큰을 파일로 저장하지 않습니다.

## 4. CNG와 로컬 검증

처음 설치하거나 lockfile이 바뀌었을 때:

```bash
pnpm install --frozen-lockfile
pnpm boundaries:check
pnpm --filter @chimap/contracts build
pnpm --filter @chimap/app-core build
pnpm --filter @chimap/design-tokens build
pnpm --filter @chimap/mobile typecheck
pnpm --filter @chimap/mobile test
```

환경 파일은 출력하지 않고 현재 셸에만 로드합니다.
```bash
set -a
source apps/mobile/.env
set +a
```

Android clean prebuild와 generated config 검증:

```bash
pnpm --filter @chimap/mobile exec expo prebuild \
  --clean --platform android --no-install
node scripts/verify-mobile-native-config.mjs android
```

iOS까지 포함한 공용 config 회귀 검증:

```bash
pnpm --filter @chimap/mobile exec expo prebuild --clean --no-install
node scripts/verify-mobile-native-config.mjs all
```

검증기는 package/bundle ID, SDK, versionCode, cleartext, NAVER provider ID 분리,
Kakao scheme, adaptive/monochrome icon, foreground location와 READ_STEPS만 허용되는지,
server secret이 generated project에 들어가지 않았는지를 검사합니다. 향후 추가되는
native Android Dialog에도 안전한 기본값이 적용되도록 CNG plugin이 흰 화면용 dark
status icon theme을 생성하는지도 함께 검사합니다.

작업 뒤 `git status --short`에서 generated `android/ios`가 나타나거나 tracked diff가
생기면 안 됩니다.

## 5. 로컬 APK/AAB와 16KB 검사

Galaxy와 Play용 로컬 검증은 arm64만 빌드해 시간을 줄일 수 있습니다. CI는 전체
기본 ABI를 빌드합니다.

```bash
cd apps/mobile/android
./gradlew \
  :app:assembleDebug \
  :app:assembleRelease \
  :app:bundleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon --max-workers=2
cd ../../..
```

release 산출물 검사:

```bash
APP_ENV=development \
EXPECTED_ANDROID_VERSION_CODE=1 \
node scripts/verify-android-release.mjs
```

검사 범위는 application ID, versionCode, min/target SDK, release debuggable 여부,
Manifest 권한, arm64 포함, `arm64-v8a`/`x86_64` `.so`의 ELF LOAD 16KB 정렬,
AAB `PAGE_ALIGNMENT_16K`, APK `zipalign -P 16`, forbidden permission과 server
secret 부재입니다. Android의 16KB Play gate는 64비트 기기 대상이므로 32비트
`armeabi-v7a`/`x86` ELF 정렬은 이 판정에 포함하지 않습니다.

EAS에서 내려받은 AAB는 bundletool을 사용해 단독으로 같은 manifest/ELF/secret
검사를 실행합니다. EAS build 상세의 versionCode를 반드시 명시합니다.

```bash
APP_ENV=production \
EXPECTED_ANDROID_VERSION_CODE=<EAS_VERSION_CODE> \
node scripts/verify-android-release.mjs --aab-only ./chimap-production.aab
```

검사 실패 시 출력된 `.so`를 APK/AAB의 경로로 소유 dependency에 매핑합니다.
third-party binary는 16KB 호환 버전으로 교체합니다. first-party C/C++만 CNG
plugin에서 flexible-page-size linker option을 추가하고 generated Gradle 파일은
수정하지 않습니다.

## 6. Galaxy S25+ USB 연결

휴대폰에서 개발자 옵션과 USB 디버깅을 켜고, data 전송이 가능한 케이블로 Mac에
직접 연결합니다. 최초 연결 시 휴대폰의 RSA 허용 dialog를 승인합니다.

```bash
adb kill-server
adb start-server
adb devices -l
adb get-state
adb shell getprop ro.product.model
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abi
adb shell getconf PAGE_SIZE
```

정상 기준은 Galaxy S25+, API 34 이상, `arm64-v8a`, state `device`입니다. 보고서와
issue에는 `adb devices`의 serial을 붙이지 않습니다. `unauthorized`면 휴대폰의
USB debugging authorization을 취소 후 다시 승인합니다. 장치가 목록에 전혀 없으면
USB mode, cable, hub, macOS System Information 순서로 확인합니다.

실기기가 4096 page size이면 API 35/36의 16KB emulator를 별도로 사용합니다.

```bash
sdkmanager "system-images;android-36;google_apis_playstore_ps16k;arm64-v8a"
```

Android Studio Device Manager에서 이 image로 AVD를 만든 뒤 emulator 안에서
`getconf PAGE_SIZE`가 `16384`인지 확인합니다.

## 7. staging-device 설치

`staging-device`는 Metro 없이 동작하는 standalone internal APK입니다.

```bash
pnpm dlx eas-cli whoami
pnpm dlx eas-cli build --platform android --profile staging-device
```

다운로드한 APK는 다음처럼 설치합니다. package는 staging 전용
`org.madcamp.chimap.staging`이어야 합니다.

```bash
adb install -r ./chimap-staging.apk
adb shell pm list packages | rg org.madcamp.chimap.staging
adb shell monkey -p org.madcamp.chimap.staging 1
```

서명이나 application ID가 다른 기존 앱 때문에 install이 실패하면 앱 데이터가
필요한지 먼저 확인합니다. 삭제는 데이터를 지우는 작업이므로 사용자 승인 없이
`adb uninstall`하지 않습니다.

## 8. logcat 개인정보 점검

테스트 시작 전에 logcat을 비우고 앱 process만 관찰합니다.

```bash
adb logcat -c
adb shell pidof org.madcamp.chimap.staging
adb logcat --pid="$(adb shell pidof org.madcamp.chimap.staging)"
```

다음 정보가 원문으로 기록되면 release blocker입니다.

- 검색어와 출발/도착 장소
- GPS 좌표
- 걸음 record, 일별 count의 원자료, `dataOrigins`
- access/refresh token, authorization header
- Kakao/NAVER SDK 원문 오류나 native key

앱 로그는 분류된 error code와 request ID만 남겨야 합니다. 공유 전에 serial,
request ID와 계정 식별자를 마스킹합니다.

## 9. Galaxy staging E2E 체크리스트

### 인증과 세션

- [ ] KakaoTalk 설치 상태에서 native handoff와 callback 성공
- [ ] KakaoTalk 미설치 상태에서 account login 성공
- [ ] 사용자 취소는 fallback 없이 취소로 종료
- [ ] callback/handoff/empty-token 복구 실패만 account login으로 전환
- [ ] key hash/package/KOE/401/403 오류는 fallback하지 않고 분류 안내
- [ ] 로그인 유지, 앱 재실행, access refresh rotation
- [ ] logout 뒤 secure local namespace 제거
- [ ] 계정 삭제 뒤 서버 세션과 local namespace 제거

### 지도와 경로

- [ ] NAVER 지도 초기화와 실패 fallback 영역 격리
- [ ] 정부청사역 곡선 선로 geometry
- [ ] 514번 버스 geometry와 차량 marker
- [ ] approximate geometry의 dashed line
- [ ] 출발/환승/도착/차량 marker와 endpoint 우선 z-index
- [ ] 같은 위치의 환승 marker 중복 제거
- [ ] 환승 없는 경로에는 출발·도착 marker만 표시
- [ ] “대전역” 검색 정확도
- [ ] FAST/BALANCED/GOAL 추천, ETA·요금·환승·상세 단계
- [ ] 지도 실패 중에도 추천 카드와 상세 단계 사용 가능

### Health Connect와 위치

- [ ] 기존 Health Connect 권한으로 자동 bootstrap/foreground refresh
- [ ] 자동 refresh가 permission dialog를 열지 않음
- [ ] “현재 걸음 새로고침”에서만 권한 요청
- [ ] 허용, 거부, 0건, provider update required, read failure
- [ ] Samsung Health 복수 origin에서 aggregate total 중복 제거
- [ ] `dataOrigins`가 전송·로그되지 않음
- [ ] 수동 걸음 입력 fallback
- [ ] 위치 precise/approximate 허용, 거부, 서비스 off
- [ ] 위치 거부 후에도 장소 검색과 수동 입력 가능
- [ ] background/foreground, force-stop, offline cache 복구

### Android UI와 접근성

Android 아이콘은 `expo-symbols`의 Material Symbols source를 고정 크기 이미지로
렌더링합니다. 장식 아이콘은 TalkBack 트리에서 제외하고 시스템 font scale에 의해
아이콘 자체가 잘리지 않게 하며, 버튼의 의미는 부모 `accessibilityLabel`이
전달합니다. font scale이 커지면 메인 header는 두 줄로 재배치되고 접힌 경로 sheet는
높이를 확보합니다. 검색·추천 결과가 있는 sheet 본문은 화면 높이 안에서 스크롤해야
합니다. RN 0.85의 Android Dialog는 흰 화면에서도 main screen의 light status icon을
복사하므로 계정·상세 화면은 동일 Activity의 full-screen accessibility overlay로
표시하고, iOS는 native page sheet를 유지합니다. 선택한 추천 경로는 재실행 후
복원하지만 상세 modal의 열린 상태는 복원하지
않습니다. cold start에서 메인 지도와 상세 지도를 동시에 생성하지 않기 위한 native
map 생명주기 원칙입니다.

- [ ] gesture back과 3-button back 모두 modal → sheet → screen 순서
- [ ] keyboard resize와 sheet CTA bottom safe area
- [ ] main status icon light, 흰 modal status icon dark
- [ ] fontScale 2.0에서 header/검색/추천 카드/상세 단계 무잘림
- [ ] 모든 control 48dp 또는 동등 hitSlop
- [ ] TalkBack이 버튼 목적과 권한/로딩/선택 상태를 읽음

### 개인정보

- [ ] log에 검색어, GPS, 걸음 record/origin 없음
- [ ] access/refresh token과 SDK 원문 오류 없음
- [ ] 앱 권한에 background location, location foreground service 없음
- [ ] release 앱 권한에 `SYSTEM_ALERT_WINDOW` 없음
- [ ] health write/background/history permission 없음

각 실패는 build profile, app version/versionCode, Android API, 재현 단계, 기대/실제
결과만 기록하고 device serial과 개인정보는 기록하지 않습니다.

## 10. EAS project와 build profile

허용되는 운영 인터페이스는 다음뿐입니다.

- `development`: development package의 dev client APK
- `staging-device`: staging package/API의 standalone internal APK
- `play-internal`: production package/API의 store AAB, remote versionCode 증가
- `submit.play-internal`: Play internal track의 draft

production track submit profile은 의도적으로 존재하지 않습니다.

```bash
pnpm dlx eas-cli whoami
pnpm dlx eas-cli project:info
```

로그인된 Expo 계정에 project가 없을 때만 다음을 실행합니다.

```bash
cd apps/mobile
pnpm dlx eas-cli init
cd ../..
```

명령이 반환한 `owner`와 `projectId`만 Expo config에 반영합니다. 임의 project ID를
작성하지 않습니다.

production AAB 생성:

```bash
pnpm dlx eas-cli build --platform android --profile play-internal
```

EAS remote version source가 신규 앱의 versionCode 1부터 관리하는지 build 상세에서
확인합니다. 첫 Play 업로드 전에는 EAS Submit을 실행하지 않습니다.

## 11. Play Internal 첫 업로드

1. Play Console에 새 Android 앱을 만들고 package를 `org.madcamp.chimap`으로
   확인합니다.
2. Play App Signing을 활성화합니다.
3. `play-internal` AAB를 내려받아 `--aab-only` artifact verifier를 다시 실행합니다.
4. 첫 AAB는 Console에서 Internal testing release의 draft로 수동 업로드합니다.
5. Play App Signing SHA-1에서 Kakao key hash를 만들어 production Kakao platform에
   등록합니다.
6. production NAVER Maps Application에 `org.madcamp.chimap`을 등록합니다.
7. internal tester를 추가하고 Play 설치본에서 Galaxy E2E 전체를 재실행합니다.
8. pre-launch report의 blocking crash/ANR이 0인지 확인합니다.

첫 수동 업로드가 성공한 뒤에만 app-scoped 최소 release 권한 service account를
연결하고 아래 submit을 검증합니다.

```bash
pnpm dlx eas-cli submit --platform android --profile play-internal
```

이 명령도 internal draft만 대상으로 합니다. production rollout은 실행하지 않습니다.

## 12. 출시 gate와 rollback

다음 항목이 준비되지 않으면 Internal draft 이후로 진행하지 않습니다.

- Data Safety 응답
- Health Apps declaration
- 공개 개인정보처리방침 URL
- 로그인 없이 접근 가능한 외부 계정 삭제 URL
- Play pre-launch report blocking crash/ANR 0건
- Play 서명 설치본 전체 E2E 통과

rollback은 이전 정상 commit을 새 remote versionCode로 다시 build해 internal track에
업로드하는 방식입니다. 기존 versionCode를 재사용하거나 production track으로
승격하지 않습니다. server/Web rollback과 mobile artifact rollback은 서로 독립적으로
수행합니다.

## 13. 단계 종료 보고 형식

각 build/test 단계가 끝나면 다음을 남깁니다.

- 변경된 동작과 파일
- 실행한 자동 테스트와 결과
- app version, versionCode, profile, application ID
- 실기기에서 아직 확인하지 못한 항목
- Expo/Kakao/NAVER/Play Console blocker
- 정책 URL과 declaration gate 상태

완료 표시는 자동 검증, Galaxy staging, Play 서명 설치본 E2E가 모두 통과하고 외부
정책 gate가 해소된 뒤에만 사용합니다.
