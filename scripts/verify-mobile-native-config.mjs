import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const requestedPlatform = process.argv[2] ?? "all";
const supportedPlatforms = new Set(["all", "ios", "android"]);
if (!supportedPlatforms.has(requestedPlatform)) {
  throw new Error(
    `Native config verification platform must be all, ios, or android: ${requestedPlatform}`,
  );
}

const verifyAndroid = requestedPlatform === "all" || requestedPlatform === "android";
const verifyIos = requestedPlatform === "all" || requestedPlatform === "ios";
const mobileRoot = join(process.cwd(), "apps", "mobile");
const appEnvironment = process.env.APP_ENV ?? "development";
const identifiers = {
  development: "org.madcamp.chimap.dev",
  staging: "org.madcamp.chimap.staging",
  production: "org.madcamp.chimap",
};
const expectedIdentifier = identifiers[appEnvironment];
const iosClientId = process.env.NAVER_MAP_CLIENT_ID_IOS;
const androidClientId = process.env.NAVER_MAP_CLIENT_ID_ANDROID;
const kakaoNativeAppKey = process.env.KAKAO_NATIVE_APP_KEY;
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const appleSignInCapabilityValue =
  process.env.IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED ?? "true";
if (
  appleSignInCapabilityValue !== "true" &&
  appleSignInCapabilityValue !== "false"
) {
  throw new Error(
    "IOS_APPLE_SIGN_IN_CAPABILITY_ENABLED must be true or false.",
  );
}
const appleSignInCapabilityEnabled = appleSignInCapabilityValue === "true";
const serverSecretVariableNames = [
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "AUTH_SESSION_SECRET",
  "AUTH_REFRESH_RETRY_ENCRYPTION_KEY",
  "NAVER_MAP_NCP_KEY",
  "KAKAO_REST_API_KEY",
  "KAKAO_OAUTH_CLIENT_SECRET",
  "APPLE_PRIVATE_KEY_BASE64",
];
if (
  expectedIdentifier === undefined ||
  iosClientId === undefined ||
  androidClientId === undefined ||
  kakaoNativeAppKey === undefined ||
  apiBaseUrl === undefined
) {
  throw new Error("Native config verification environment is incomplete.");
}
if (
  appEnvironment === "staging" &&
  apiBaseUrl !== "https://staging.chimap.madcamp-kaist.org"
) {
  throw new Error("Staging native verification requires the staging API URL.");
}

const checks = new Map();

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function plistHasKey(plist, key) {
  return new RegExp(`<key>\\s*${escapeRegularExpression(key)}\\s*</key>`, "u").test(
    plist,
  );
}

function plistStringValue(plist, key) {
  const match = new RegExp(
    `<key>\\s*${escapeRegularExpression(key)}\\s*</key>\\s*<string>([^<]*)</string>`,
    "u",
  ).exec(plist);
  return match?.[1]?.trim() ?? null;
}

function plistBooleanValue(plist, key) {
  const match = new RegExp(
    `<key>\\s*${escapeRegularExpression(key)}\\s*</key>\\s*<(true|false)\\s*/>`,
    "u",
  ).exec(plist);
  return match?.[1] === undefined ? null : match[1] === "true";
}

function plistArrayValues(plist, key) {
  const pattern = new RegExp(
    `<key>\\s*${escapeRegularExpression(key)}\\s*</key>\\s*<array>([\\s\\S]*?)</array>`,
    "gu",
  );
  const values = [];
  for (const match of plist.matchAll(pattern)) {
    if (match[1] === undefined) {
      continue;
    }
    values.push(
      ...[...match[1].matchAll(/<string>([^<]*)<\/string>/gu)].map((entry) =>
        entry[1].trim(),
      ),
    );
  }
  return values;
}

