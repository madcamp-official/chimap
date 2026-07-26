import { isSameKoreanCalendarDay } from "@chimap/app-core";
import {
  estimatePersonalizedStepLengthMeters,
  recommendationRequestSchema,
  walkingProfileSchema,
  type BiologicalSex,
  type Place,
  type Recommendation,
  type RecommendationRequest,
  type RouteLeg,
  type WalkingMetric,
} from "@chimap/contracts";
import { colors, radii, spacing } from "@chimap/design-tokens";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { requestCurrentLocation } from "../../platform/location/current-location";
import { NativeRouteMap } from "../../platform/maps/native-route-map";
import { stepsSource } from "../../platform/steps/steps-source";
import { reverseGeocode } from "../places/place-api";
import { PlaceSearchField } from "../places/place-search-field";
import {
  hashRecommendationRequest,
  useRecommendationQuery,
} from "./recommendation-query";
import { useRouteStore } from "./route-store-context";

const restoredMetricLabel = "이전에 계산한 보폭을 사용합니다.";

function integer(value: string): number {
  return Number.parseInt(value.trim(), 10);
}

function decimal(value: string): number {
  return Number.parseFloat(value.trim());
}

function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}분`;
}

function meters(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}km` : `${value}m`;
}

function legName(leg: RouteLeg): string {
  if (leg.mode === "WALK") {
    return "도보";
  }
  if (leg.mode === "BUS") {
    return leg.bus?.routeNo === undefined ? "버스" : `${leg.bus.routeNo}번 버스`;
  }
  return leg.name ?? "지하철";
}

function routeCoordinates(route: Recommendation | null) {
  return route?.legs.flatMap((leg) => leg.coordinates) ?? [];
}

function RouteCard({
  route,
  selected,
  onPress,
}: {
  route: Recommendation;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.routeCard, selected && styles.routeCardSelected]}
    >
      <View style={styles.spaceBetween}>
        <Text style={styles.routeTitle}>{route.title}</Text>
        <Text style={styles.routeDuration}>{minutes(route.durationSeconds)}</Text>
      </View>
      <Text style={styles.muted}>{route.reason}</Text>
      <Text style={styles.routeFacts}>
        도보 {meters(route.walkDistanceMeters)} · 예상 {route.estimatedSteps.toLocaleString()}걸음 · 환승 {route.transferCount}회
      </Text>
    </Pressable>
  );
}

function RouteDetailSheet({
  route,
  open,
  onClose,
}: {
  route: Recommendation | null;
  open: boolean;
  onClose(): void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open && route !== null}
    >
      {route === null ? null : (
        <SafeAreaView style={styles.detailSafeArea}>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.spaceBetween}>
              <View style={styles.flexShrink}>
                <Text style={styles.detailTitle}>{route.title}</Text>
                <Text style={styles.muted}>{route.reason}</Text>
              </View>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>닫기</Text>
              </Pressable>
            </View>
            <NativeRouteMap
              color={colors.primary}
              coordinates={routeCoordinates(route)}
              style={styles.detailMap}
            />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryValue}>{minutes(route.durationSeconds)}</Text>
              <Text style={styles.summaryValue}>{meters(route.walkDistanceMeters)}</Text>
              <Text style={styles.summaryValue}>{route.estimatedSteps.toLocaleString()}걸음</Text>
            </View>
            <Text style={styles.sectionTitle}>이동 순서</Text>
            {route.legs.map((leg, index) => (
              <View key={leg.id} style={styles.legRow}>
                <Text style={styles.legIndex}>{index + 1}</Text>
                <View style={styles.flexShrink}>
                  <Text style={styles.legTitle}>{legName(leg)} · {minutes(leg.durationSeconds)}</Text>
                  <Text style={styles.muted}>
                    {leg.guidance ?? `${meters(leg.distanceMeters)} 이동`}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      )}
    </Modal>
  );
}

