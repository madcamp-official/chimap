import type { ConfigContext, ExpoConfig } from "expo/config";

type AppEnvironment = "development" | "staging" | "production";

const androidKotlinVersion = "2.1.20";
const stagingApiBaseUrl = "https://staging.chimap.madcamp-kaist.org";
const productionApiBaseUrl = "https://chimap.madcamp-kaist.org";

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

function requiredEnvironmentValue(
  value: string | undefined,
  variable:
    | "NAVER_MAP_CLIENT_ID_IOS"
    | "NAVER_MAP_CLIENT_ID_ANDROID"
    | "KAKAO_NATIVE_IOS_APP_KEY"
    | "KAKAO_NATIVE_ANDROID_APP_KEY",
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
  const iosClientId = requiredEnvironmentValue(
    environment.NAVER_MAP_CLIENT_ID_IOS,
    "NAVER_MAP_CLIENT_ID_IOS",
  );
  const androidClientId = requiredEnvironmentValue(
    environment.NAVER_MAP_CLIENT_ID_ANDROID,
    "NAVER_MAP_CLIENT_ID_ANDROID",
  );
  const kakaoIosAppKey = requiredEnvironmentValue(
    environment.KAKAO_NATIVE_IOS_APP_KEY,
    "KAKAO_NATIVE_IOS_APP_KEY",
  );
  const kakaoAndroidAppKey = requiredEnvironmentValue(
    environment.KAKAO_NATIVE_ANDROID_APP_KEY,
    "KAKAO_NATIVE_ANDROID_APP_KEY",
  );
  if (kakaoIosAppKey === kakaoAndroidAppKey) {
    throw new Error("iOS와 Android Kakao Native App Key는 분리해야 합니다.");
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
  if (appEnv === "production" && apiBaseUrl !== productionApiBaseUrl) {
    throw new Error(`production API URL은 ${productionApiBaseUrl}이어야 합니다.`);
  }

  return {
    name: `CHIMap${identity.displaySuffix}`,
    slug: "chimap",
    owner: "seojinlee",
    version: "0.1.0",
    icon: "./assets/branding/app-icon.png",
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
      adaptiveIcon: {
        backgroundColor: "#FFFFFF",
        foregroundImage: "./assets/branding/app-icon-foreground.png",
        monochromeImage: "./assets/branding/app-icon-monochrome.png",
      },
      blockedPermissions: [
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.health.WRITE_STEPS",
        "android.permission.health.READ_HEALTH_DATA_HISTORY",
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
      ],
      package: identity.bundleIdentifier,
      permissions: ["android.permission.health.READ_STEPS"],
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: "resize",
      versionCode: 1,
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#FFFFFF",
          image: "./assets/branding/splash-icon.png",
          imageWidth: 280,
          resizeMode: "contain",
        },
      ],
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
            compileSdkVersion: 36,
            minSdkVersion: 26,
            targetSdkVersion: 36,
            usesCleartextTraffic: appEnv === "development",
          },
        },
      ],
      "./plugins/with-scoped-android-maven-repositories.cjs",
      [
        "./plugins/with-naver-map-client-ids.cjs",
        { iosClientId, androidClientId },
      ],
      [
        "./plugins/with-platform-kakao-login.cjs",
        {
          iosAppKey: kakaoIosAppKey,
          androidAppKey: kakaoAndroidAppKey,
          kotlinVersion: androidKotlinVersion,
        },
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
      eas: {
        projectId: "785a6a49-e276-4c29-a0d5-db59017deee2",
      },
    },
  };
}

export default (context: ConfigContext): ExpoConfig =>
  createExpoConfig(context);
