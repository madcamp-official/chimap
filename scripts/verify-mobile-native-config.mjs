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
if (
  expectedIdentifier === undefined ||
  iosClientId === undefined ||
  androidClientId === undefined ||
  kakaoNativeAppKey === undefined
) {
  throw new Error("Native config verification environment is incomplete.");
}

const checks = new Map();

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
  const xcodeProject = await readFile(
    join(iosRoot, xcodeProjectDirectory.name, "project.pbxproj"),
    "utf8",
  );

  checks.set("iOS NAVER metadata", iosInfo.includes("NMFNcpKeyId"));
  checks.set("iOS NAVER client ID", iosInfo.includes(iosClientId));
  checks.set(
    "iOS excludes Android NAVER ID",
    !iosInfo.includes(androidClientId),
  );
  checks.set("iOS Kakao scheme", iosInfo.includes(`kakao${kakaoNativeAppKey}`));
  checks.set("iOS Kakao query scheme", iosInfo.includes("kakaokompassauth"));
  checks.set(
    "iOS foreground location purpose",
    iosInfo.includes("NSLocationWhenInUseUsageDescription"),
  );
  checks.set(
    "iOS HealthKit read purpose",
    iosInfo.includes("NSHealthShareUsageDescription"),
  );
  checks.set(
    "iOS excludes HealthKit write purpose",
    !iosInfo.includes("NSHealthUpdateUsageDescription"),
  );
  checks.set(
    "iOS excludes always location",
    !iosInfo.includes("NSLocationAlwaysUsageDescription"),
  );
  checks.set(
    "iOS excludes combined always location",
    !iosInfo.includes("NSLocationAlwaysAndWhenInUseUsageDescription"),
  );
  checks.set(
    "iOS excludes motion permission",
    !iosInfo.includes("NSMotionUsageDescription"),
  );
  checks.set(
    "iOS excludes background location mode",
    !iosInfo.includes("<string>location</string>"),
  );
  checks.set(
    "iOS non-exempt encryption declaration",
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/u.test(iosInfo),
  );
  checks.set(
    "iOS HealthKit entitlement",
    iosEntitlements.includes("com.apple.developer.healthkit"),
  );
  checks.set(
    "iOS excludes HealthKit background delivery",
    !iosEntitlements.includes("com.apple.developer.healthkit.background-delivery"),
  );
  checks.set(
    "iOS Apple Sign In entitlement",
    iosEntitlements.includes("com.apple.developer.applesignin"),
  );
  checks.set(
    "iOS privacy manifest aggregation",
    podfileProperties["apple.privacyManifestAggregationEnabled"] === "true",
  );
  checks.set(
    "iOS bundle ID",
    xcodeProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = "${expectedIdentifier}"`),
  );
}

const failedChecks = [...checks]
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failedChecks.length > 0) {
  throw new Error(`Generated native verification failed: ${failedChecks.join(", ")}`);
}
console.log(`Generated ${requestedPlatform} native configuration is isolated.`);
