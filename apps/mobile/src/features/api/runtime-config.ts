import Constants from "expo-constants";

export function apiBaseUrl(): string {
  const value = Constants.expoConfig?.extra?.apiBaseUrl;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expo apiBaseUrl 설정이 필요합니다.");
  }
  return value.replace(/\/+$/u, "");
}
