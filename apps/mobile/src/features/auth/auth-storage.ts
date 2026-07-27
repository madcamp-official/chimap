import {
  mobileTokenPairSchema,
  type MobileTokenPair,
} from "@chimap/contracts";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function sessionStorageKey(): string {
  const configured = Constants.expoConfig?.extra?.appEnvironment;
  const environment = typeof configured === "string" ? configured : "development";
  // expo-secure-store accepts only alphanumeric characters, `.`, `-`, and `_`
  // for keys. Keep the environment/platform namespace without `:` separators.
  return `chimap.${environment}.${Platform.OS}.auth.session.v1`;
}

export async function readStoredSession(): Promise<MobileTokenPair | null> {
  const value = await SecureStore.getItemAsync(sessionStorageKey());
  if (value === null) {
    return null;
  }
  try {
    const parsed = mobileTokenPairSchema.safeParse(JSON.parse(value) as unknown);
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // 손상된 보안 저장소 값은 아래에서 제거하고 로그인 상태로 사용하지 않는다.
  }
  await clearStoredSession();
  return null;
}

export async function writeStoredSession(pair: MobileTokenPair): Promise<void> {
  await SecureStore.setItemAsync(sessionStorageKey(), JSON.stringify(pair), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(sessionStorageKey());
}
