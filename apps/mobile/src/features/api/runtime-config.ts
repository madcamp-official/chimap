import Constants from "expo-constants";

export type RuntimeAppEnvironment =
  | "development"
  | "staging"
  | "production";

export function apiBaseUrl(): string {
  const value = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expo apiBaseUrl 설정이 필요합니다.");
  }
  return value.replace(/\/+$/u, "");
}

export function runtimeAppEnvironment(): RuntimeAppEnvironment {
  const value = Constants.expoConfig?.extra?.appEnvironment;
  if (
    value === "development" ||
    value === "staging" ||
    value === "production"
  ) {
    return value;
  }
  throw new Error("Expo appEnvironment 설정이 필요합니다.");
}

export function runtimeApplicationId(platform: "android" | "ios"): string {
  const value =
    platform === "android"
      ? Constants.expoConfig?.android?.package
      : Constants.expoConfig?.ios?.bundleIdentifier;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expo ${platform} application ID 설정이 필요합니다.`);
  }
  return value;
}
