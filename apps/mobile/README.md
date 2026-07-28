# CHIMap Mobile

`apps/mobile`은 iOS와 Android가 함께 사용하는 React Native + Expo
Development Build 애플리케이션입니다. `apps/ios`, `apps/android`처럼 소스를
복제하지 않습니다.

## 경계

- 공용 화면·상태·API 호출: `src/features`
- OS SDK 연결: `src/platform`의 `*.ios.ts`, `*.android.ts`
- API schema: `@chimap/contracts`
- 순수 선택/만료 정책: `@chimap/app-core`
- 의미 기반 색·간격: `@chimap/design-tokens`
- CNG 결과인 `ios/`, `android/`는 commit하지 않음

Android SDK, Galaxy 실기기, Health Connect, EAS Build와 Play Internal 운영 절차는
[`docs/android-development.md`](../../docs/android-development.md)를 기준으로 합니다.

Web DOM component, CSS, browser storage와 backend 내부 파일을 직접 import하지
않습니다. 루트의 `pnpm boundaries:check`가 이 규칙을 검사합니다.

## 환경과 application identity

| APP_ENV | iOS bundle ID / Android package |
| --- | --- |
| development | `org.madcamp.chimap.dev` |
| staging | `org.madcamp.chimap.staging` |
| production | `org.madcamp.chimap` |

`NAVER_MAP_CLIENT_ID_IOS`, `NAVER_MAP_CLIENT_ID_ANDROID`는 서로 다른 NAVER
Maps Application의 Client ID여야 합니다. production에서는 Web Client ID도
재사용할 수 없습니다. Kakao SDK는 `KAKAO_NATIVE_IOS_APP_KEY`와
`KAKAO_NATIVE_ANDROID_APP_KEY`를 플랫폼별로 사용합니다. Apple
server credential은 앱에 넣지 않고 API의 `APPLE_*` secret으로만 관리합니다.

## 실행

```bash
pnpm --filter @chimap/mobile native:prebuild
pnpm --filter @chimap/mobile ios --device
pnpm --filter @chimap/mobile android --device
pnpm --filter @chimap/mobile start
```

네이티브 의존성이나 `app.config.ts`가 바뀌면 `native:prebuild` 후 Development
Build를 다시 설치합니다. TypeScript만 바뀌면 Metro Fast Refresh를 사용합니다.
생성 설정은 루트에서 `node scripts/verify-mobile-native-config.mjs ios` 또는
`android`로 OS별 독립 검증합니다. Android Kakao wrapper는 Expo/RN과 맞는 Kotlin
2.1.20을 사용하며 NAVER/Kakao Maven repository는 각 SDK group에만 적용됩니다.

### iOS 먼저 확인할 순서

1. development Bundle ID에 NAVER Maps와 Sign in with Apple capability 등록
2. Kakao iOS platform Bundle ID와 URL scheme 등록
3. `expo prebuild --clean --platform ios` 후 generated Info.plist/entitlement 검사
4. unsigned simulator compile 뒤 실제 iPhone Development Build 설치
5. foreground 위치, HealthKit step read, NAVER path, Kakao/Apple 복귀를 각각 확인
6. eviction 후 저장된 추천 상세 sheet가 즉시 복원되고 5분 stale data만 refetch되는지 확인
7. archive의 Privacy Manifest report에서 포함 SDK와 Required Reason API 선언을 확인

앱은 background location, HealthKit write/background delivery를 요청하지 않습니다.
Expo Privacy Manifest aggregation을 명시적으로 활성화하며, prebuild 검증기가 해당
native 설정을 확인합니다.
권한은 “현재 위치 사용” 또는 “건강 앱에서 읽기”를 눌렀을 때만 요청하며 거부와
데이터 없음은 장소 검색·수동 걸음 입력으로 이어집니다.

## 로컬 데이터

- 마지막 CHIMap access/refresh pair와 사용자 snapshot: SecureStore
- 추천 응답: TanStack Query AsyncStorage persister, 성공한 추천 query만 최대 24시간
- 선택 경로/상세 sheet: Zustand persist
- key namespace: `APP_ENV + platform + SHA-256(ownerId)`

계정 전환이나 로그아웃은 해당 사용자 namespace와 SecureStore token을 함께
지웁니다. guest는 `guest-local` owner의 별도 namespace이며 계정 namespace와
자동 병합하지 않습니다. Web의 localStorage와 모바일 AsyncStorage는 물리적으로도, key
namespace로도 섞이지 않습니다.
