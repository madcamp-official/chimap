import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = process.cwd();
const androidHome =
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "";
const appEnvironment = process.env.APP_ENV ?? "development";
const identifiers = {
  development: "org.madcamp.chimap.dev",
  staging: "org.madcamp.chimap.staging",
  production: "org.madcamp.chimap",
};
const expectedApplicationId = identifiers[appEnvironment];
const apkPath =
  process.argv[2] ??
  join(
    workspaceRoot,
    "apps/mobile/android/app/build/outputs/apk/release/app-release.apk",
  );
const aabPath =
  process.argv[3] ??
  join(
    workspaceRoot,
    "apps/mobile/android/app/build/outputs/bundle/release/app-release.aab",
  );
const expectedVersionCode = process.env.EXPECTED_ANDROID_VERSION_CODE;
const serverSecretVariableNames = [
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "AUTH_SESSION_SECRET",
  "AUTH_REFRESH_RETRY_ENCRYPTION_KEY",
  "NAVER_MAP_NCP_KEY",
  "KAKAO_REST_API_KEY",
  "KAKAO_OAUTH_CLIENT_SECRET",
  "APPLE_PRIVATE_KEY_BASE64",
  "EXPO_TOKEN",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
];
const forbiddenPermissions = [
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.health.READ_HEALTH_DATA_HISTORY",
  "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
];