function xcodeApplicationTargetBuildSettings(project) {
  const configurationPattern =
    /isa = XCBuildConfiguration;\s*(?:baseConfigurationReference = [^;]+;\s*)?buildSettings = \{([\s\S]*?)\n\s*\};\s*name = [^;]+;/gu;
  return [...project.matchAll(configurationPattern)]
    .map((entry) => entry[1])
    .filter(
      (settings) =>
        settings.includes("PRODUCT_BUNDLE_IDENTIFIER") &&
        settings.includes("INFOPLIST_FILE"),
    );
}

function xcodeBuildSettingValue(settings, setting) {
  const match = new RegExp(
    `\\b${escapeRegularExpression(setting)}\\s*=\\s*([^;]+);`,
    "u",
  ).exec(settings);
  return match?.[1]?.trim().replace(/^"|"$/gu, "") ?? null;
}

function allXcodeBuildSettingsEqual(settingsList, setting, expected) {
  return (
    settingsList.length > 0 &&
    settingsList.every(
      (settings) => xcodeBuildSettingValue(settings, setting) === expected,
    )
  );
}

async function findMainActivity(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findMainActivity(path);
      if (found !== null) return found;
    } else if (entry.name === "MainActivity.kt") {
      return path;
    }
  }
  return null;
}

