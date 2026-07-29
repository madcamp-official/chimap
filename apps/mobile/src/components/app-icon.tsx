import {
  SymbolView,
  type AndroidSymbol,
  type SFSymbol,
  unstable_getMaterialSymbolSourceAsync,
} from "expo-symbols";
import { useEffect, useState } from "react";
import {
  Image,
  Platform,
  Text,
  type ImageSourcePropType,
  type TextStyle,
} from "react-native";

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
  | "settings"
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
  settings: "gearshape.fill",
  shield: "lock.shield.fill",
  swap: "arrow.up.arrow.down",
};

const androidSymbols: Record<AppIconName, AndroidSymbol> = {
  arrowUpRight: "north_east",
  chevronDown: "keyboard_arrow_down",
  chevronRight: "keyboard_arrow_right",
  chevronUp: "keyboard_arrow_up",
  close: "close",
  location: "my_location",
  person: "account_circle",
  refresh: "refresh",
  search: "search",
  settings: "settings",
  shield: "shield",
  swap: "swap_vert",
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
  settings: "⚙",
  shield: "●",
  swap: "↕",
};

const materialSourceCache = new Map<
  string,
  Promise<ImageSourcePropType | null>
>();
const getAndroidMaterialSymbolSource =
  unstable_getMaterialSymbolSourceAsync as unknown as (
    symbol: AndroidSymbol,
    size: number,
    color: string,
  ) => Promise<ImageSourcePropType | null>;

function materialSource(name: AppIconName, size: number, color: string) {
  const key = `${androidSymbols[name]}:${size}:${color}`;
  const cached = materialSourceCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const source = getAndroidMaterialSymbolSource(
    androidSymbols[name],
    size,
    color,
  );
  materialSourceCache.set(key, source);
  return source;
}

function AndroidAppIcon({
  color,
  name,
  size,
  fallbackStyle,
}: {
  color: string;
  name: AppIconName;
  size: number;
  fallbackStyle: TextStyle;
}) {
  const [source, setSource] = useState<ImageSourcePropType | null>(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    void materialSource(name, size, color)
      .then((nextSource) => {
        if (active) {
          setSource(nextSource);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [color, name, size]);

  if (source === null) {
    return (
      <Text
        accessible={false}
        allowFontScaling={false}
        importantForAccessibility="no"
        style={[fallbackStyle, { width: size, height: size, textAlign: "center" }]}
      >
        {fallbacks[name]}
      </Text>
    );
  }
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      source={source}
      style={{ width: size, height: size }}
    />
  );
}

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
  if (Platform.OS === "android") {
    return (
      <AndroidAppIcon
        color={color}
        fallbackStyle={fallbackStyle}
        name={name}
        size={size}
      />
    );
  }
  return (
    <SymbolView
      accessible={false}
      accessibilityElementsHidden
      fallback={
        <Text accessible={false} allowFontScaling={false} style={fallbackStyle}>
          {fallbacks[name]}
        </Text>
      }
      importantForAccessibility="no"
      name={symbols[name]}
      size={size}
      tintColor={color}
      weight="semibold"
    />
  );
}
