import { SymbolView, type SFSymbol } from "expo-symbols";
import { Platform, Text, type TextStyle } from "react-native";

export type AppIconName =
  | "arrowUpRight"
  | "chevronDown"
  | "chevronRight"
  | "chevronUp"
  | "close"
  | "location"
  | "person"
  | "refresh"
  | "search"
  | "shield"
  | "swap";

const symbols: Record<AppIconName, SFSymbol> = {
  arrowUpRight: "arrow.up.right",
  chevronDown: "chevron.down",
  chevronRight: "chevron.right",
  chevronUp: "chevron.up",
  close: "xmark",
  location: "location.fill",
  person: "person.crop.circle",
  refresh: "arrow.clockwise",
  search: "magnifyingglass",
  shield: "lock.shield.fill",
  swap: "arrow.up.arrow.down",
};

const fallbacks: Record<AppIconName, string> = {
  arrowUpRight: "↗",
  chevronDown: "↓",
  chevronRight: "→",
  chevronUp: "↑",
  close: "×",
  location: "●",
  person: "●",
  refresh: "↻",
  search: "⌕",
  shield: "●",
  swap: "↕",
};

export function AppIcon({
  color,
  name,
  size = 20,
}: {
  color: string;
  name: AppIconName;
  size?: number;
}) {
  const fallbackStyle: TextStyle = {
    color,
    fontSize: size,
    fontWeight: "800",
    lineHeight: size + 2,
  };
  if (Platform.OS !== "ios") {
    return <Text style={fallbackStyle}>{fallbacks[name]}</Text>;
  }
  return (
    <SymbolView
      fallback={<Text style={fallbackStyle}>{fallbacks[name]}</Text>}
      name={symbols[name]}
      size={size}
      tintColor={color}
      weight="semibold"
    />
  );
}
