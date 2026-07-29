import type { Coordinate, Place } from "@chimap/contracts";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { chimapTheme } from "../../theme/chimap-theme";
import { AppIcon } from "../../components/app-icon";
import {
  androidCardSurface,
  androidRipple,
  platformText,
} from "../../theme/platform-ui";
import { searchPlaces } from "./place-api";

function providerLabel(place: Place): string {
  if (place.id.startsWith("naver:")) return "NAVER 주소";
  if (place.id.startsWith("kakao:")) return "KAKAO 장소";
  if (place.id.startsWith("coordinate:")) return "좌표 위치";
  return "장소 정보";
}

export function PlaceSearchField({
  apiBaseUrl,
  label,
  placeholder,
  value,
  center,
  onSelect,
  onClear,
  onFocus,
}: {
  apiBaseUrl: string;
  label: string;
  placeholder: string;
  value: Place | null;
  center?: Coordinate;
  onSelect(place: Place): void;
  onClear(): void;
  onFocus?(): void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    setQuery(value?.name ?? "");
    setResults([]);
    setMessage(null);
  }, [value?.id, value?.name]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2 || normalized === value?.name) {
      setLoading(false);
      setResults([]);
      setMessage(null);
      return undefined;
    }
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setMessage(null);
      void searchPlaces({
        apiBaseUrl,
        query: normalized,
        ...(center === undefined ? {} : { center }),
        signal: controller.signal,
      })
        .then((places) => {
          if (requestSequence.current !== sequence) {
            return;
          }
          setResults(places);
          setMessage(places.length === 0 ? "검색 결과가 없습니다." : null);
        })
        .catch((error: unknown) => {
          if (
            requestSequence.current === sequence &&
            !(error instanceof Error && error.name === "AbortError")
          ) {
            setMessage("장소 검색에 실패했습니다. 다시 입력해 주세요.");
          }
        })
        .finally(() => {
          if (requestSequence.current === sequence) {
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiBaseUrl, center, query, value?.name]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <AppIcon color={focused ? chimapTheme.teal : chimapTheme.muted} name="search" size={19} />
        <TextInput
          accessibilityLabel={`${label} 검색`}
          autoCorrect={false}
          onChangeText={(text) => {
            setQuery(text);
            if (value !== null && text !== value.name) {
              onClear();
            }
          }}
          onBlur={() => setFocused(false)}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onSubmitEditing={Keyboard.dismiss}
          placeholder={placeholder}
          placeholderTextColor={chimapTheme.placeholder}
          returnKeyType="search"
          ref={inputRef}
          style={styles.input}
          value={query}
        />
        {loading ? <ActivityIndicator color={chimapTheme.teal} size="small" /> : null}
        {query.length > 0 ? (
          <Pressable
            accessibilityHint="입력 내용과 검색 결과를 지우고 키보드를 닫습니다."
            accessibilityLabel={`${label} 입력 취소`}
            accessibilityRole="button"
            android_ripple={androidRipple}
            hitSlop={10}
            onPress={() => {
              requestSequence.current += 1;
              setQuery("");
              setResults([]);
              setMessage(null);
              setLoading(false);
              setFocused(false);
              onClear();
              inputRef.current?.blur();
              Keyboard.dismiss();
            }}
            style={styles.clearButton}
          >
            <AppIcon color={chimapTheme.muted} name="close" size={15} />
          </Pressable>
        ) : null}
      </View>
      {message === null ? null : <Text style={styles.message}>{message}</Text>}
      {results.length === 0 ? null : (
        <View style={styles.results}>
          {results.map((place) => (
            <Pressable
              accessibilityRole="button"
              android_ripple={androidRipple}
              key={place.id}
              onPress={() => {
                onSelect(place);
                setQuery(place.name);
                setResults([]);
                Keyboard.dismiss();
              }}
              style={styles.result}
            >
              <View style={styles.resultCopy}>
                <Text style={styles.resultTitle}>{place.name}</Text>
                <Text style={styles.resultAddress}>
                  {place.roadAddress || place.address}
                </Text>
                <View style={styles.resultTags}>
                  {place.category.length === 0 ? null : (
                    <Text numberOfLines={1} style={styles.categoryTag}>
                      {place.category}
                    </Text>
                  )}
                  <Text style={styles.providerTag}>{providerLabel(place)}</Text>
                </View>
              </View>
              <AppIcon color={chimapTheme.teal} name="chevronRight" size={17} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { ...platformText, marginLeft: 3, color: chimapTheme.muted, fontSize: 11, fontWeight: "800" },
  inputWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: chimapTheme.line,
    borderRadius: 13,
    backgroundColor: chimapTheme.white,
  },
  inputWrapFocused: { borderWidth: 2, borderColor: chimapTheme.teal },
  input: {
    ...platformText,
    minWidth: 0,
    minHeight: 48,
    flex: 1,
    color: chimapTheme.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  clearButton: { width: 48, minHeight: 48, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 24 },
  message: { ...platformText, marginHorizontal: 3, color: chimapTheme.danger, fontSize: 12, lineHeight: 17 },
  results: {
    ...androidCardSurface,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: chimapTheme.line,
    borderRadius: 13,
    backgroundColor: chimapTheme.white,
  },
  result: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chimapTheme.line,
  },
  resultCopy: { minWidth: 0, flex: 1, gap: 3 },
  resultTitle: { ...platformText, color: chimapTheme.ink, fontSize: 14, fontWeight: "800" },
  resultAddress: { ...platformText, color: chimapTheme.muted, fontSize: 11 },
  resultTags: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  categoryTag: {
    ...platformText,
    maxWidth: "68%",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    color: chimapTheme.navy,
    backgroundColor: chimapTheme.surfaceSubtle,
    fontSize: 9,
    fontWeight: "800",
  },
  providerTag: {
    ...platformText,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    color: chimapTheme.teal,
    backgroundColor: chimapTheme.selectedSurface,
    fontSize: 9,
    fontWeight: "800",
  },
});
