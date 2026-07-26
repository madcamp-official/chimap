import type { Coordinate, Place } from "@chimap/contracts";
import { colors, radii, spacing } from "@chimap/design-tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { searchPlaces } from "./place-api";

export function PlaceSearchField({
  apiBaseUrl,
  label,
  value,
  center,
  onSelect,
}: {
  apiBaseUrl: string;
  label: string;
  value: Place | null;
  center?: Coordinate;
  onSelect(place: Place): void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setMessage("두 글자 이상 입력해 주세요.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const places = await searchPlaces({
        apiBaseUrl,
        query: normalized,
        ...(center === undefined ? {} : { center }),
      });
      setResults(places);
      if (places.length === 0) {
        setMessage("검색 결과가 없습니다.");
      }
    } catch {
      setMessage("장소 검색에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={`${label} 검색어`}
          placeholder={`${label} 검색`}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void search()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{loading ? "검색 중" : "검색"}</Text>
        </Pressable>
      </View>
      {value === null ? null : (
        <Text style={styles.selected}>선택: {value.name}</Text>
      )}
      {message === null ? null : <Text style={styles.message}>{message}</Text>}
      {results.map((place) => (
        <Pressable
          accessibilityRole="button"
          key={place.id}
          onPress={() => {
            onSelect(place);
            setQuery(place.name);
            setResults([]);
          }}
          style={styles.result}
        >
          <Text style={styles.resultTitle}>{place.name}</Text>
          <Text style={styles.resultAddress} numberOfLines={1}>
            {place.roadAddress || place.address}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, fontWeight: "700" },
  row: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    color: colors.text,
    backgroundColor: colors.background,
  },
  button: {
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "700" },
  selected: { color: colors.primary, fontSize: 13 },
  message: { color: colors.danger, fontSize: 13 },
  result: {
    gap: 2,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  resultTitle: { color: colors.text, fontWeight: "700" },
  resultAddress: { color: colors.textMuted, fontSize: 12 },
});