export function PlannerScreen({
  apiBaseUrl,
  accessToken,
  accountPanel,
}: {
  apiBaseUrl: string;
  accessToken: string;
  accountPanel: ReactNode;
}) {
  const hydrated = useRouteStore((state) => state.hydrated);
  const lastRequest = useRouteStore((state) => state.lastRequest);
  const savedRequestHash = useRouteStore((state) => state.requestHash);
  const requestSavedAt = useRouteStore((state) => state.requestSavedAt);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const detailSheet = useRouteStore((state) => state.detailSheet);
  const rememberRequest = useRouteStore((state) => state.rememberRequest);
  const selectRoute = useRouteStore((state) => state.selectRoute);
  const closeDetailSheet = useRouteStore((state) => state.closeDetailSheet);
  const restored = useRef(false);
  const currentDay = useRef(Date.now());

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [currentSteps, setCurrentSteps] = useState("0");
  const [goalSteps, setGoalSteps] = useState("8000");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [biologicalSex, setBiologicalSex] = useState<BiologicalSex | null>(null);
  const [restoredMetric, setRestoredMetric] = useState<WalkingMetric | null>(null);
  const [activeRequest, setActiveRequest] = useState<RecommendationRequest | null>(null);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [activeRequestSavedAt, setActiveRequestSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [readingSteps, setReadingSteps] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!hydrated || restored.current) {
      return;
    }
    restored.current = true;
    if (lastRequest !== null && savedRequestHash !== null) {
      const sameDay =
        requestSavedAt !== null &&
        isSameKoreanCalendarDay(requestSavedAt, Date.now());
      setOrigin(lastRequest.origin);
      setDestination(lastRequest.destination);
      setCurrentSteps(sameDay ? String(lastRequest.currentSteps) : "0");
      setGoalSteps(String(lastRequest.goalSteps));
      setRestoredMetric(lastRequest.walkingMetric);
      setActiveRequest(sameDay ? lastRequest : null);
      setActiveHash(savedRequestHash);
      setActiveRequestSavedAt(requestSavedAt);
      if (!sameDay) {
        setMessage(
          "이전 경로 상세는 유지했지만 날짜가 바뀌어 현재 걸음을 0으로 초기화했습니다.",
        );
      }
    }
  }, [hydrated, lastRequest, requestSavedAt, savedRequestHash]);

  const query = useRecommendationQuery({
    apiBaseUrl,
    accessToken,
    request: activeRequest,
    requestHash: activeHash,
    requestSavedAt: activeRequestSavedAt,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        return;
      }
      const now = Date.now();
      if (!isSameKoreanCalendarDay(currentDay.current, now)) {
        currentDay.current = now;
        setCurrentSteps("0");
        setActiveRequest(null);
        setMessage(
          "날짜가 바뀌어 현재 걸음을 0으로 초기화했습니다. 건강 앱에서 다시 읽거나 직접 입력해 주세요.",
        );
      }
    });
    return () => subscription.remove();
  }, []);
  const selectedRoute = useMemo(() => {
    const recommendations = query.data?.recommendations;
    if (recommendations === undefined) {
      return null;
    }
    const primaryRecommendationId = query.data?.primaryRecommendationId;
    return (
      recommendations.find((route) => route.id === selectedRouteId) ??
      recommendations.find((route) => route.id === primaryRecommendationId) ??
      recommendations[0] ??
      null
    );
  }, [query.data, selectedRouteId]);

  const profileChanged =
    birthYear.length > 0 ||
    heightCm.length > 0 ||
    weightKg.length > 0 ||
    biologicalSex !== null;

  const readSteps = async () => {
    setReadingSteps(true);
    setMessage(null);
    try {
      setCurrentSteps(String(await stepsSource.readTodaySteps()));
    } catch {
      setMessage("걸음 수를 읽지 못했습니다. 아래 칸에 직접 입력해 계속할 수 있습니다.");
    } finally {
      setReadingSteps(false);
    }
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const coordinate = await requestCurrentLocation();
      setOrigin(await reverseGeocode({ apiBaseUrl, coordinate }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "현재 위치를 가져오지 못했습니다.");
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    setMessage(null);
    if (origin === null || destination === null) {
      setMessage("출발지와 도착지를 모두 선택해 주세요.");
      return;
    }
    let walkingMetric = restoredMetric;
    if (profileChanged || walkingMetric === null) {
      const parsedProfile = walkingProfileSchema.safeParse({
        birthYear: integer(birthYear),
        heightCm: decimal(heightCm),
        weightKg: decimal(weightKg),
        biologicalSex,
      });
      if (!parsedProfile.success) {
        setMessage("생년, 키, 몸무게, 성별을 정확히 입력해 주세요. 보폭 계산에만 사용됩니다.");
        return;
      }
      try {
        walkingMetric = {
          stepLengthMeters: estimatePersonalizedStepLengthMeters(parsedProfile.data),
          source: "RESEARCH_ESTIMATE",
          modelVersion: "HAN_2026_V1",
        };
      } catch {
        setMessage("보폭 계산은 만 18~90세에서 사용할 수 있습니다.");
        return;
      }
    }
    const parsedRequest = recommendationRequestSchema.safeParse({
      origin,
      destination,
      currentSteps: integer(currentSteps),
      goalSteps: integer(goalSteps),
      walkingMetric,
    });
    if (!parsedRequest.success) {
      setMessage("현재 걸음과 목표 걸음을 올바르게 입력해 주세요.");
      return;
    }
    setSubmitting(true);
    try {
      const requestHash = await hashRecommendationRequest(parsedRequest.data);
      rememberRequest(parsedRequest.data, requestHash);
      const requestSavedAt = new Date().toISOString();
      setRestoredMetric(walkingMetric);
      setActiveRequest(parsedRequest.data);
      setActiveHash(requestHash);
      setActiveRequestSavedAt(requestSavedAt);
    } finally {
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator accessibilityLabel="저장된 추천 경로 복원 중" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>CHIMap</Text>
          <Text style={styles.subtitle}>오늘의 걸음 목표를 이동 경로에 자연스럽게 더하세요.</Text>
        </View>
        {accountPanel}
        <View style={styles.card}>
          <View style={styles.spaceBetween}>
            <Text style={styles.sectionTitle}>1. 오늘의 걸음</Text>
            <Pressable accessibilityRole="button" disabled={readingSteps} onPress={() => void readSteps()}>
              <Text style={styles.link}>{readingSteps ? "읽는 중…" : "건강 앱에서 읽기"}</Text>
            </Pressable>
          </View>
          <View style={styles.twoColumns}>
            <LabeledNumber label="현재 걸음" value={currentSteps} onChange={setCurrentSteps} />
            <LabeledNumber label="목표 걸음" value={goalSteps} onChange={setGoalSteps} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.spaceBetween}>
            <Text style={styles.sectionTitle}>2. 출발지와 도착지</Text>
            <Pressable accessibilityRole="button" disabled={locating} onPress={() => void useCurrentLocation()}>
              <Text style={styles.link}>{locating ? "찾는 중…" : "현재 위치 사용"}</Text>
            </Pressable>
          </View>
          <PlaceSearchField apiBaseUrl={apiBaseUrl} label="출발지" value={origin} onSelect={setOrigin} />
          <PlaceSearchField
            apiBaseUrl={apiBaseUrl}
            {...(origin === null ? {} : { center: origin.location })}
            label="도착지"
            value={destination}
            onSelect={setDestination}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>3. 개인 보폭 계산</Text>
          <Text style={styles.muted}>
            입력값은 보폭 계산에만 쓰이며 추천 요청에는 계산된 보폭만 포함됩니다.
          </Text>
          {restoredMetric !== null && !profileChanged ? (
            <Text style={styles.restored}>{restoredMetricLabel} ({restoredMetric.stepLengthMeters.toFixed(2)}m)</Text>
          ) : null}
          <View style={styles.twoColumns}>
            <LabeledNumber label="출생 연도" value={birthYear} onChange={setBirthYear} placeholder="예: 1994" />
            <LabeledNumber label="키(cm)" value={heightCm} onChange={setHeightCm} placeholder="예: 170" decimal />
          </View>
          <View style={styles.twoColumns}>
            <LabeledNumber label="몸무게(kg)" value={weightKg} onChange={setWeightKg} placeholder="예: 65" decimal />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>생물학적 성별</Text>
              <View style={styles.sexRow}>
                {(["MALE", "FEMALE"] as const).map((sex) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: biologicalSex === sex }}
                    key={sex}
                    onPress={() => setBiologicalSex(sex)}
                    style={[styles.sexButton, biologicalSex === sex && styles.sexButtonSelected]}
                  >
                    <Text style={biologicalSex === sex ? styles.sexTextSelected : styles.sexText}>
                      {sex === "MALE" ? "남성" : "여성"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {message === null ? null : <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        <Pressable
          accessibilityRole="button"
          disabled={submitting || query.isFetching}
          onPress={() => void submit()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            {submitting || query.isFetching ? "추천 경로 계산 중…" : "추천 경로 찾기"}
          </Text>
        </Pressable>

        {query.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            추천 경로를 불러오지 못했습니다. 저장된 결과가 있으면 오프라인에서도 유지됩니다.
          </Text>
        ) : null}
        {query.data === undefined ? null : (
          <View style={styles.results}>
            <Text style={styles.sectionTitle}>추천 경로</Text>
            {query.data.warnings.map((warning) => (
              <Text key={warning.code} style={styles.warning}>• {warning.message}</Text>
            ))}
            {selectedRoute === null ? null : (
              <NativeRouteMap
                key={selectedRoute.id}
                color={colors.primary}
                coordinates={routeCoordinates(selectedRoute)}
                style={styles.map}
              />
            )}
            {query.data.recommendations.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                selected={selectedRoute?.id === route.id}
                onPress={() => selectRoute(route.id, route.type)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      <RouteDetailSheet route={selectedRoute} open={detailSheet.open} onClose={closeDetailSheet} />
    </SafeAreaView>
  );
}

function LabeledNumber({
  label,
  value,
  onChange,
  placeholder,
  decimal: allowDecimal = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  decimal?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={allowDecimal ? "decimal-pad" : "number-pad"}
        onChangeText={onChange}
        placeholder={placeholder}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  header: { gap: spacing.xs, paddingVertical: spacing.sm },
  title: { color: colors.primary, fontSize: 30, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  card: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  restored: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  twoColumns: { flexDirection: "row", gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 44, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, color: colors.text, backgroundColor: colors.background },
  sexRow: { flexDirection: "row", gap: spacing.xs },
  sexButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  sexButtonSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  sexText: { color: colors.text },
  sexTextSelected: { color: "#FFFFFF", fontWeight: "700" },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primary },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  results: { gap: spacing.sm },
  map: { height: 260, borderRadius: radii.lg, overflow: "hidden" },
  routeCard: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  routeCardSelected: { borderColor: colors.primary, borderWidth: 2 },
  routeTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "800" },
  routeDuration: { color: colors.primary, fontSize: 17, fontWeight: "800" },
  routeFacts: { color: colors.text, fontSize: 13, fontWeight: "600" },
  spaceBetween: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  flexShrink: { flex: 1, flexShrink: 1, gap: spacing.xs },
  detailSafeArea: { flex: 1, backgroundColor: colors.background },
  detailContent: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  detailTitle: { color: colors.text, fontSize: 24, fontWeight: "800" },
  closeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.surface },
  closeButtonText: { color: colors.primary, fontWeight: "800" },
  detailMap: { height: 300, borderRadius: radii.lg, overflow: "hidden" },
  summaryRow: { flexDirection: "row", justifyContent: "space-around", padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  summaryValue: { color: colors.text, fontWeight: "800" },
  legRow: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  legIndex: { width: 28, height: 28, overflow: "hidden", borderRadius: radii.pill, color: "#FFFFFF", backgroundColor: colors.primary, textAlign: "center", lineHeight: 28, fontWeight: "800" },
  legTitle: { color: colors.text, fontWeight: "800" },
});
