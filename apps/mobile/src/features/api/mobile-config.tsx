import type { MobileConfigResponse } from "@chimap/contracts";
import { mobileConfigResponseSchema } from "@chimap/contracts";
import { colors, spacing } from "@chimap/design-tokens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";
import { ActivityIndicator, Platform, SafeAreaView, StyleSheet, Text } from "react-native";

import { fetchMobileConfig } from "./client-metadata";
import { apiBaseUrl } from "./runtime-config";

const MobileConfigContext = createContext<MobileConfigResponse | null>(null);
const maintenanceCacheMaxAgeMs = 5 * 60 * 1_000;

function configStorageKey(): string {
  const environment = Constants.expoConfig?.extra?.appEnvironment;
  return `chimap:${typeof environment === "string" ? environment : "development"}:${Platform.OS}:mobile-config:v1`;
}

function cachedConfig(value: string | null): MobileConfigResponse | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as { savedAt?: unknown; config?: unknown };
    const config = mobileConfigResponseSchema.safeParse(parsed.config);
    if (!config.success) {
      return null;
    }
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    return Date.now() - savedAt <= maintenanceCacheMaxAgeMs
      ? config.data
      : {
          ...config.data,
          maintenance: { enabled: false, message: null },
        };
  } catch {
    return null;
  }
}

function compareVersions(left: string, right: string): number {
  const parts = (value: string) =>
    value
      .split("-", 1)[0]
      ?.split(".")
      .map((part) => Number(part)) ?? [0, 0, 0];
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function MobileConfigProvider({ children }: PropsWithChildren) {
  const [config, setConfig] = useState<MobileConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    const storageKey = configStorageKey();
    void (async () => {
      try {
        const local = cachedConfig(await AsyncStorage.getItem(storageKey));
        if (mounted && local !== null) {
          setConfig(local);
        }
      } catch {
        // AsyncStorage 손상/실패는 network config 조회로 복구한다.
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
      try {
        const value = await fetchMobileConfig(apiBaseUrl());
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({ savedAt: Date.now(), config: value }),
        );
        if (mounted) {
          setConfig(value);
        }
      } catch {
        // 저장된 추천과 guest 핵심 흐름은 운영 설정 네트워크 장애와 분리한다.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator accessibilityLabel="앱 호환성 확인 중" />
      </SafeAreaView>
    );
  }
  if (config?.maintenance.enabled === true) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>서비스 점검 중</Text>
        <Text style={styles.body}>{config.maintenance.message}</Text>
      </SafeAreaView>
    );
  }
  if (config !== null && (Platform.OS === "ios" || Platform.OS === "android")) {
    const minimum = config.minimumSupportedVersion[Platform.OS];
    if (compareVersions(Constants.expoConfig?.version ?? "0.0.0", minimum) < 0) {
      return (
        <SafeAreaView style={styles.center}>
          <Text style={styles.title}>업데이트가 필요합니다</Text>
          <Text style={styles.body}>
            안전하게 계속 사용하려면 CHIMap {minimum} 이상으로 업데이트해 주세요.
          </Text>
        </SafeAreaView>
      );
    }
  }
  return (
    <MobileConfigContext.Provider value={config}>
      {children}
    </MobileConfigContext.Provider>
  );
}

export function useMobileConfig(): MobileConfigResponse | null {
  return useContext(MobileConfigContext);
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  body: { color: colors.text, fontSize: 16, lineHeight: 24, textAlign: "center" },
});
