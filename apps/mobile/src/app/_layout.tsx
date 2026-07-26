import "react-native-gesture-handler";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { MobileSessionProvider } from "../features/auth/mobile-session";
import { MobileConfigProvider } from "../features/api/mobile-config";

export default function RootLayout() {
  return (
    <MobileConfigProvider>
      <MobileSessionProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileSessionProvider>
    </MobileConfigProvider>
  );
}
