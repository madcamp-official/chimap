import { describe, expect, it } from "vitest";

import { createExpoConfig } from "./app.config";

const context = {} as Parameters<typeof createExpoConfig>[0];

function environment(
  appEnv: "development" | "staging" | "production" = "development",
): NodeJS.ProcessEnv {
  return {
    APP_ENV: appEnv,
    EXPO_PUBLIC_API_BASE_URL:
      appEnv === "staging"
        ? "https://staging.chimap.madcamp-kaist.org"
        : appEnv === "production"
          ? "https://chimap.madcamp-kaist.org"
          : "http://localhost:8080",
    KAKAO_NATIVE_APP_KEY: "ci-kakao-native-key",
    NAVER_MAP_CLIENT_ID_IOS: "ci-naver-ios-id",
    NAVER_MAP_CLIENT_ID_ANDROID: "ci-naver-android-id",
  };
}

describe("Expo platform identity", () => {
  it("development iOS는 iPhone, portrait, Light Mode와 iOS 17을 사용한다", () => {
    const config = createExpoConfig(context, environment());

    expect(config.orientation).toBe("portrait");
    expect(config.userInterfaceStyle).toBe("light");
    expect(config.ios).toMatchObject({
      bundleIdentifier: "org.madcamp.chimap.dev",
      deploymentTarget: "17.0",
      supportsTablet: false,
    });
    expect(config.android?.package).toBe("org.madcamp.chimap.dev");
    expect(config.android).toMatchObject({
      versionCode: 1,
      predictiveBackGestureEnabled: true,
      softwareKeyboardLayoutMode: "resize",
    });
    expect(config.ios?.infoPlist?.NMFNcpKeyId).toBe("ci-naver-ios-id");
  });

  it.each([
    ["staging", "org.madcamp.chimap.staging"],
    ["production", "org.madcamp.chimap"],
  ] as const)("%s bundle ID를 환경별로 생성한다", (appEnv, expectedIdentifier) => {
    const config = createExpoConfig(context, environment(appEnv));

    expect(config.ios?.bundleIdentifier).toBe(expectedIdentifier);
    expect(config.android?.package).toBe(expectedIdentifier);
    expect(config.scheme).toBe(`chimap-${appEnv}`);
  });

  it("staging은 분리된 HTTPS API만 사용한다", () => {
    const config = createExpoConfig(context, environment("staging"));

    expect(config.extra?.apiBaseUrl).toBe(
      "https://staging.chimap.madcamp-kaist.org",
    );
    expect(() =>
      createExpoConfig(context, {
        ...environment("staging"),
        EXPO_PUBLIC_API_BASE_URL: "https://chimap.madcamp-kaist.org",
      }),
    ).toThrow(/staging API URL/u);
    expect(() =>
      createExpoConfig(context, {
        ...environment("staging"),
        EXPO_PUBLIC_API_BASE_URL:
          "https://staging.chimap.madcamp-kaist.org/",
      }),
    ).toThrow(/trailing slash/u);
  });

  it("production은 운영 HTTPS API만 사용한다", () => {
    const config = createExpoConfig(context, environment("production"));

    expect(config.extra?.apiBaseUrl).toBe("https://chimap.madcamp-kaist.org");
    expect(() =>
      createExpoConfig(context, {
        ...environment("production"),
        EXPO_PUBLIC_API_BASE_URL: "https://staging.chimap.madcamp-kaist.org",
      }),
    ).toThrow(/production API URL/u);
  });

  it("Apple, HealthKit read, foreground location과 Privacy Manifest 설정을 보존한다", () => {
    const config = createExpoConfig(context, environment());

    expect(config.ios?.usesAppleSignIn).toBe(true);
    expect(config.ios?.infoPlist?.NSHealthShareUsageDescription).toEqual(
      expect.any(String),
    );
    expect(config.plugins).toContain("expo-apple-authentication");
    expect(config.plugins).toContainEqual([
      "@kingstinct/react-native-healthkit",
      {
        background: false,
        NSHealthShareUsageDescription:
          "오늘 걸음 수를 읽어 이동 경로를 개인화합니다.",
        NSHealthUpdateUsageDescription: false,
      },
    ]);
    expect(config.plugins).toContainEqual([
      "expo-location",
      expect.objectContaining({
        locationWhenInUsePermission: expect.any(String),
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isAndroidMotionActivityEnabled: false,
      }),
    ]);
    expect(config.plugins).toContainEqual([
      "expo-build-properties",
      {
        ios: { privacyManifestAggregationEnabled: true },
        android: {
          compileSdkVersion: 36,
          minSdkVersion: 26,
          targetSdkVersion: 36,
          usesCleartextTraffic: true,
        },
      },
    ]);
  });

  it.each([
    ["development", true],
    ["staging", false],
    ["production", false],
  ] as const)("%s cleartext 정책을 분리한다", (appEnv, expected) => {
    const config = createExpoConfig(context, environment(appEnv));
    const buildProperties = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
    );

    expect(buildProperties).toEqual([
      "expo-build-properties",
      expect.objectContaining({
        android: expect.objectContaining({ usesCleartextTraffic: expected }),
      }),
    ]);
  });

  it("Android icon, splash와 차단 permission을 public config에 고정한다", () => {
    const config = createExpoConfig(context, environment("production"));

    expect(config.icon).toBe("./assets/branding/app-icon.png");
    expect(config.android?.adaptiveIcon).toEqual({
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/branding/app-icon-foreground.png",
      monochromeImage: "./assets/branding/app-icon-monochrome.png",
    });
    expect(config.android?.permissions).toEqual([
      "android.permission.health.READ_STEPS",
    ]);
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.health.WRITE_STEPS",
        "android.permission.health.READ_HEALTH_DATA_HISTORY",
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
      ]),
    );
    expect(config.plugins).toContainEqual([
      "expo-splash-screen",
      expect.objectContaining({
        backgroundColor: "#FFFFFF",
        image: "./assets/branding/splash-icon.png",
      }),
    ]);
  });

  it("Personal Team 로컬 빌드는 Apple 코드를 유지한 채 capability 생성을 끌 수 있다", () => {
    const config = createExpoConfig(context, {
      ...environment("staging"),
      IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED: "false",
    });

    expect(config.ios?.usesAppleSignIn).toBe(false);
    expect(config.plugins).not.toContain("expo-apple-authentication");
    expect(config.plugins?.at(-1)).toBe(
      "./plugins/with-personal-team-apple-sign-in.cjs",
    );
  });

  it("Apple capability opt-out 값은 명시적인 boolean만 허용한다", () => {
    expect(() =>
      createExpoConfig(context, {
        ...environment(),
        IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED: "0",
      }),
    ).toThrow(/true 또는 false/u);
  });

  it("Kakao와 native provider plugin 설정을 보존한다", () => {
    const config = createExpoConfig(context, environment());

    expect(config.plugins).toContain("react-native-health-connect");
    expect(config.plugins).toContain(
      "./plugins/with-health-connect-main-activity.cjs",
    );
    expect(config.plugins).toContain("./plugins/with-gradle-wrapper-timeout.cjs");
    expect(config.plugins).toContain(
      "./plugins/with-scoped-android-maven-repositories.cjs",
    );
    expect(config.plugins).toContainEqual([
      "./plugins/with-naver-map-client-ids.cjs",
      {
        iosClientId: "ci-naver-ios-id",
        androidClientId: "ci-naver-android-id",
      },
    ]);
    expect(config.plugins).toContainEqual([
      "@react-native-seoul/kakao-login",
      { kakaoAppKey: "ci-kakao-native-key", kotlinVersion: "2.1.20" },
    ]);
  });

  it("같은 NAVER client ID를 두 native platform에 재사용하지 못하게 한다", () => {
    expect(() =>
      createExpoConfig(context, {
        ...environment("production"),
        NAVER_MAP_CLIENT_ID_IOS: "same-native-id",
        NAVER_MAP_CLIENT_ID_ANDROID: "same-native-id",
      }),
    ).toThrow(/분리/u);
  });

  it.each([
    "NAVER_MAP_CLIENT_ID_IOS",
    "NAVER_MAP_CLIENT_ID_ANDROID",
  ] as const)("%s가 Web Client ID를 재사용하지 못하게 한다", (variable) => {
    const input = environment("staging");
    input[variable] = "same-as-web-id";
    input.VITE_NAVER_MAP_NCP_KEY_ID = "same-as-web-id";

    expect(() => createExpoConfig(context, input)).toThrow(/Web Client ID.*분리/u);
  });

  it.each([
    "NAVER_MAP_CLIENT_ID_IOS",
    "NAVER_MAP_CLIENT_ID_ANDROID",
  ] as const)("필수 %s가 없으면 변수 이름을 포함해 실패한다", (variable) => {
    const input = environment();
    delete input[variable];

    expect(() => createExpoConfig(context, input)).toThrow(
      new RegExp(variable, "u"),
    );
  });

  it("Kakao Native App Key가 없으면 명확하게 실패한다", () => {
    const input = environment();
    delete input.KAKAO_NATIVE_APP_KEY;

    expect(() => createExpoConfig(context, input)).toThrow(
      /KAKAO_NATIVE_APP_KEY/u,
    );
  });

  it("server secret은 public Expo config에 직렬화하지 않는다", () => {
    const input = environment("staging");
    Object.assign(input, {
      DATABASE_URL: "postgresql://server-only.invalid/chimap",
      AUTH_SESSION_SECRET: "server-only-session-secret",
      NAVER_MAP_NCP_KEY: "server-only-naver-secret",
      KAKAO_OAUTH_CLIENT_SECRET: "server-only-kakao-secret",
      APPLE_PRIVATE_KEY_BASE64: "server-only-apple-private-key",
    });

    const serialized = JSON.stringify(createExpoConfig(context, input));

    expect(serialized).not.toContain("server-only");
    expect(serialized).not.toContain("postgresql://");
  });
});
