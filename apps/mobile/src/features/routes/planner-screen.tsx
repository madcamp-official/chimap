import { isSameKoreanCalendarDay } from "@chimap/app-core";
import {
  estimatePersonalizedStepLengthMeters,
  recommendationRequestSchema,
  type Coordinate,
  type Place,
  type Recommendation,
  type RecommendationRequest,
  type RecommendationType,
  type RouteLeg,
  type RouteMode,
} from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AccessibilityInfo,
  Animated,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { requestCurrentLocation } from "../../platform/location/current-location";
import { NativeRouteMap } from "../../platform/maps/native-route-map";
import {
  openStepRecovery,
  stepsSource,
} from "../../platform/steps/steps-source";
import {
  StepSourceError,
  type StepSourceErrorCode,
  type StepSourceRecoveryAction,
} from "../../platform/steps/steps-contract";
import { chimapTheme } from "../../theme/chimap-theme";
import { useMobileConfig } from "../api/mobile-config";
import { reverseGeocode } from "../places/place-api";
import { PlaceSearchField } from "../places/place-search-field";
import type { SavedWalkingProfile } from "../profile/walking-profile-storage";
import { getNearbySubwayStations, getSubwayDepartures } from "../transit/transit-api";
import { useRouteTransit } from "../transit/use-route-transit";
import {
  hashRecommendationRequest,
  useRecommendationQuery,
} from "./recommendation-query";
import {
  formatClockTime as clockTime,
  formatMeters as meters,
  formatMinutes as minutes,
  formatRouteSequence as routeSequence,
  formatStepDifference as stepDifference,
  summarizeModeDistances,
  summarizeOrderedModeDistances,
} from "./recommendation-presentation";
import {
  clampPlannerSheetPosition,
  nearestPlannerSheetSnap,
  plannerSheetOffsets,
  type PlannerSheetSnap,
} from "./planner-sheet-snap";
import { plannerSheetTransition } from "./planner-sheet-state";
import { useRouteStore } from "./route-store-context";

function integer(value: string): number {
  return Number.parseInt(value.trim(), 10);
}

type HealthStatus = "reading" | "connected" | StepSourceErrorCode;

function healthServiceName(): string {
  return Platform.OS === "android" ? "Health Connect" : "HealthKit";
}

function healthStatusLabel(status: HealthStatus): string {
  if (status === "reading") return "확인 중";
  if (status === "connected") return "걸음 연동됨";
  if (status === "PROVIDER_UPDATE_REQUIRED") return "업데이트 필요";
  if (status === "PERMISSION_DENIED") return "걸음 접근 필요";
  if (status === "READ_FAILED") return "다시 시도 필요";
  return "사용할 수 없음";
}

function healthErrorMessage(error: StepSourceError): string {
  if (error.code === "PROVIDER_UPDATE_REQUIRED") {
    return "Health Connect를 설치하거나 최신 버전으로 업데이트해 주세요. 검색과 수동 걸음 입력은 계속 사용할 수 있습니다.";
  }
  if (error.code === "PERMISSION_DENIED") {
    return `${healthServiceName()}에서 CHIMap의 걸음 읽기 권한을 허용해 주세요. 검색과 수동 걸음 입력은 계속 사용할 수 있습니다.`;
  }
  if (error.code === "UNAVAILABLE") {
    return `${healthServiceName()}를 사용할 수 없습니다. 잠시 후 다시 시도하거나 걸음 수를 직접 입력해 주세요.`;
  }
  return `${healthServiceName()} 걸음 수를 읽지 못했습니다. 다시 시도하거나 걸음 수를 직접 입력해 주세요.`;
}

function RouteTracer() {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);
  return (
    <View accessibilityLabel="도보와 대중교통 경로를 비교하는 중" style={styles.routeTracer}>
      {[chimapTheme.orange, chimapTheme.busBlue, chimapTheme.purple].map((color, index) => (
        <Animated.View
          key={color}
          style={[
            styles.routeTracerSegment,
            { backgroundColor: color, opacity: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: index === 1 ? [0.35, 1, 0.35] : [1, 0.45, 1] }) },
          ]}
        />
      ))}
    </View>
  );
}

function recommendationType(type: RecommendationType): string {
  if (type === "FAST") {
    return "가장 빠름";
  }
  if (type === "GOAL") {
    return "목표에 가까움";
  }
  return "균형 경로";
}

