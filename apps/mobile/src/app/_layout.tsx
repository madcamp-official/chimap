import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MobileSessionProvider } from "../features/auth/mobile-session";
import { MobileConfigProvider } from "../features/api/mobile-config";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MobileConfigProvider>
        <MobileSessionProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }} />
        </MobileSessionProvider>
      </MobileConfigProvider>
    </SafeAreaProvider>
  );
}
