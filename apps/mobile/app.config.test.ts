import { describe, expect, it } from "vitest";

import { createExpoConfig } from "./app.config";

const context = {} as Parameters<typeof createExpoConfig>[0];

describe("Expo platform identity", () => {
  it("development bundle과 iOS/Android NAVER client ID를 분리한다", () => {
    const config = createExpoConfig(context, {
      APP_ENV: "development",
      KAKAO_NATIVE_APP_KEY: "kakao-native-key",
      NAVER_MAP_CLIENT_ID_IOS: "naver-ios-id",
      NAVER_MAP_CLIENT_ID_ANDROID: "naver-android-id",
    });

    expect(config.ios?.bundleIdentifier).toBe("org.madcamp.chimap.dev");
    expect(config.android?.package).toBe("org.madcamp.chimap.dev");
    expect(config.ios?.infoPlist?.NMFNcpKeyId).toBe("naver-ios-id");
    expect(config.ios?.usesAppleSignIn).toBe(true);
    expect(config.plugins).toContainEqual([
      "@kingstinct/react-native-healthkit",
      {
        background: false,
        NSHealthShareUsageDescription:
          "오늘 걸음 수를 읽어 이동 경로를 개인화합니다.",
        NSHealthUpdateUsageDescription: false,
      },
    ]);
    expect(config.plugins).toContain("react-native-health-connect");
    expect(config.plugins).toContain("./plugins/with-health-connect-main-activity.cjs");
    expect(config.plugins).toContainEqual([
      "expo-location",
      expect.objectContaining({
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
      }),
    ]);
    expect(config.plugins).toContainEqual([
      "expo-build-properties",
      expect.objectContaining({
        ios: { privacyManifestAggregationEnabled: true },
      }),
    ]);
    expect(config.plugins).toContainEqual([
      "./plugins/with-naver-map-client-ids.cjs",
      { iosClientId: "naver-ios-id", androidClientId: "naver-android-id" },
    ]);
  });

  it("같은 NAVER client ID를 두 native platform에 재사용하지 못하게 한다", () => {
    expect(() =>
      createExpoConfig(context, {
        APP_ENV: "production",
        KAKAO_NATIVE_APP_KEY: "kakao-native-key",
        NAVER_MAP_CLIENT_ID_IOS: "same-id",
        NAVER_MAP_CLIENT_ID_ANDROID: "same-id",
      }),
    ).toThrow(/분리/u);
  });
});