function recommendationColor(type: RecommendationType): string {
  if (type === "FAST") {
    return chimapTheme.navy;
  }
  if (type === "GOAL") {
    return chimapTheme.orange;
  }
  return chimapTheme.teal;
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

function modeName(mode: RouteMode): string {
  if (mode === "BUS") {
    return "버스";
  }
  if (mode === "SUBWAY") {
    return "지하철";
  }
  return "도보";
}

function modeColor(mode: RouteMode): string {
  if (mode === "BUS") {
    return chimapTheme.busBlue;
  }
  if (mode === "SUBWAY") {
    return chimapTheme.purple;
  }
  return chimapTheme.orange;
}

function legColor(leg: RouteLeg): string {
  return modeColor(leg.mode);
}

function RouteCard({
  route,
  selected,
  onSelect,
  onOpenDetail,
}: {
  route: Recommendation;
  selected: boolean;
  onSelect(): void;
  onOpenDetail(): void;
}) {
  const distanceByMode = summarizeModeDistances(route);
  const orderedDistanceSegments = summarizeOrderedModeDistances(route);
  const distanceSummary = distanceByMode
    .map((item) => `${modeName(item.mode)} ${meters(item.meters)}`)
    .join(", ");
  return (
    <View style={[styles.routeCard, selected && styles.routeCardSelected]}>
      {route.dailyGoalCompletionRate >= 1 ? <View style={styles.goalLine} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onSelect}
        style={styles.routeSummary}
      >
        <View style={styles.routeTopline}>
          <View
            style={[
              styles.routeType,
              { backgroundColor: recommendationColor(route.type) },
            ]}
          >
            <Text style={styles.routeTypeText}>{recommendationType(route.type)}</Text>
          </View>
          {route.isRealtime === true ? (
            <Text style={styles.realtimeBadge}>실시간</Text>
          ) : (
            <Text style={styles.estimateBadge}>예상</Text>
          )}
        </View>
        <View style={styles.routeTimeRow}>
          <Text style={styles.routeTime}>{minutes(route.durationSeconds)}</Text>
          <Text style={styles.routeArrival}>도착 {clockTime(route.arrivalAt)}</Text>
          <Text style={styles.routeExtra}>
            {route.extraMinutes > 0 ? `기본보다 +${route.extraMinutes}분` : "가장 빠른 기준"}
          </Text>
        </View>
        <View
          accessibilityLabel={`이동 거리 비율: ${distanceSummary}`}
          accessible
          style={styles.modeStrip}
        >
          {orderedDistanceSegments.map((item, index) => (
            <View
              key={`${item.mode}:${index}`}
              style={[
                styles.modeStripSegment,
                {
                  flexGrow: item.meters,
                  backgroundColor: modeColor(item.mode),
                },
              ]}
            />
          ))}
        </View>
        <Text numberOfLines={2} style={styles.routeSequence}>
          {routeSequence(route)}
        </Text>
        <View style={styles.modeDistanceLegend}>
          {distanceByMode.map((item) => (
            <View key={item.mode} style={styles.modeDistanceItem}>
              <View
                style={[
                  styles.modeDistanceDot,
                  { backgroundColor: modeColor(item.mode) },
                ]}
              />
              <Text style={styles.modeDistanceText}>
                {modeName(item.mode)} {meters(item.meters)}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.routeMetrics}>
          <Text style={styles.routeMetric}>
            도보 {minutes(route.legs.filter((leg) => leg.mode === "WALK").reduce((sum, leg) => sum + leg.durationSeconds, 0))} · {meters(route.walkDistanceMeters)}
          </Text>
          <Text style={styles.routeMetric}>
            예상 {route.estimatedSteps.toLocaleString()}걸음
          </Text>
          <Text style={styles.routeMetric}>환승 {route.transferCount}회</Text>
          <Text style={styles.routeMetricStrong}>
            목표 {Math.round(route.dailyGoalCompletionRate * 100)}% · {stepDifference(route)}
          </Text>
        </View>
      </Pressable>
      <View style={styles.routeActions}>
        <Text numberOfLines={1} style={styles.routeReason}>
          {route.reason}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenDetail}
          style={styles.detailButton}
        >
          <Text style={styles.detailButtonText}>자세히</Text>
          <AppIcon color={chimapTheme.teal} name="chevronRight" size={14} />
        </Pressable>
      </View>
    </View>
  );
}

function AccountSheet({
  open,
  displayName,
  healthStatus,
  recoveryAction,
  profile,
  refreshingSteps,
  onClose,
  onEditProfile,
  onRefreshSteps,
  onRecoverSteps,
  onLogout,
  onDeleteAccount,
}: {
  open: boolean;
  displayName: string;
  healthStatus: HealthStatus;
  recoveryAction: StepSourceRecoveryAction | null;
  profile: SavedWalkingProfile;
  refreshingSteps: boolean;
  onClose(): void;
  onEditProfile(): void;
  onRefreshSteps(): Promise<void>;
  onRecoverSteps(): Promise<void>;
  onLogout(): Promise<void>;
  onDeleteAccount(): Promise<void>;
}) {
  const stride = estimatePersonalizedStepLengthMeters(profile.walkingProfile);
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open}
    >
      <SafeAreaView edges={["top", "bottom"]} style={styles.detailSafeArea}>
        <ScrollView contentContainerStyle={styles.accountContent}>
          <View style={styles.detailHeading}>
            <View style={styles.detailHeadingCopy}>
              <Text style={styles.eyebrow}>내 정보</Text>
              <Text style={styles.detailTitle}>{displayName}</Text>
              <Text style={styles.muted}>카카오 계정으로 로그인 중</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>닫기</Text>
            </Pressable>
          </View>
          <View style={styles.accountCard}>
            <View style={styles.accountFactRow}>
              <Text style={styles.accountFactLabel}>개인화 한 걸음</Text>
              <Text style={styles.accountFactValue}>{(stride * 100).toFixed(1)}cm</Text>
            </View>
            <View style={styles.accountFactRow}>
              <Text style={styles.accountFactLabel}>하루 목표</Text>
              <Text style={styles.accountFactValue}>{profile.dailyGoalSteps.toLocaleString()}걸음</Text>
            </View>
            <View style={styles.accountFactRow}>
              <Text style={styles.accountFactLabel}>{healthServiceName()}</Text>
              <Text style={styles.accountFactValue}>
                {healthStatusLabel(healthStatus)}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={refreshingSteps}
            onPress={() => void onRefreshSteps()}
            style={styles.accountRefreshAction}
          >
            {refreshingSteps ? (
              <ActivityIndicator color={chimapTheme.teal} size="small" />
            ) : (
              <AppIcon color={chimapTheme.teal} name="refresh" size={18} />
            )}
            <Text style={styles.accountRefreshText}>현재 걸음 새로고침</Text>
          </Pressable>
          {recoveryAction === "OPEN_PROVIDER_UPDATE" ||
          recoveryAction === "OPEN_SETTINGS" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void onRecoverSteps()}
              style={styles.accountRefreshAction}
            >
              <AppIcon color={chimapTheme.teal} name="settings" size={18} />
              <Text style={styles.accountRefreshText}>
                {recoveryAction === "OPEN_PROVIDER_UPDATE"
                  ? "Health Connect 설치·업데이트"
                  : `${healthServiceName()} 설정 열기`}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onEditProfile();
            }}
            style={styles.accountPrimaryAction}
          >
            <Text style={styles.accountPrimaryText}>보폭·목표 수정</Text>
          </Pressable>
          <View style={styles.accountDangerZone}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void onLogout()}
              style={styles.accountAction}
            >
              <Text style={styles.accountActionText}>로그아웃</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  "계정을 삭제할까요?",
                  "서버 계정과 세션, 이 기기의 경로 및 개인화 정보가 삭제됩니다.",
                  [
                    { text: "취소", style: "cancel" },
                    {
                      text: "계정 삭제",
                      style: "destructive",
                      onPress: () => void onDeleteAccount(),
                    },
                  ],
                )
              }
              style={styles.accountAction}
            >
              <Text style={styles.accountDeleteText}>계정 삭제</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function NearbySubwaySummary({
  accessToken,
  apiBaseUrl,
  destination,
  open,
  origin,
}: {
  accessToken: string;
  apiBaseUrl: string;
  destination: Place | null;
  open: boolean;
  origin: Place | null;
}) {
  const query = useQuery({
    queryKey: ["nearby-subway", origin?.id ?? "none", destination?.id ?? "none"],
    enabled: open && origin !== null && destination !== null,
    queryFn: async ({ signal }) => {
      if (origin === null || destination === null) {
        return { items: [], partial: false };
      }
      const endpoints = [
        { label: "출발지 주변", coordinate: origin.location },
        { label: "도착지 주변", coordinate: destination.location },
      ];
      const results = await Promise.allSettled(
        endpoints.map(async (endpoint) => {
          const stations = await getNearbySubwayStations({
            apiBaseUrl,
            accessToken,
            coordinate: endpoint.coordinate,
            limit: 1,
            signal,
          });
          const station = stations.items[0];
          if (station === undefined) return { ...endpoint, station: null, departure: null, partial: false };
          if (station.mappingStatus !== "MAPPED") {
            return { ...endpoint, station, departure: null, partial: false };
          }
          const departures = await Promise.allSettled(
            (["U", "D"] as const).map((direction) =>
              getSubwayDepartures({
                apiBaseUrl,
                accessToken,
                stationId: station.id,
                direction,
                limit: 1,
                signal,
              }),
            ),
          );
          const departure = departures
            .flatMap((result) => result.status === "fulfilled" ? result.value.items : [])
            .sort((a, b) => a.departureAt.localeCompare(b.departureAt))[0] ?? null;
          return {
            ...endpoint,
            station,
            departure,
            partial: departures.some((result) => result.status === "rejected"),
          };
        }),
      );
      const items = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (items.length === 0 && results.some((result) => result.status === "rejected")) {
        throw new Error("주변 역 정보를 불러오지 못했습니다.");
      }
      return {
        items,
        partial:
          results.some((result) => result.status === "rejected") ||
          items.some((item) => item.partial),
      };
    },
  });
  return (
    <View style={styles.nearbySection}>
      <Text style={styles.sectionTitle}>주변 지하철</Text>
      {query.isLoading ? <ActivityIndicator color={chimapTheme.teal} /> : null}
      {query.isError ? (
        <Text style={styles.supportingNotice}>주변 역 정보만 불러오지 못했습니다. 경로 이용에는 영향이 없습니다.</Text>
      ) : null}
      {query.data?.partial ? (
        <Text style={styles.supportingNotice}>일부 역 또는 시간표 정보가 지연됐습니다. 확인된 정보만 표시합니다.</Text>
      ) : null}
      {query.data?.items.map((item) => (
        <View key={item.label} style={styles.nearbyCard}>
          <Text style={styles.nearbyLabel}>{item.label}</Text>
          <Text style={styles.nearbyStation}>
            {item.station === null ? "2km 안에 역 없음" : `${item.station.name} · ${item.station.lineName}`}
          </Text>
          {item.station === null ? null : item.station.mappingStatus !== "MAPPED" ? (
            <Text style={styles.muted}>출발 시간표가 아직 연결되지 않았습니다.</Text>
          ) : item.departure === null ? (
            <Text style={styles.muted}>예정된 출발 정보가 없습니다.</Text>
          ) : (
            <Text style={styles.muted}>
              {clockTime(item.departure.departureAt)} · {item.departure.terminalStationName} 방면
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function RouteDetailSheet({
  route,
  open,
  origin,
  destination,
  accessToken,
  apiBaseUrl,
  vehiclePositions,
  onClose,
}: {
  route: Recommendation | null;
  open: boolean;
  origin: Place | null;
  destination: Place | null;
  accessToken: string;
  apiBaseUrl: string;
  vehiclePositions: ReturnType<typeof useRouteTransit>["vehiclePositions"];
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
        <SafeAreaView edges={["top", "bottom"]} style={styles.detailSafeArea}>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailHeading}>
              <View style={styles.detailHeadingCopy}>
                <Text style={styles.eyebrow}>건강 경로 상세</Text>
                <Text style={styles.detailTitle}>{route.title}</Text>
                <Text style={styles.muted}>{route.reason}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>닫기</Text>
              </Pressable>
            </View>
            <NativeRouteMap
              destination={destination?.location ?? null}
              origin={origin?.location ?? null}
              route={route}
              vehiclePositions={vehiclePositions}
              viewportInsets={{ top: 16, right: 16, bottom: 16, left: 16 }}
              style={styles.detailMap}
            />
            <View style={styles.detailFacts}>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>소요 시간</Text>
                <Text style={styles.detailFactValue}>{minutes(route.durationSeconds)}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>예상 도착</Text>
                <Text style={styles.detailFactValue}>{clockTime(route.arrivalAt)}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>예상 요금</Text>
                <Text style={styles.detailFactValue}>{route.fareWon === undefined ? "정보 없음" : `${route.fareWon.toLocaleString()}원`}</Text>
              </View>
            </View>
            <View style={styles.detailFacts}>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>걷는 거리</Text>
                <Text style={styles.detailFactValue}>{meters(route.walkDistanceMeters)}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>예상 걸음</Text>
                <Text style={styles.detailFactValue}>{route.estimatedSteps.toLocaleString()}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>목표 달성</Text>
                <Text style={styles.detailFactValue}>{Math.round(route.dailyGoalCompletionRate * 100)}%</Text>
              </View>
            </View>
            {route.legs.some((leg) => leg.geometryQuality === "APPROXIMATE") ? (
              <Text style={styles.geometryNotice}>
                일부 구간은 상세 도로·도보 형상을 확인하지 못해 근사 경로로 표시합니다.
              </Text>
            ) : null}
            <Text style={styles.sectionTitle}>이동 순서</Text>
            <View style={styles.legList}>
              {route.legs.map((leg, index) => (
                <View key={leg.id} style={styles.legRow}>
                  <View style={[styles.legIndex, { backgroundColor: legColor(leg) }]}>
                    <Text style={styles.legIndexText}>{index + 1}</Text>
                  </View>
                  <View style={styles.legCopy}>
                    <Text style={styles.legTitle}>
                      {legName(leg)} · {minutes(leg.durationSeconds)}
                    </Text>
                    <Text style={styles.muted}>
                      {leg.guidance ?? `${meters(leg.distanceMeters)} 이동`}
                    </Text>
                    {leg.bus === undefined ? null : (
                      <>
                        <Text style={styles.legMeta}>
                          {leg.bus.boardingStop.name} 승차 → {leg.bus.alightingStop.name} 하차 · {leg.bus.stopCount}정류장
                        </Text>
                        {leg.bus.vehicleType?.includes("저상") === true ? (
                          <Text style={styles.lowFloorBadge}>저상버스</Text>
                        ) : null}
                      </>
                    )}
                    {leg.subway === undefined ? null : (
                      <Text style={styles.legMeta}>
                        {leg.subway.boardingStation.name} 승차 → {leg.subway.alightingStation.name} 하차 · {leg.subway.stationCount}개 역
                      </Text>
                    )}
                    {leg.isExerciseSegment ? <Text style={styles.exerciseBadge}>운동 도보 구간</Text> : null}
                    {leg.timing === undefined ? null : (
                      <Text style={leg.timing.isRealtime ? styles.realtimeText : styles.estimatedText}>
                        {leg.timing.isRealtime ? "실시간" : "예상"} · 탑승 {clockTime(leg.timing.plannedBoardingAt)}
                        {leg.timing.stale ? " · 업데이트 지연" : ""}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.estimationBox}>
              <Text style={styles.noticeTitle}>추천 및 예상값 계산 근거</Text>
              <Text style={styles.muted}>{route.reason}</Text>
              {(route.estimationNotes ?? []).map((note) => (
                <Text key={note} style={styles.muted}>• {note}</Text>
              ))}
            </View>
            <NearbySubwaySummary
              accessToken={accessToken}
              apiBaseUrl={apiBaseUrl}
              destination={destination}
              open={open}
              origin={origin}
            />
          </ScrollView>
        </SafeAreaView>
      )}
    </Modal>
  );
}

export function PlannerScreen({
  apiBaseUrl,
  accessToken,
  displayName,
  profile,
  onEditProfile,
  onLogout,
  onDeleteAccount,
}: {
  apiBaseUrl: string;
  accessToken: string;
  displayName: string;
  profile: SavedWalkingProfile;
  onEditProfile(): void;
  onLogout(): Promise<void>;
  onDeleteAccount(): Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const mobileConfig = useMobileConfig();
  const hydrated = useRouteStore((state) => state.hydrated);
  const lastRequest = useRouteStore((state) => state.lastRequest);
  const savedRequestHash = useRouteStore((state) => state.requestHash);
  const requestSavedAt = useRouteStore((state) => state.requestSavedAt);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const detailSheet = useRouteStore((state) => state.detailSheet);
  const rememberRequest = useRouteStore((state) => state.rememberRequest);
  const selectRoute = useRouteStore((state) => state.selectRoute);
  const openDetail = useRouteStore((state) => state.openDetail);
  const closeDetailSheet = useRouteStore((state) => state.closeDetailSheet);
  const restored = useRef(false);
  const currentDay = useRef(Date.now());
  const automaticStepRead = useRef(false);
  const restoringResults = useRef(false);
  const walkingMetric = useMemo(
    () => ({
      stepLengthMeters: estimatePersonalizedStepLengthMeters(
        profile.walkingProfile,
      ),
      source: "RESEARCH_ESTIMATE" as const,
      modelVersion: "HAN_2026_V1" as const,
    }),
    [profile.walkingProfile],
  );

  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [currentSteps, setCurrentSteps] = useState("0");
  const [activeRequest, setActiveRequest] = useState<RecommendationRequest | null>(null);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [activeRequestSavedAt, setActiveRequestSavedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [readingSteps, setReadingSteps] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("reading");
  const [stepRecoveryAction, setStepRecoveryAction] =
    useState<StepSourceRecoveryAction | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [locating, setLocating] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [locationFocusRequestId, setLocationFocusRequestId] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [mapStageWidth, setMapStageWidth] = useState(0);
  const [mapStageHeight, setMapStageHeight] = useState(0);
  const [sheetSnap, setSheetSnap] = useState<PlannerSheetSnap>("middle");
  const sheetPosition = useRef(new Animated.Value(1_000)).current;
  const sheetCurrentPosition = useRef(1_000);
  const sheetDragStart = useRef(1_000);
  const sheetSnapRef = useRef<PlannerSheetSnap>("middle");
  const sheetOffsets = useMemo(
    () => plannerSheetOffsets(mapStageHeight, insets.bottom),
    [insets.bottom, mapStageHeight],
  );
  const sheetOffsetsRef = useRef(sheetOffsets);
  sheetOffsetsRef.current = sheetOffsets;

  const snapSheet = useCallback(
    (nextSnap: PlannerSheetSnap, animated = true) => {
      const nextPosition = sheetOffsetsRef.current[nextSnap];
      sheetSnapRef.current = nextSnap;
      setSheetSnap(nextSnap);
      sheetPosition.stopAnimation();
      if (!animated || reduceMotion) {
        sheetCurrentPosition.current = nextPosition;
        sheetPosition.setValue(nextPosition);
        return;
      }
      Animated.spring(sheetPosition, {
        toValue: nextPosition,
        damping: 24,
        stiffness: 230,
        mass: 0.9,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          sheetCurrentPosition.current = nextPosition;
        }
      });
    },
    [reduceMotion, sheetPosition],
  );

  const invalidateResult = useCallback(() => {
    setActiveRequest(null);
    setActiveHash(null);
    setActiveRequestSavedAt(null);
    setMessage(null);
  }, []);

  const readSteps = useCallback(async (requestPermission = false) => {
    setReadingSteps(true);
    setHealthStatus("reading");
    setStepRecoveryAction(null);
    setMessage(null);
    try {
      const steps = await stepsSource.readTodaySteps({
        now: new Date(),
        requestPermission,
      });
      setCurrentSteps(String(steps));
      setHealthStatus("connected");
      invalidateResult();
    } catch (error) {
      if (error instanceof StepSourceError) {
        setHealthStatus(error.code);
        setStepRecoveryAction(error.recoveryAction);
        setMessage(healthErrorMessage(error));
      } else {
        setHealthStatus("READ_FAILED");
        setStepRecoveryAction("RETRY");
        setMessage(
          `${healthServiceName()} 걸음 수를 읽지 못했습니다. 걸음 수를 직접 입력하거나 다시 시도해 주세요.`,
        );
      }
    } finally {
      setReadingSteps(false);
    }
  }, [invalidateResult]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (mapStageHeight > 0) {
      snapSheet(sheetSnapRef.current, false);
    }
  }, [insets.bottom, mapStageHeight, snapSheet]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          sheetPosition.stopAnimation((value) => {
            sheetCurrentPosition.current = value;
            sheetDragStart.current = value;
          });
        },
        onPanResponderMove: (_event, gesture) => {
          const nextPosition = clampPlannerSheetPosition(
            sheetOffsetsRef.current,
            sheetDragStart.current + gesture.dy,
          );
          sheetCurrentPosition.current = nextPosition;
          sheetPosition.setValue(nextPosition);
        },
        onPanResponderRelease: (_event, gesture) => {
          snapSheet(
            nearestPlannerSheetSnap(
              sheetOffsetsRef.current,
              sheetCurrentPosition.current,
              gesture.vy,
            ),
          );
        },
        onPanResponderTerminate: () => {
          snapSheet(
            nearestPlannerSheetSnap(
              sheetOffsetsRef.current,
              sheetCurrentPosition.current,
              0,
            ),
          );
        },
      }),
    [sheetPosition, snapSheet],
  );

  const query = useRecommendationQuery({
    apiBaseUrl,
    accessToken,
    request: activeRequest,
    requestHash: activeHash,
    requestSavedAt: activeRequestSavedAt,
  });

  useEffect(() => {
    if (!hydrated || restored.current) {
      return;
    }
    restored.current = true;
    if (lastRequest === null || savedRequestHash === null) {
      return;
    }
    const sameDay =
      requestSavedAt !== null &&
      isSameKoreanCalendarDay(requestSavedAt, Date.now());
    setOrigin(lastRequest.origin);
    setDestination(lastRequest.destination);
    setCurrentSteps(sameDay ? String(lastRequest.currentSteps) : "0");
    const profileMatches =
      lastRequest.goalSteps === profile.dailyGoalSteps &&
      Math.abs(
        lastRequest.walkingMetric.stepLengthMeters - walkingMetric.stepLengthMeters,
      ) < 0.0001;
    if (sameDay && profileMatches) {
      restoringResults.current = true;
      setActiveRequest(lastRequest);
      setActiveHash(savedRequestHash);
      setActiveRequestSavedAt(requestSavedAt);
    }
  }, [
    hydrated,
    lastRequest,
    profile.dailyGoalSteps,
    requestSavedAt,
    savedRequestHash,
    walkingMetric.stepLengthMeters,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        return;
      }
      if (!isSameKoreanCalendarDay(currentDay.current, Date.now())) {
        currentDay.current = Date.now();
        setCurrentSteps("0");
        setActiveRequest(null);
        setActiveHash(null);
        setActiveRequestSavedAt(null);
      }
      void readSteps(false);
    });
    return () => subscription.remove();
  }, [readSteps]);

  useEffect(() => {
    if (!hydrated || automaticStepRead.current) {
      return;
    }
    automaticStepRead.current = true;
    void readSteps(false);
  }, [hydrated, readSteps]);

  const selectedRoute = useMemo(() => {
    const recommendations = query.data?.recommendations;
    if (recommendations === undefined) {
      return null;
    }
    return (
      recommendations.find((route) => route.id === selectedRouteId) ??
      recommendations.find(
        (route) => route.id === query.data?.primaryRecommendationId,
      ) ??
      recommendations[0] ??
      null
    );
  }, [query.data, selectedRouteId]);

  useEffect(() => {
    if (query.data !== undefined && restoringResults.current) {
      restoringResults.current = false;
      snapSheet(
        plannerSheetTransition(sheetSnapRef.current, {
          type: "RESTORE",
          hasSelectedRoute: query.data.recommendations.length > 0,
        }),
        false,
      );
    }
  }, [query.data, snapSheet]);

  const transit = useRouteTransit({
    apiBaseUrl,
    accessToken,
    route: selectedRoute,
    pollingIntervalSeconds: mobileConfig?.vehiclePollingIntervalSeconds ?? 15,
  });

  const focusCurrentLocation = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const coordinate = await requestCurrentLocation();
      setCurrentLocation(coordinate);
      setLocationFocusRequestId((value) => value + 1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "현재 위치를 가져오지 못했습니다.",
      );
      snapSheet("middle");
    } finally {
      setLocating(false);
    }
  };

  const useCurrentLocation = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const coordinate = await requestCurrentLocation();
      setCurrentLocation(coordinate);
      setLocationFocusRequestId((value) => value + 1);
      setOrigin(
        await reverseGeocode({
          apiBaseUrl,
          coordinate,
          fallbackName: "현재 위치",
        }),
      );
      invalidateResult();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "현재 위치를 가져오지 못했습니다.",
      );
    } finally {
      setLocating(false);
    }
  };

  const submit = async () => {
    Keyboard.dismiss();
    setMessage(null);
    if (origin === null || destination === null) {
      setMessage("출발지와 도착지를 선택해 주세요.");
      return;
    }
    const parsed = recommendationRequestSchema.safeParse({
      origin,
      destination,
      currentSteps: integer(currentSteps),
      goalSteps: profile.dailyGoalSteps,
      walkingMetric,
    });
    if (!parsed.success) {
      setMessage(
        `${healthServiceName()} 걸음 정보를 확인하지 못했습니다. 내 정보에서 다시 불러오거나 직접 입력해 주세요.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const requestHash = await hashRecommendationRequest(parsed.data);
      const savedAt = new Date().toISOString();
      rememberRequest(parsed.data, requestHash);
      setActiveRequest(parsed.data);
      setActiveHash(requestHash);
      setActiveRequestSavedAt(savedAt);
      snapSheet(plannerSheetTransition(sheetSnapRef.current, { type: "CALCULATING" }));
    } finally {
      setSubmitting(false);
    }
  };

  const sheetSummary =
    origin === null || destination === null
      ? "출발지와 도착지를 선택하세요"
      : `${origin.name} → ${destination.name}`;
  const parsedCurrentSteps = integer(currentSteps || "0");
  const currentStepsLabel = Number.isFinite(parsedCurrentSteps)
    ? parsedCurrentSteps.toLocaleString()
    : "0";

  const toggleSheet = () => {
    snapSheet(plannerSheetTransition(sheetSnap, { type: "TOGGLE" }));
  };

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={chimapTheme.teal} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appHeader}>
        <View style={styles.headerCompactRow}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <AppIcon color={chimapTheme.navyStrong} name="arrowUpRight" size={18} />
            </View>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.brand}>CHIMap</Text>
          </View>
          <View accessibilityLabel={`현재 걸음 ${currentStepsLabel}걸음`} style={styles.compactMetric}>
            <Text numberOfLines={1} style={styles.compactMetricLabel}>현재걸음</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.compactMetricValue}>
              {readingSteps ? "확인 중" : currentStepsLabel}
            </Text>
          </View>
          <View accessibilityLabel={`목표 걸음 ${profile.dailyGoalSteps.toLocaleString()}걸음`} style={styles.compactMetric}>
            <Text numberOfLines={1} style={styles.compactMetricLabel}>목표걸음</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.compactMetricValue}>
              {profile.dailyGoalSteps.toLocaleString()}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="내 정보 열기"
            accessibilityRole="button"
            onPress={() => setAccountOpen(true)}
            style={styles.accountButton}
          >
            <AppIcon color={chimapTheme.white} name="person" size={17} />
            <Text numberOfLines={1} style={styles.accountButtonText}>내 정보</Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View
          onLayout={(event) => {
            setMapStageWidth(event.nativeEvent.layout.width);
            setMapStageHeight(event.nativeEvent.layout.height);
          }}
          style={styles.mapStage}
        >
          <View style={styles.mapShell}>
            {mapStageWidth === 0 || mapStageHeight === 0 ? null : (
              <NativeRouteMap
                destination={destination?.location ?? null}
                focusCoordinate={currentLocation}
                focusRequestId={locationFocusRequestId}
                origin={origin?.location ?? null}
                route={selectedRoute}
                userLocation={currentLocation}
                vehiclePositions={transit.vehiclePositions}
                viewportInsets={{
                  top: 18,
                  right: 16,
                  bottom: Math.max(24, mapStageHeight - sheetOffsets[sheetSnap] + 18),
                  left: 16,
                }}
                style={{ width: mapStageWidth, height: mapStageHeight }}
              />
            )}
            {origin === null && destination === null ? (
              <View pointerEvents="none" style={styles.mapHint}>
                <Text style={styles.mapHintTitle}>어디로 갈까요?</Text>
                <Text style={styles.mapHintBody}>출발지·도착지 검색</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityLabel="지도에서 내 위치 보기"
              accessibilityRole="button"
              disabled={locating}
              onPress={() => void focusCurrentLocation()}
              style={[
                styles.mapLocationButton,
                { bottom: Math.max(14, mapStageHeight - sheetOffsets[sheetSnap] + 14) },
              ]}
            >
              {locating ? (
                <ActivityIndicator color={chimapTheme.teal} size="small" />
              ) : (
                <AppIcon color={chimapTheme.teal} name="location" size={21} />
              )}
            </Pressable>
            {selectedRoute === null || sheetSnap !== "collapsed" ? null : (
              <View
                pointerEvents="none"
                style={[styles.mapLegend, { bottom: 84 + insets.bottom }]}
              >
                <Text style={styles.legendWalk}>━ 도보</Text>
                <Text style={styles.legendBus}>━ 버스</Text>
                <Text style={styles.legendSubway}>━ 지하철</Text>
              </View>
            )}
          </View>

          <Animated.View
            style={[
              styles.tripSheet,
              { transform: [{ translateY: sheetPosition }] },
            ]}
          >
            <View
              {...sheetPanResponder.panHandlers}
              style={[
                styles.sheetDragArea,
                sheetSnap === "collapsed" && {
                  paddingBottom: insets.bottom,
                },
              ]}
            >
              <View style={styles.sheetHandle} />
              <Pressable
                accessibilityHint="위아래로 쓸어 펼치거나 최소화할 수 있습니다."
                accessibilityLabel={
                  sheetSnap === "collapsed"
                    ? "건강 경로 찾기 펼치기"
                    : "건강 경로 찾기 최소화"
                }
                accessibilityRole="button"
                onPress={toggleSheet}
                style={styles.sheetTab}
              >
                <View style={styles.sheetTabCopy}>
                  <Text style={styles.eyebrow}>건강 경로 찾기</Text>
                  <Text numberOfLines={1} style={styles.sheetSummary}>
                    {sheetSummary}
                  </Text>
                </View>
                <View style={styles.sheetChevron}>
                  <AppIcon
                    color={chimapTheme.teal}
                    name={sheetSnap === "collapsed" ? "chevronUp" : "chevronDown"}
                    size={22}
                  />
                </View>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={[
                styles.sheetContent,
                { paddingBottom: Math.max(24, insets.bottom + 16) },
              ]}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={sheetSnap !== "collapsed"}
              showsVerticalScrollIndicator={sheetSnap === "expanded"}
            >
            <View style={styles.searchFields}>
              <PlaceSearchField
                apiBaseUrl={apiBaseUrl}
                label="출발지"
                onClear={() => {
                  setOrigin(null);
                  invalidateResult();
                }}
                onSelect={(place) => {
                  setOrigin(place);
                  invalidateResult();
                }}
                onFocus={() => snapSheet(plannerSheetTransition(sheetSnapRef.current, { type: "SEARCH_FOCUS" }))}
                placeholder="출발 장소 검색"
                value={origin}
              />
              <View style={styles.placeActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={origin === null && destination === null}
                  onPress={() => {
                    setOrigin(destination);
                    setDestination(origin);
                    invalidateResult();
                  }}
                  style={styles.placeAction}
                >
                  <AppIcon color={chimapTheme.muted} name="swap" size={18} />
                  <Text style={styles.placeActionText}>출발·도착 바꾸기</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={locating}
                  onPress={() => void useCurrentLocation()}
                  style={styles.placeAction}
                >
                  {locating ? <ActivityIndicator color={chimapTheme.teal} size="small" /> : <AppIcon color={chimapTheme.muted} name="location" size={18} />}
                  <Text style={styles.placeActionText}>{locating ? "찾는 중…" : "현재 위치"}</Text>
                </Pressable>
              </View>
              <PlaceSearchField
                apiBaseUrl={apiBaseUrl}
                {...(origin === null ? {} : { center: origin.location })}
                label="도착지"
                onClear={() => {
                  setDestination(null);
                  invalidateResult();
                }}
                onSelect={(place) => {
                  setDestination(place);
                  invalidateResult();
                }}
                onFocus={() => snapSheet(plannerSheetTransition(sheetSnapRef.current, { type: "SEARCH_FOCUS" }))}
                placeholder="도착 장소 검색"
                value={destination}
              />
            </View>
            {message === null ? null : (
              <Text accessibilityRole="alert" style={styles.message}>
                {message}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={
                origin === null ||
                destination === null ||
                submitting ||
                query.isFetching
              }
              onPress={() => void submit()}
              style={[
                styles.primaryButton,
                (origin === null ||
                  destination === null ||
                  submitting ||
                  query.isFetching) &&
                  styles.disabled,
              ]}
            >
              {submitting || query.isFetching ? (
                <View style={styles.loadingColumn}>
                  <RouteTracer />
                  <Text style={styles.primaryButtonText}>도보와 대중교통을 비교하는 중…</Text>
                </View>
              ) : (
                <Text style={styles.primaryButtonText}>건강 경로 찾기</Text>
              )}
            </Pressable>

            {query.isError ? (
              <Text accessibilityRole="alert" style={styles.message}>
                추천 경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
              </Text>
            ) : null}
            {query.data === undefined ? null : (
              <View style={styles.results}>
                <View style={styles.resultsHeading}>
                  <Text style={styles.eyebrow}>건강 경로 추천</Text>
                  <Text style={styles.resultsTitle}>
                    {origin?.name ?? "출발지"} <Text style={styles.resultsArrow}>→</Text>{" "}
                    {destination?.name ?? "도착지"}
                  </Text>
                  <Text style={styles.muted}>
                    기본 {minutes(query.data.baseline.durationSeconds)} · 기본 도보{" "}
                    {meters(query.data.baseline.walkDistanceMeters)}
                  </Text>
                </View>
                {query.data.warnings.length === 0 ? null : (
                  <View style={styles.noticeBox}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: warningsOpen }}
                      onPress={() => setWarningsOpen((value) => !value)}
                      style={styles.noticeHeader}
                    >
                      <Text style={styles.noticeTitle}>운행 안내 {query.data.warnings.length}건</Text>
                      <AppIcon color={chimapTheme.warningText} name={warningsOpen ? "chevronUp" : "chevronDown"} size={15} />
                    </Pressable>
                    {warningsOpen ? query.data.warnings.map((warning) => (
                      <Text key={warning.code} style={styles.noticeText}>• {warning.message}</Text>
                    )) : null}
                  </View>
                )}
                {transit.unavailable ? (
                  <Text style={styles.supportingNotice}>실시간 차량 위치만 불러오지 못했습니다. 추천 경로는 계속 사용할 수 있습니다.</Text>
                ) : transit.stale && transit.vehiclePositions.length > 0 ? (
                  <Text style={styles.supportingNotice}>차량 위치 일부가 지연되어 마지막 정보를 표시합니다.</Text>
                ) : null}
                <View style={styles.routeList}>
                  {query.data.recommendations.map((route) => (
                    <RouteCard
                      key={route.id}
                      onOpenDetail={() => {
                        if (selectedRoute?.id !== route.id) void Haptics.selectionAsync();
                        selectRoute(route.id, route.type);
                        openDetail(route.id, route.type);
                      }}
                      onSelect={() => {
                        if (selectedRoute?.id !== route.id) void Haptics.selectionAsync();
                        selectRoute(route.id, route.type);
                        snapSheet(plannerSheetTransition(sheetSnapRef.current, { type: "SELECT_ROUTE" }));
                      }}
                      route={route}
                      selected={selectedRoute?.id === route.id}
                    />
                  ))}
                </View>
              </View>
            )}
            <Text style={styles.dataSources}>
              데이터 제공: NAVER 지도 · KAKAO 장소/도보 · 국토교통부 TAGO
            </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
      <RouteDetailSheet
        accessToken={accessToken}
        apiBaseUrl={apiBaseUrl}
        destination={destination}
        onClose={closeDetailSheet}
        open={detailSheet.open}
        origin={origin}
        route={selectedRoute}
        vehiclePositions={transit.vehiclePositions}
      />
      <AccountSheet
        displayName={displayName}
        healthStatus={healthStatus}
        recoveryAction={stepRecoveryAction}
        onClose={() => setAccountOpen(false)}
        onDeleteAccount={async () => {
          try {
            await onDeleteAccount();
          } catch {
            setMessage("계정을 삭제하지 못했습니다.");
          }
        }}
        onEditProfile={onEditProfile}
        onRefreshSteps={() => readSteps(true)}
        onRecoverSteps={async () => {
          if (stepRecoveryAction !== null) {
            await openStepRecovery(stepRecoveryAction);
          }
        }}
        onLogout={async () => {
          try {
            await onLogout();
          } catch {
            setMessage("로그아웃하지 못했습니다.");
          }
        }}
        open={accountOpen}
        profile={profile}
        refreshingSteps={readingSteps}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: chimapTheme.navy },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: chimapTheme.canvas },
  appHeader: { paddingHorizontal: 7, paddingVertical: 4, backgroundColor: chimapTheme.navy },
  headerCompactRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 5 },
  brandLockup: { minWidth: 104, flexDirection: "row", alignItems: "center", gap: 5 },
  brandMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: chimapTheme.orange },
  brand: { minWidth: 0, flexShrink: 1, color: chimapTheme.white, fontSize: 18, fontWeight: "900" },
  compactMetric: { minWidth: 0, minHeight: 40, flex: 1, justifyContent: "center", paddingLeft: 7, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: chimapTheme.dividerOnNavy },
  compactMetricLabel: { color: chimapTheme.textOnNavyMuted, fontSize: 8, fontWeight: "800" },
  compactMetricValue: { color: chimapTheme.white, fontSize: 13, fontWeight: "900" },
  accountButton: { width: 56, minHeight: 44, alignItems: "center", justifyContent: "center", gap: 1, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  accountButtonText: { color: chimapTheme.white, fontSize: 8, fontWeight: "800" },
  mapStage: { flex: 1, overflow: "hidden", backgroundColor: chimapTheme.mapCanvas },
  mapShell: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", backgroundColor: chimapTheme.mapCanvas },
  mapHint: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: chimapTheme.mapOverlay },
  mapHintTitle: { color: chimapTheme.navyStrong, fontSize: 11, fontWeight: "900" },
  mapHintBody: { color: chimapTheme.muted, fontSize: 8, fontWeight: "700" },
  mapLocationButton: { position: "absolute", right: 12, width: 46, height: 46, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: chimapTheme.line, borderRadius: 23, backgroundColor: chimapTheme.mapOverlay, shadowColor: chimapTheme.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 4 },
  mapLegend: { position: "absolute", right: 12, flexDirection: "row", gap: 9, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: chimapTheme.mapOverlay },
  legendWalk: { color: chimapTheme.orange, fontSize: 9, fontWeight: "900" },
  legendBus: { color: chimapTheme.busBlue, fontSize: 9, fontWeight: "900" },
  legendSubway: { color: chimapTheme.purple, fontSize: 9, fontWeight: "900" },
  tripSheet: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", borderTopLeftRadius: 27, borderTopRightRadius: 27, borderWidth: 1, borderBottomWidth: 0, borderColor: chimapTheme.sheetBorder, backgroundColor: chimapTheme.paper, shadowColor: chimapTheme.shadow, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 12 },
  sheetDragArea: { minHeight: 72, paddingHorizontal: 16, paddingTop: 8, backgroundColor: chimapTheme.paper },
  sheetHandle: { width: 42, height: 5, alignSelf: "center", borderRadius: 999, backgroundColor: chimapTheme.handle },
  sheetTab: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTabCopy: { minWidth: 0, flex: 1, gap: 3 },
  sheetSummary: { color: chimapTheme.muted, fontSize: 11, fontWeight: "700" },
  sheetChevron: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  sheetContent: { gap: 14, paddingHorizontal: 16, paddingTop: 8 },
  eyebrow: { color: chimapTheme.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  searchFields: { gap: 10 },
  placeActions: { flexDirection: "row", gap: 8 },
  placeAction: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: chimapTheme.line, borderRadius: 11, backgroundColor: chimapTheme.white },
  placeActionText: { color: chimapTheme.muted, fontSize: 11, fontWeight: "800" },
  message: { padding: 11, borderRadius: 10, color: chimapTheme.danger, backgroundColor: chimapTheme.dangerSurface, fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: chimapTheme.navy },
  disabled: { opacity: 0.45 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  loadingColumn: { alignItems: "center", gap: 5 },
  routeTracer: { width: 94, height: 5, flexDirection: "row", overflow: "hidden", borderRadius: 999 },
  routeTracerSegment: { flex: 1 },
  primaryButtonText: { color: chimapTheme.white, fontSize: 15, fontWeight: "900" },
  results: { gap: 13, paddingTop: 7, borderTopWidth: 1, borderTopColor: chimapTheme.line },
  resultsHeading: { gap: 5 },
  resultsTitle: { color: chimapTheme.ink, fontSize: 21, fontWeight: "900", lineHeight: 28 },
  resultsArrow: { color: chimapTheme.orange },
  sectionTitle: { color: chimapTheme.ink, fontSize: 18, fontWeight: "900" },
  muted: { color: chimapTheme.muted, fontSize: 12, lineHeight: 18 },
  noticeBox: { gap: 5, padding: 11, borderRadius: 12, backgroundColor: chimapTheme.warningSurface },
  noticeHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noticeTitle: { color: chimapTheme.warningText, fontSize: 12, fontWeight: "900" },
  noticeText: { color: chimapTheme.warningText, fontSize: 11, lineHeight: 16 },
  supportingNotice: { padding: 10, borderRadius: 10, color: chimapTheme.muted, backgroundColor: chimapTheme.surfaceSubtle, fontSize: 11, lineHeight: 17 },
  routeList: { gap: 9 },
  routeCard: { overflow: "hidden", borderWidth: 1, borderColor: chimapTheme.line, borderRadius: 16, backgroundColor: chimapTheme.white },
  routeCardSelected: { borderWidth: 2, borderColor: chimapTheme.teal, backgroundColor: chimapTheme.selectedSurface },
  goalLine: { height: 3, backgroundColor: chimapTheme.orange },
  routeSummary: { gap: 8, padding: 13 },
  routeTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  routeType: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  routeTypeText: { color: chimapTheme.white, fontSize: 10, fontWeight: "900" },
  realtimeBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: chimapTheme.realtimeText, backgroundColor: chimapTheme.realtimeSurface, fontSize: 10, fontWeight: "900" },
  estimateBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: chimapTheme.estimatedText, backgroundColor: chimapTheme.estimatedSurface, fontSize: 10, fontWeight: "900" },
  routeTimeRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  routeTime: { color: chimapTheme.navyStrong, fontSize: 25, fontWeight: "900", letterSpacing: -1 },
  routeArrival: { color: chimapTheme.teal, fontSize: 12, fontWeight: "900" },
  routeExtra: { color: chimapTheme.muted, fontSize: 10, fontWeight: "700" },
  modeStrip: { height: 8, flexDirection: "row", overflow: "hidden", borderRadius: 999, backgroundColor: chimapTheme.track },
  modeStripSegment: { minWidth: 0, flexBasis: 0 },
  routeSequence: { color: chimapTheme.navy, fontSize: 12, fontWeight: "900", lineHeight: 18 },
  modeDistanceLegend: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  modeDistanceItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  modeDistanceDot: { width: 7, height: 7, borderRadius: 4 },
  modeDistanceText: { color: chimapTheme.muted, fontSize: 10, fontWeight: "800" },
  routeMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 11 },
  routeMetric: { color: chimapTheme.muted, fontSize: 10, fontWeight: "700" },
  routeMetricStrong: { color: chimapTheme.teal, fontSize: 10, fontWeight: "900" },
  routeActions: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 13, paddingRight: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: chimapTheme.track, backgroundColor: chimapTheme.surface },
  routeReason: { minWidth: 0, flex: 1, color: chimapTheme.muted, fontSize: 10 },
  detailButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8 },
  detailButtonText: { color: chimapTheme.teal, fontSize: 11, fontWeight: "900" },
  dataSources: { marginTop: 4, color: chimapTheme.placeholder, fontSize: 9, lineHeight: 14, textAlign: "center" },
  detailSafeArea: { flex: 1, backgroundColor: chimapTheme.canvas },
  detailContent: { gap: 17, padding: 18, paddingBottom: 34 },
  accountContent: { gap: 14, padding: 18, paddingBottom: 34 },
  accountCard: { gap: 1, overflow: "hidden", borderWidth: 1, borderColor: chimapTheme.line, borderRadius: 16, backgroundColor: chimapTheme.white },
  accountFactRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: chimapTheme.line },
  accountFactLabel: { color: chimapTheme.muted, fontSize: 12, fontWeight: "800" },
  accountFactValue: { color: chimapTheme.navy, fontSize: 13, fontWeight: "900" },
  accountRefreshAction: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: chimapTheme.line, borderRadius: 13, backgroundColor: chimapTheme.white },
  accountRefreshText: { color: chimapTheme.teal, fontSize: 13, fontWeight: "900" },
  accountPrimaryAction: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: chimapTheme.navy },
  accountPrimaryText: { color: chimapTheme.white, fontSize: 15, fontWeight: "900" },
  accountDangerZone: { gap: 1, overflow: "hidden", marginTop: 10, borderRadius: 14, backgroundColor: chimapTheme.white },
  accountAction: { minHeight: 52, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: chimapTheme.line },
  accountActionText: { color: chimapTheme.navy, fontSize: 14, fontWeight: "800" },
  accountDeleteText: { color: chimapTheme.danger, fontSize: 14, fontWeight: "900" },
  detailHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  detailHeadingCopy: { minWidth: 0, flex: 1, gap: 5 },
  detailTitle: { color: chimapTheme.ink, fontSize: 25, fontWeight: "900" },
  closeButton: { minWidth: 54, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: chimapTheme.white },
  closeButtonText: { color: chimapTheme.teal, fontWeight: "900" },
  detailMap: { width: "100%", height: 300, overflow: "hidden", borderRadius: 20 },
  detailFacts: { flexDirection: "row", paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: chimapTheme.line },
  detailFact: { minWidth: 0, flex: 1, gap: 4, paddingHorizontal: 8, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: chimapTheme.line },
  detailFactLabel: { color: chimapTheme.muted, fontSize: 9, fontWeight: "700" },
  detailFactValue: { color: chimapTheme.navy, fontSize: 13, fontWeight: "900" },
  geometryNotice: { padding: 11, borderRadius: 11, color: chimapTheme.muted, backgroundColor: chimapTheme.surfaceSubtle, fontSize: 12, lineHeight: 18 },
  legList: { gap: 9 },
  legRow: { minHeight: 70, flexDirection: "row", gap: 12, padding: 13, borderRadius: 15, backgroundColor: chimapTheme.white },
  legIndex: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  legIndexText: { color: chimapTheme.white, fontWeight: "900" },
  legCopy: { minWidth: 0, flex: 1, gap: 5 },
  legTitle: { color: chimapTheme.ink, fontSize: 14, fontWeight: "900" },
  legMeta: { color: chimapTheme.muted, fontSize: 11, lineHeight: 17 },
  exerciseBadge: { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: chimapTheme.estimatedText, backgroundColor: chimapTheme.estimatedSurface, fontSize: 9, fontWeight: "900" },
  lowFloorBadge: { alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: chimapTheme.realtimeText, backgroundColor: chimapTheme.realtimeSurface, fontSize: 9, fontWeight: "900" },
  realtimeText: { color: chimapTheme.realtimeText, fontSize: 10, fontWeight: "900" },
  estimatedText: { color: chimapTheme.estimatedText, fontSize: 10, fontWeight: "900" },
  estimationBox: { gap: 6, padding: 13, borderRadius: 14, backgroundColor: chimapTheme.surfaceSubtle },
  nearbySection: { gap: 9 },
  nearbyCard: { gap: 4, padding: 13, borderRadius: 14, backgroundColor: chimapTheme.white },
  nearbyLabel: { color: chimapTheme.teal, fontSize: 10, fontWeight: "900" },
  nearbyStation: { color: chimapTheme.navy, fontSize: 14, fontWeight: "900" },
});
