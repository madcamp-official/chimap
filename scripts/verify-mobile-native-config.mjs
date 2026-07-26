import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

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
if (
  expectedIdentifier === undefined ||
  iosClientId === undefined ||
  androidClientId === undefined
) {
  throw new Error("Native config verification environment is incomplete.");
}

const androidManifest = await readFile(
  join(mobileRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
  "utf8",
);
const androidGradle = await readFile(
  join(mobileRoot, "android", "app", "build.gradle"),
  "utf8",
);
const androidSourceRoot = join(mobileRoot, "android", "app", "src", "main", "java");
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
const mainActivityPath = await findMainActivity(androidSourceRoot);
if (mainActivityPath === null) {
  throw new Error("Generated Android MainActivity was not found.");
}
const mainActivity = await readFile(mainActivityPath, "utf8");
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
  join(iosRoot, iosProjectDirectory.name, `${iosProjectDirectory.name}.entitlements`),
  "utf8",
);
const podfileProperties = JSON.parse(
  await readFile(join(iosRoot, "Podfile.properties.json"), "utf8"),
);
const xcodeProject = await readFile(
  join(iosRoot, xcodeProjectDirectory.name, "project.pbxproj"),
  "utf8",
);
const kakaoNativeAppKey = process.env.KAKAO_NATIVE_APP_KEY;
if (kakaoNativeAppKey === undefined) {
  throw new Error("KAKAO_NATIVE_APP_KEY is required for native verification.");
}

const checks = [
  androidManifest.includes("com.naver.maps.map.NCP_KEY_ID"),
  androidManifest.includes(androidClientId),
  !androidManifest.includes(iosClientId),
  androidManifest.includes("android.permission.health.READ_STEPS"),
  androidManifest.includes("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"),
  androidManifest.includes(`kakao${kakaoNativeAppKey}`),
  !androidManifest.includes("android.permission.ACCESS_BACKGROUND_LOCATION"),
  !androidManifest.includes("android.permission.FOREGROUND_SERVICE_LOCATION"),
  mainActivity.includes("HealthConnectPermissionDelegate.setPermissionDelegate(this)"),
  androidGradle.includes(`applicationId '${expectedIdentifier}'`),
  iosInfo.includes("NMFNcpKeyId"),
  iosInfo.includes(iosClientId),
  !iosInfo.includes(androidClientId),
  iosInfo.includes(`kakao${kakaoNativeAppKey}`),
  iosInfo.includes("kakaokompassauth"),
  iosInfo.includes("NSLocationWhenInUseUsageDescription"),
  !iosInfo.includes("NSLocationAlwaysUsageDescription"),
  !iosInfo.includes("NSLocationAlwaysAndWhenInUseUsageDescription"),
  !iosInfo.includes("NSMotionUsageDescription"),
  !iosInfo.includes("<string>location</string>"),
  iosEntitlements.includes("com.apple.developer.healthkit"),
  !iosEntitlements.includes("com.apple.developer.healthkit.background-delivery"),
  iosEntitlements.includes("com.apple.developer.applesignin"),
  podfileProperties["apple.privacyManifestAggregationEnabled"] === "true",
  xcodeProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${expectedIdentifier}"`),
];
if (checks.some((passed) => !passed)) {
  throw new Error("Generated iOS/Android native identity verification failed.");
}
console.log("Generated iOS and Android identities are isolated.");
