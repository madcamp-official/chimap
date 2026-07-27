import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnvironment = "development" | "staging" | "production";

const androidKotlinVersion = "2.1.20";
const stagingApiBaseUrl = "https://staging.chimap.madcamp-kaist.org";

const identifiers: Record<
  AppEnvironment,
  { bundleIdentifier: string; displaySuffix: string }
> = {
  development: {
    bundleIdentifier: "org.madcamp.chimap.dev",
    displaySuffix: " Dev",
  },
  staging: {
    bundleIdentifier: "org.madcamp.chimap.staging",
    displaySuffix: " Staging",
  },
  production: {
    bundleIdentifier: "org.madcamp.chimap",
    displaySuffix: "",
  },
};

function appEnvironment(value: string | undefined): AppEnvironment {
  if (
    value === "development" ||
    value === "staging" ||
    value === "production"
  ) {
    return value;
  }
  throw new Error(`APP_ENV 값이 올바르지 않습니다: ${value ?? "(missing)"}`);
}

function requiredClientId(
  value: string | undefined,
  variable: "NAVER_MAP_CLIENT_ID_IOS" | "NAVER_MAP_CLIENT_ID_ANDROID",
): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new Error(`${variable} 환경 변수가 필요합니다.`);
  }
  return normalized;
}

function appleSignInCapabilityEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(
    "IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED는 true 또는 false여야 합니다.",
  );
}

export function createExpoConfig(
  _context: ConfigContext,
  environment: NodeJS.ProcessEnv = process.env,
): ExpoConfig {
  const appEnv = appEnvironment(environment.APP_ENV ?? "development");
  const identity = identifiers[appEnv];
  const usesAppleSignIn = appleSignInCapabilityEnabled(
    environment.IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED,
  );
  const iosClientId = requiredClientId(
    environment.NAVER_MAP_CLIENT_ID_IOS,
    "NAVER_MAP_CLIENT_ID_IOS",
  );
  const androidClientId = requiredClientId(
    environment.NAVER_MAP_CLIENT_ID_ANDROID,
    "NAVER_MAP_CLIENT_ID_ANDROID",
  );
  const kakaoNativeAppKey = environment.KAKAO_NATIVE_APP_KEY?.trim();
  if (kakaoNativeAppKey === undefined || kakaoNativeAppKey.length === 0) {
    throw new Error("KAKAO_NATIVE_APP_KEY 환경 변수가 필요합니다.");
  }
  if (iosClientId === androidClientId) {
    throw new Error("iOS와 Android NAVER Map Client ID는 분리해야 합니다.");
  }
  const webClientId = environment.VITE_NAVER_MAP_NCP_KEY_ID?.trim();
  if (
    webClientId !== undefined &&
    webClientId.length > 0 &&
    (iosClientId === webClientId || androidClientId === webClientId)
  ) {
    throw new Error("모바일 NAVER Map Client ID는 Web Client ID와 분리해야 합니다.");
  }
  const apiBaseUrl = (
    environment.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080"
  ).trim();
  if (apiBaseUrl.endsWith("/")) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL에는 trailing slash를 넣지 않습니다.");
  }
  if (appEnv === "staging" && apiBaseUrl !== stagingApiBaseUrl) {
    throw new Error(`staging API URL은 ${stagingApiBaseUrl}이어야 합니다.`);
  }

  return {
    name: `CHIMap${identity.displaySuffix}`,
    slug: "chimap",
    version: "0.1.0",
    orientation: "portrait",
    scheme: `chimap-${appEnv}`,
    userInterfaceStyle: "light",
    ios: {
      deploymentTarget: "17.0",
      bundleIdentifier: identity.bundleIdentifier,
      supportsTablet: false,
      usesAppleSignIn,
      config: {
        usesNonExemptEncryption: false,
      },
      infoPlist: {
        NMFNcpKeyId: iosClientId,
        NSHealthShareUsageDescription:
          "오늘 걸음 수를 읽어 이동 경로를 개인화합니다.",
      },
    },
    android: {
      package: identity.bundleIdentifier,
      permissions: ["android.permission.health.READ_STEPS"],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      ...(usesAppleSignIn ? (["expo-apple-authentication"] as const) : []),
      [
        "@kingstinct/react-native-healthkit",
        {
          background: false,
          NSHealthShareUsageDescription:
            "오늘 걸음 수를 읽어 이동 경로를 개인화합니다.",
          NSHealthUpdateUsageDescription: false,
        },
      ],
      "react-native-health-connect",
      "./plugins/with-health-connect-main-activity.cjs",
      "./plugins/with-gradle-wrapper-timeout.cjs",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "현재 위치를 출발지로 사용해 건강 경로를 추천합니다.",
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: false,
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
          isAndroidForegroundServiceEnabled: false,
          isAndroidMotionActivityEnabled: false,
        },
      ],
      [
        "expo-build-properties",
        {
          ios: {
            privacyManifestAggregationEnabled: true,
          },
          android: {
            minSdkVersion: 26,
          },
        },
      ],
      "./plugins/with-scoped-android-maven-repositories.cjs",
      [
        "./plugins/with-naver-map-client-ids.cjs",
        { iosClientId, androidClientId },
      ],
      [
        "@react-native-seoul/kakao-login",
        { kakaoAppKey: kakaoNativeAppKey, kotlinVersion: androidKotlinVersion },
      ],
      ...(!usesAppleSignIn
        ? (["./plugins/with-personal-team-apple-sign-in.cjs"] as const)
        : []),
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnvironment: appEnv,
      apiBaseUrl,
    },
  };
}

export default (context: ConfigContext): ExpoConfig =>
  createExpoConfig(context);