if (expectedApplicationId === undefined) {
  throw new Error(`Unsupported APP_ENV for Android verification: ${appEnvironment}`);
}
if (androidHome.length === 0) {
  throw new Error("ANDROID_HOME or ANDROID_SDK_ROOT is required.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const detail =
      typeof result.stderr === "string" && result.stderr.trim().length > 0
        ? result.stderr.trim()
        : `exit ${result.status ?? "unknown"}`;
    throw new Error(`${basename(command)} failed: ${detail}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : result.stdout;
}

async function requireFile(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}

function analyzerValue(analyzer, verb, artifact) {
  return run(analyzer, ["manifest", verb, artifact]);
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer: ${value}`);
  }
  return parsed;
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesRecursively(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

function readElfPath() {
  const hostTag = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  return join(
    androidHome,
    "ndk/27.1.12297006/toolchains/llvm/prebuilt",
    hostTag,
    "bin/llvm-readelf",
  );
}

function loadAlignment(line) {
  const token = line.trim().split(/\s+/u).at(-1) ?? "";
  if (token.startsWith("0x")) {
    return Number.parseInt(token.slice(2), 16);
  }
  const power = /^2\*\*(\d+)$/u.exec(token)?.[1];
  return power === undefined ? Number.NaN : 2 ** Number.parseInt(power, 10);
}

async function verifyElfAlignment(readElf, libraries) {
  const failures = [];
  for (const library of libraries) {
    const output = run(readElf, ["-lW", library]);
    const loadSegments = output
      .split("\n")
      .filter((line) => line.trimStart().startsWith("LOAD"));
    if (
      loadSegments.length === 0 ||
      loadSegments.some((line) => {
        const alignment = loadAlignment(line);
        return !Number.isFinite(alignment) || alignment < 16_384;
      })
    ) {
      failures.push(library);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Native libraries without 16KB ELF LOAD alignment: ${failures.join(", ")}`,
    );
  }
}

async function verifyNoSecrets(roots) {
  const configuredSecretValues = serverSecretVariableNames
    .map((name) => process.env[name])
    .filter((value) => value !== undefined && value.length > 0);
  const markers = [...serverSecretVariableNames, ...configuredSecretValues];
  const leaked = [];
  for (const root of roots) {
    for (const file of await filesRecursively(root)) {
      const contents = await readFile(file);
      if (markers.some((marker) => contents.includes(Buffer.from(marker)))) {
        leaked.push(file);
      }
    }
  }
  if (leaked.length > 0) {
    throw new Error(`Server secret marker found in Android artifact: ${leaked.join(", ")}`);
  }
}

await requireFile(apkPath, "Release APK");
await requireFile(aabPath, "Release AAB");

const analyzer = join(androidHome, "cmdline-tools/latest/bin/apkanalyzer");
const zipalign = join(androidHome, "build-tools/36.0.0/zipalign");
const readElf = readElfPath();
await requireFile(analyzer, "apkanalyzer");
await requireFile(zipalign, "zipalign");
await requireFile(readElf, "NDK llvm-readelf");

const applicationId = analyzerValue(analyzer, "application-id", apkPath);
if (applicationId !== expectedApplicationId) {
  throw new Error(
    `Release APK application ID mismatch: expected ${expectedApplicationId}, received ${applicationId}`,
  );
}
const versionCode = parsePositiveInteger(
  analyzerValue(analyzer, "version-code", apkPath),
  "Release APK versionCode",
);
if (
  expectedVersionCode !== undefined &&
  versionCode !== parsePositiveInteger(expectedVersionCode, "Expected versionCode")
) {
  throw new Error(
    `Release APK versionCode mismatch: expected ${expectedVersionCode}, received ${versionCode}`,
  );
}
if (analyzerValue(analyzer, "min-sdk", apkPath) !== "26") {
  throw new Error("Release APK min SDK must be 26.");
}
if (analyzerValue(analyzer, "target-sdk", apkPath) !== "36") {
  throw new Error("Release APK target SDK must be 36.");
}
if (analyzerValue(analyzer, "debuggable", apkPath) !== "false") {
  throw new Error("Release APK must not be debuggable.");
}
const permissions = analyzerValue(analyzer, "permissions", apkPath)
  .split("\n")
  .map((permission) => permission.trim())
  .filter(Boolean);
for (const required of [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.health.READ_STEPS",
]) {
  if (!permissions.includes(required)) {
    throw new Error(`Release APK is missing required permission: ${required}`);
  }
}
if (
  permissions.some(
    (permission) =>
      forbiddenPermissions.includes(permission) ||
      permission.startsWith("android.permission.health.WRITE_"),
  )
) {
  throw new Error("Release APK contains a forbidden location or health permission.");
}

run(zipalign, ["-c", "-P", "16", "-v", "4", apkPath]);

const extractionRoot = await mkdtemp(join(tmpdir(), "chimap-android-release-"));
try {
  const apkRoot = join(extractionRoot, "apk");
  const aabRoot = join(extractionRoot, "aab");
  // Android resource names can collide after unzip's local filename decoding.
  // Extraction is only used for binary inspection, so deterministically keep
  // the last archive entry instead of allowing an interactive overwrite prompt.
  run("unzip", ["-oq", apkPath, "-d", apkRoot]);
  run("unzip", ["-oq", aabPath, "-d", aabRoot]);

  const aabManifest = join(aabRoot, "base/manifest/AndroidManifest.xml");
  await requireFile(aabManifest, "AAB base manifest");
  const aabManifestContents = await readFile(aabManifest);
  if (!aabManifestContents.includes(Buffer.from(expectedApplicationId))) {
    throw new Error("Release AAB manifest does not contain the expected application ID.");
  }

  const artifactFiles = [
    ...(await filesRecursively(apkRoot)),
    ...(await filesRecursively(aabRoot)),
  ];
  const libraries = artifactFiles.filter((file) => file.endsWith(".so"));
  if (
    !libraries.some(
      (file) => file.includes("/arm64-v8a/") || file.includes("/arm64_v8a/"),
    )
  ) {
    throw new Error("Android release artifacts do not contain arm64-v8a libraries.");
  }
  await verifyElfAlignment(readElf, libraries);
  await verifyNoSecrets([apkRoot, aabRoot]);
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

console.log(
  `Android release artifacts verified for ${expectedApplicationId} versionCode ${versionCode}.`,
);
