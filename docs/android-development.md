# Android 개발·검증 운영서

이 문서는 CHIMap Android 앱의 현재 source of truth, VM과 로컬 Mac의 책임,
검증·배포 경계를 설명합니다. Android는 별도 Kotlin 앱이 아니라
`apps/mobile`의 Expo SDK 56·React Native 0.85.3 공용 앱입니다.

## 1. 코드와 생성물 경계

- 공용 화면·상태·API: `apps/mobile/src/features`
- 플랫폼 adapter: `apps/mobile/src/platform`
- package·권한·native plugin: `apps/mobile/app.config.ts`,
  `apps/mobile/plugins`
- 공용 계약·정책: `packages/contracts`, `packages/app-core`,
  `packages/design-tokens`
- 지도 bitmap: `apps/mobile/src/platform/maps/images`
- `apps/mobile/android`와 `apps/mobile/ios`는 Expo CNG 생성물입니다. 직접 수정하거나
  Git에 commit하지 않습니다.

웹 정적 이미지는 `apps/web/public/images`에 두며 모바일 native 지도 이미지와
섞지 않습니다. 사용처가 없는 원본·변환 이미지는 production Docker context에
남기지 않습니다.

## 2. 환경별 identity

| 환경 | package | API |
| --- | --- | --- |
| development | `org.madcamp.chimap.dev` | local 개발 API |
| staging | `org.madcamp.chimap.staging` | `https://staging.chimap.madcamp-kaist.org` |
| production | `org.madcamp.chimap` | `https://chimap.madcamp-kaist.org` |

NAVER iOS·Android·Web Client ID는 서로 분리합니다. `KAKAO_NATIVE_APP_KEY`와
모바일 Client ID는 public identifier이지만 `.env`, keystore, Play service account
JSON은 Git에 넣지 않습니다. 서버 REST key, DB URL, session secret은 모바일
환경이나 bundle에 넣지 않습니다.

## 3. VM과 로컬 Mac 책임

VM은 production/staging API·PostgreSQL·로그·Prometheus·Compose만 운영합니다.
Android Studio, JDK, SDK, ADB, EAS, Play signing credential은 로컬 Mac에서
관리합니다. 양쪽은 파일을 복사하지 않고 Git commit SHA와 privacy-safe request
ID로 문제를 대조합니다.

로컬 Mac은 저장소 루트를 VS Code workspace로 열고 다음을 담당합니다.

- Node 24.18.x, pnpm 10.15.1, JDK 17, Android SDK 36
- Samsung Android 14+ 실기기 staging 검증
- clean Expo prebuild, native config verifier, debug/release build
- EAS project, AAB, Play Internal 제출과 signing key hash 등록

VM 로그에는 검색어, 좌표, 걸음 raw record, access/refresh token을 남기지 않습니다.

## 4. 공용 동작 호환성

- Web·iOS·Android는 `transit-v2` 경로 계약과 추천 순위·ETA·요금·환승 의미를
  공유합니다.
- `APPROXIMATE` 도보·버스 구간은 흐린 점선, `DETAILED`는 실선입니다.
- 출발·환승·도착 마커는 `@chimap/app-core`에서 파생하며 개별 승하차 마커를
  반복하지 않습니다.
- 버스 진행 방향은 공용 방위 계산을 사용하고 5m 미만 GPS 흔들림에는 직전 방향을
  유지합니다.
- 도착시각은 host timezone과 무관하게 `Asia/Seoul`로 표시합니다.

공용 UI나 `app-core`가 바뀌면 mobile unit test뿐 아니라 iOS·Android 각각의 clean
prebuild와 native compile을 모두 통과해야 합니다.

## 5. 로컬 검증

공개 identifier가 든 `apps/mobile/.env`를 shell에 주입한 뒤 실행합니다.

```bash
set -a
source apps/mobile/.env
set +a

pnpm --filter @chimap/contracts build
pnpm --filter @chimap/app-core build
pnpm --filter @chimap/design-tokens build
pnpm --filter @chimap/mobile typecheck
pnpm --filter @chimap/mobile test

pnpm --filter @chimap/mobile exec expo prebuild \
  --clean --platform android --no-install
node scripts/verify-mobile-native-config.mjs android
cd apps/mobile/android
./gradlew :app:assembleDebug --no-daemon --max-workers=2
```

iOS 호환성은 같은 commit에서 `--platform ios`, iOS verifier, unsigned simulator
compile로 확인합니다. CI의 다섯 gate는 Web/API, Mobile JS, iOS native, Android
native, PostGIS입니다.

## 6. 실기기 필수 시나리오

- KakaoTalk 성공·취소·Account fallback·로그아웃·계정 삭제
- NAVER 지도 인증, 실제 지하철 선형, 버스/도보 상세·근사 점선
- `대전역` 정확 검색 우선과 현재 위치 권한 허용·거부
- Health Connect 지원·업데이트 필요·권한 거부·0건·복수 origin
- foreground/background, force-stop, offline cache 복원
- gesture/3-button back, keyboard, system bar, fontScale 2.0, TalkBack

## 7. Play 배포 경계

첫 production package AAB는 Play Console Internal track에 수동 업로드합니다.
Play App Signing certificate의 Kakao key hash와 production NAVER package를 등록한
뒤 internal 설치본으로 provider E2E를 반복합니다. service account JSON은 최소
권한으로 EAS에만 등록하고 저장소에 보관하지 않습니다.

Internal 설치와 E2E 전에는 production rollout을 실행하지 않습니다. closed test,
계정별 테스트 인원·기간, open/production staged rollout은 별도 승인 단계입니다.
