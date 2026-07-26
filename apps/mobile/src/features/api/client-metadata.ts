import {
  mobileConfigResponseSchema,
  type MobileConfigResponse,
} from "@chimap/contracts";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { fetchWithTimeout } from "./fetch-with-timeout";

export function mobileClientHeaders(
  additional: Record<string, string> = {},
): Record<string, string> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("모바일 client metadata는 iOS/Android에서만 만들 수 있습니다.");
  }
  return {
    "X-Client-Platform": Platform.OS,
    "X-App-Version": Constants.expoConfig?.version ?? "0.1.0",
    "X-Contract-Version": "v1",
    ...additional,
  };
}

export async function fetchMobileConfig(
  apiBaseUrl: string,
): Promise<MobileConfigResponse> {
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/api/v1/mobile-config`,
    { headers: mobileClientHeaders() },
    3_000,
  );
  if (!response.ok) {
    throw new Error("모바일 운영 설정을 확인하지 못했습니다.");
  }
  return mobileConfigResponseSchema.parse(await response.json());
}