if (verifyAndroid) {
  const androidRoot = join(mobileRoot, "android");
  const androidManifest = await readFile(
    join(androidRoot, "app", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );
  const androidGradle = await readFile(
    join(androidRoot, "app", "build.gradle"),
    "utf8",
  );
  const androidRootGradle = await readFile(
    join(androidRoot, "build.gradle"),
    "utf8",
  );
  const androidGradleProperties = await readFile(
    join(androidRoot, "gradle.properties"),
    "utf8",
  );
  const gradleWrapperProperties = await readFile(
    join(androidRoot, "gradle", "wrapper", "gradle-wrapper.properties"),
    "utf8",
  );
  const mainActivityPath = await findMainActivity(
    join(androidRoot, "app", "src", "main", "java"),
  );
  if (mainActivityPath === null) {
    throw new Error("Generated Android MainActivity was not found.");
  }
  const mainActivity = await readFile(mainActivityPath, "utf8");

  checks.set(
    "Android NAVER metadata",
    androidManifest.includes("com.naver.maps.map.NCP_KEY_ID"),
  );
  checks.set("Android NAVER client ID", androidManifest.includes(androidClientId));
  checks.set(
    "Android excludes iOS NAVER ID",
    !androidManifest.includes(iosClientId),
  );
  checks.set(
    "Android Health Connect steps permission",
    androidManifest.includes("android.permission.health.READ_STEPS"),
  );
  checks.set(
    "Android Health Connect rationale",
    androidManifest.includes("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"),
  );
  checks.set(
    "Android Kakao scheme",
    androidManifest.includes(`kakao${kakaoNativeAppKey}`),
  );
  checks.set(
    "Android excludes background location",
    !androidManifest.includes("android.permission.ACCESS_BACKGROUND_LOCATION"),
  );
  checks.set(
    "Android excludes location foreground service",
    !androidManifest.includes("android.permission.FOREGROUND_SERVICE_LOCATION"),
  );
  checks.set(
    "Android Health Connect permission delegate",
    mainActivity.includes(
      "HealthConnectPermissionDelegate.setPermissionDelegate(this)",
    ),
  );
  checks.set(
    "Gradle wrapper timeout",
    gradleWrapperProperties.includes("networkTimeout=60000"),
  );
  checks.set(
    "Android supported Kotlin classpath",
    androidRootGradle.includes("kotlin-gradle-plugin:2.1.20"),
  );
  checks.set(
    "Android excludes legacy Kotlin",
    !androidRootGradle.includes("kotlin-gradle-plugin:1.5.10"),
  );
  checks.set(
    "Android Kotlin property",
    androidGradleProperties.includes("android.kotlinVersion=2.1.20"),
  );
  checks.set(
    "Android minimum SDK",
    androidGradleProperties.includes("android.minSdkVersion=26"),
  );
  checks.set(
    "Android excludes unscoped extra Maven repositories",
    !androidGradleProperties.includes("android.extraMavenRepos"),
  );
  checks.set(
    "Android NAVER repository scope",
    androidRootGradle.includes('includeGroup("com.naver.maps")'),
  );
  checks.set(
    "Android NAVER official repository",
    androidRootGradle.includes(
      "https://repository.map.naver.com/archive/maven",
    ),
  );
  checks.set(
    "Android Kakao repository scope",
    androidRootGradle.includes('includeGroup("com.kakao.sdk")'),
  );
  checks.set(
    "Android Kakao official repository",
    androidRootGradle.includes(
      "https://devrepo.kakao.com/nexus/content/groups/public/",
    ),
  );
  checks.set(
    "Android excludes local verification repositories",
    !androidRootGradle.includes("file:///"),
  );
  checks.set(
    "Android application ID",
    androidGradle.includes(`applicationId '${expectedIdentifier}'`),
  );
}

if (verifyIos) {
  const iosRoot = join(mobileRoot, "ios");
  const iosEntries = await readdir(iosRoot, { withFileTypes: true });
  const iosProjectDirectory = iosEntries.find(
    (entry) => entry.isDirectory() && !entry.name.endsWith(".xcodeproj"),
  );
  const xcodeProjectDirectory = iosEntries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"),
  );
  if (iosProjectDirectory === undefined || xcodeProjectDirectory === undefined) {
    throw new Error("Generated iOS application directory was not found.");
  }
  const iosInfo = await readFile(
    join(iosRoot, iosProjectDirectory.name, "Info.plist"),
    "utf8",
  );
  const iosEntitlements = await readFile(
    join(
      iosRoot,
      iosProjectDirectory.name,
      `${iosProjectDirectory.name}.entitlements`,
    ),
    "utf8",
  );
  const podfileProperties = JSON.parse(
    await readFile(join(iosRoot, "Podfile.properties.json"), "utf8"),
  );
  const podfilePropertiesText = JSON.stringify(podfileProperties);
  const expoPlist = await readFile(
    join(iosRoot, iosProjectDirectory.name, "Supporting", "Expo.plist"),
    "utf8",
  );
  const podfile = await readFile(join(iosRoot, "Podfile"), "utf8");
  const xcodeProject = await readFile(
    join(iosRoot, xcodeProjectDirectory.name, "project.pbxproj"),
    "utf8",
  );

  const supportedOrientations = plistArrayValues(
    iosInfo,
    "UISupportedInterfaceOrientations",
  );
  const backgroundModes = plistArrayValues(iosInfo, "UIBackgroundModes");
  const kakaoQuerySchemes = plistArrayValues(
    iosInfo,
    "LSApplicationQueriesSchemes",
  );
  const urlSchemes = plistArrayValues(iosInfo, "CFBundleURLSchemes");
  const applicationTargetBuildSettings = xcodeApplicationTargetBuildSettings(
    xcodeProject,
  );
  const bundleIdentifiers = applicationTargetBuildSettings.map((settings) =>
    xcodeBuildSettingValue(settings, "PRODUCT_BUNDLE_IDENTIFIER"),
  );
  const generatedIosConfiguration = [
    iosInfo,
    iosEntitlements,
    expoPlist,
    podfile,
    podfilePropertiesText,
    xcodeProject,
  ].join("\n");
  const serverSecretValues = serverSecretVariableNames
    .map((name) => process.env[name])
    .filter((value) => value !== undefined && value.length > 0);
  const forbiddenServerMarkers = [
    ...serverSecretVariableNames,
    ...serverSecretValues,
    "postgresql://",
  ];

  checks.set(
    "iOS deployment target",
    allXcodeBuildSettingsEqual(
      applicationTargetBuildSettings,
      "IPHONEOS_DEPLOYMENT_TARGET",
      "17.0",
    ),
  );
  checks.set(
    "iOS iPhone-only target family",
    allXcodeBuildSettingsEqual(
      applicationTargetBuildSettings,
      "TARGETED_DEVICE_FAMILY",
      "1",
    ),
  );
  checks.set(
    "iOS portrait orientation",
    supportedOrientations.includes("UIInterfaceOrientationPortrait") &&
      supportedOrientations.every(
        (orientation) => !orientation.startsWith("UIInterfaceOrientationLandscape"),
      ),
  );
  checks.set(
    "iOS Light appearance",
    plistStringValue(iosInfo, "UIUserInterfaceStyle") === "Light",
  );
  checks.set("iOS NAVER metadata", plistHasKey(iosInfo, "NMFNcpKeyId"));
  checks.set(
    "iOS NAVER client ID",
    plistStringValue(iosInfo, "NMFNcpKeyId") === iosClientId,
  );
  checks.set(
    "iOS excludes Android NAVER ID",
    plistStringValue(iosInfo, "NMFNcpKeyId") !== androidClientId,
  );
  checks.set("iOS Kakao scheme", urlSchemes.includes(`kakao${kakaoNativeAppKey}`));
  checks.set(
    "iOS Kakao query scheme",
    kakaoQuerySchemes.includes("kakaokompassauth"),
  );
  checks.set(
    "iOS foreground location purpose",
    (plistStringValue(iosInfo, "NSLocationWhenInUseUsageDescription")?.length ?? 0) >
      0,
  );
  checks.set(
    "iOS HealthKit read purpose",
    (plistStringValue(iosInfo, "NSHealthShareUsageDescription")?.length ?? 0) > 0,
  );
  checks.set(
    "iOS excludes HealthKit write purpose",
    !plistHasKey(iosInfo, "NSHealthUpdateUsageDescription"),
  );
  checks.set(
    "iOS excludes always location",
    !plistHasKey(iosInfo, "NSLocationAlwaysUsageDescription"),
  );
  checks.set(
    "iOS excludes combined always location",
    !plistHasKey(iosInfo, "NSLocationAlwaysAndWhenInUseUsageDescription"),
  );
  checks.set(
    "iOS excludes motion permission",
    !plistHasKey(iosInfo, "NSMotionUsageDescription"),
  );
  checks.set(
    "iOS excludes background location mode",
    !backgroundModes.includes("location"),
  );
  checks.set(
    "iOS non-exempt encryption declaration",
    plistBooleanValue(iosInfo, "ITSAppUsesNonExemptEncryption") === false,
  );
  checks.set(
    "iOS HealthKit entitlement",
    plistHasKey(iosEntitlements, "com.apple.developer.healthkit"),
  );
  checks.set(
    "iOS excludes HealthKit background delivery",
    !plistHasKey(
      iosEntitlements,
      "com.apple.developer.healthkit.background-delivery",
    ),
  );
  checks.set(
    appleSignInCapabilityEnabled
      ? "iOS Apple Sign In entitlement"
      : "iOS excludes Apple Sign In entitlement for Personal Team",
    plistHasKey(iosEntitlements, "com.apple.developer.applesignin") ===
      appleSignInCapabilityEnabled,
  );
  checks.set(
    "iOS privacy manifest aggregation",
    podfileProperties["apple.privacyManifestAggregationEnabled"] === "true",
  );
  checks.set(
    "iOS bundle ID",
    bundleIdentifiers.includes(expectedIdentifier) &&
      !Object.values(identifiers).some(
        (identifier) =>
          identifier !== expectedIdentifier && bundleIdentifiers.includes(identifier),
      ),
  );
  checks.set(
    "iOS excludes server secrets",
    forbiddenServerMarkers.every(
      (marker) => !generatedIosConfiguration.includes(marker),
    ),
  );
  checks.set(
    "iOS staging excludes production API",
    appEnvironment !== "staging" ||
      !generatedIosConfiguration.includes("https://chimap.madcamp-kaist.org"),
  );
}

const failedChecks = [...checks]
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failedChecks.length > 0) {
  throw new Error(`Generated native verification failed: ${failedChecks.join(", ")}`);
}
console.log(`Generated ${requestedPlatform} native configuration is isolated.`);
