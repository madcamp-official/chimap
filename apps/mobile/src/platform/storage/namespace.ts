import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

export type MobileStorageKeys = {
  route: string;
  query: string;
};

function appEnvironment(): string {
  const value = Constants.expoConfig?.extra?.appEnvironment;
  return typeof value === "string" ? value : "development";
}

export async function storageKeysForUser(userId: string): Promise<MobileStorageKeys> {
  const ownerHash = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      userId,
    )
  ).slice(0, 20);
  const prefix = `chimap:${appEnvironment()}:${Platform.OS}:${ownerHash}`;
  return {
    route: `${prefix}:route:v1`,
    query: `${prefix}:query:v1`,
  };
}

export async function clearUserLocalState(keys: MobileStorageKeys): Promise<void> {
  await AsyncStorage.multiRemove([keys.route, keys.query]);
}
