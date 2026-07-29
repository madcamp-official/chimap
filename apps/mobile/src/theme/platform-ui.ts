import type { PressableProps, TextStyle, ViewStyle } from "react-native";
import { Platform } from "react-native";

import { chimapTheme } from "./chimap-theme";

type AndroidRipple = NonNullable<PressableProps["android_ripple"]>;

export const androidRipple: AndroidRipple = {
  color: "rgba(29,108,104,0.14)",
  foreground: true,
};

export const androidRippleOnDark: AndroidRipple = {
  color: "rgba(255,255,255,0.18)",
  foreground: true,
};

export const androidRippleOnKakao: AndroidRipple = {
  color: "rgba(25,25,25,0.12)",
  foreground: true,
};

/** Align Android glyph boxes with the compact iOS typographic rhythm. */
export const platformText: TextStyle = Platform.select({
  android: { includeFontPadding: false },
  default: {},
});

/** A restrained Android surface treatment; iOS keeps its existing flat cards. */
export const androidCardSurface: ViewStyle = Platform.select({
  android: {
    borderColor: "rgba(23,49,55,0.08)",
    elevation: 2,
    shadowColor: chimapTheme.shadow,
  },
  default: {},
});

export const androidFloatingSurface: ViewStyle = Platform.select({
  android: {
    elevation: 5,
    shadowColor: chimapTheme.shadow,
  },
  default: {},
});
