import { isSameKoreanCalendarDay } from "@chimap/app-core";
import {
  estimatePersonalizedStepLengthMeters,
  recommendationRequestSchema,
  type Place,
  type Recommendation,
  type RecommendationRequest,
  type RecommendationType,
  type RouteLeg,
  type RouteMode,
} from "@chimap/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  AppState,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { requestCurrentLocation } from "../../platform/location/current-location";
import { NativeRouteMap } from "../../platform/maps/native-route-map";
import { stepsSource } from "../../platform/steps/steps-source";
import { chimapTheme } from "../../theme/chimap-theme";
import { reverseGeocode } from "../places/place-api";
import { PlaceSearchField } from "../places/place-search-field";
import type { SavedWalkingProfile } from "../profile/walking-profile-storage";
import {
  hashRecommendationRequest,
  useRecommendationQuery,
} from "./recommendation-query";
import {
  clampPlannerSheetPosition,
  nearestPlannerSheetSnap,
  plannerSheetOffsets,
  type PlannerSheetSnap,
} from "./planner-sheet-snap";
import { routeModeDistances } from "./route-mode-distance";
import { useRouteStore } from "./route-store-context";

const plannerNumberAccessoryId = "chimap-planner-number-input";

function integer(value: string): number {
  return Number.parseInt(value.trim(), 10);
}

function minutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}분`;
}

function meters(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}km` : `${value}m`;
}

function recommendationType(type: RecommendationType): string {
  if (type === "FAST") {
    return "빠른 길";
  }
  if (type === "GOAL") {
    return "목표 맞춤";
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
  const modeDistances = routeModeDistances(route.legs);
  const distanceSummary = modeDistances
    .map(
      (item) =>
        `${modeName(item.mode)} ${meters(item.distanceMeters)}, ${item.percent}%`,
    )
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
          <Text style={styles.routeExtra}>
            {route.extraMinutes > 0 ? `기본보다 +${route.extraMinutes}분` : "가장 빠른 기준"}
          </Text>
        </View>
        <View
          accessibilityLabel={`이동 거리 비율: ${distanceSummary}`}
          accessible
          style={styles.modeStrip}
        >
          {modeDistances.map((item) => (
            <View
              key={item.mode}
              style={[
                styles.modeStripSegment,
                {
                  flexGrow: item.distanceMeters,
                  backgroundColor: modeColor(item.mode),
                },
              ]}
            />
          ))}
        </View>
        <View style={styles.modeDistanceLegend}>
          {modeDistances.map((item) => (
            <View key={item.mode} style={styles.modeDistanceItem}>
              <View
                style={[
                  styles.modeDistanceDot,
                  { backgroundColor: modeColor(item.mode) },
                ]}
              />
              <Text style={styles.modeDistanceText}>
                {modeName(item.mode)} {meters(item.distanceMeters)} · {item.percent}%
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.routeMetrics}>
          <Text style={styles.routeMetric}>
            예상 {route.estimatedSteps.toLocaleString()}걸음
          </Text>
          <Text style={styles.routeMetric}>환승 {route.transferCount}회</Text>
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
          <Text style={styles.detailButtonText}>자세히 ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RouteDetailSheet({
  route,
  open,
  origin,
  destination,
  onClose,
}: {
  route: Recommendation | null;
  open: boolean;
  origin: Place | null;
  destination: Place | null;
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
              style={styles.detailMap}
            />
            <View style={styles.detailFacts}>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>소요 시간</Text>
                <Text style={styles.detailFactValue}>{minutes(route.durationSeconds)}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>걷는 거리</Text>
                <Text style={styles.detailFactValue}>{meters(route.walkDistanceMeters)}</Text>
              </View>
              <View style={styles.detailFact}>
                <Text style={styles.detailFactLabel}>예상 걸음</Text>
                <Text style={styles.detailFactValue}>{route.estimatedSteps.toLocaleString()}</Text>
              </View>
            </View>
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
                  </View>
                </View>
              ))}
            </View>
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
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compactHeader = width < 390 || fontScale >= 1.3;
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
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mapStageWidth, setMapStageWidth] = useState(0);
  const [mapStageHeight, setMapStageHeight] = useState(0);
  const [sheetSnap, setSheetSnap] = useState<PlannerSheetSnap>("collapsed");
  const sheetPosition = useRef(new Animated.Value(1_000)).current;
  const sheetCurrentPosition = useRef(1_000);
  const sheetDragStart = useRef(1_000);
  const sheetSnapRef = useRef<PlannerSheetSnap>("collapsed");
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
      if (!animated) {
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
    [sheetPosition],
  );

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
      if (
        state === "active" &&
        !isSameKoreanCalendarDay(currentDay.current, Date.now())
      ) {
        currentDay.current = Date.now();
        setCurrentSteps("0");
        setActiveRequest(null);
        setActiveHash(null);
        setActiveRequestSavedAt(null);
        setMessage("날짜가 바뀌어 오늘 걸음을 다시 확인합니다.");
        automaticStepRead.current = false;
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!hydrated || automaticStepRead.current) {
      return;
    }
    automaticStepRead.current = true;
    setReadingSteps(true);
    void stepsSource
      .readTodaySteps()
      .then((steps) => setCurrentSteps(String(steps)))
      .catch(() => {
        setMessage("건강 앱의 걸음을 읽지 못했어요. 현재 걸음을 직접 입력할 수 있습니다.");
      })
      .finally(() => setReadingSteps(false));
  }, [hydrated]);

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

  const invalidateResult = () => {
    setActiveRequest(null);
    setActiveHash(null);
    setActiveRequestSavedAt(null);
    setMessage(null);
  };

  const readSteps = async () => {
    setReadingSteps(true);
    setMessage(null);
    try {
      setCurrentSteps(String(await stepsSource.readTodaySteps()));
      invalidateResult();
    } catch {
      setMessage("건강 앱의 걸음을 읽지 못했어요. 직접 입력해 계속할 수 있습니다.");
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
      setMessage("현재 걸음을 0~100,000 사이의 정수로 입력해 주세요.");
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
      snapSheet("expanded");
    } finally {
      setSubmitting(false);
    }
  };

  const accountActions = () => {
    Alert.alert(displayName, "카카오 계정으로 로그인 중", [
      { text: "보폭·목표 수정", onPress: onEditProfile },
      {
        text: "로그아웃",
        onPress: () => {
          void onLogout().catch(() => setMessage("로그아웃하지 못했습니다."));
        },
      },
      {
        text: "계정 삭제",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            "계정을 삭제할까요?",
            "서버 계정과 로그인 세션, 이 기기의 저장된 경로와 개인화 정보가 삭제됩니다.",
            [
              { text: "취소", style: "cancel" },
              {
                text: "계정 삭제",
                style: "destructive",
                onPress: () => {
                  void onDeleteAccount().catch(() =>
                    setMessage("계정을 삭제하지 못했습니다."),
                  );
                },
              },
            ],
          );
        },
      },
      { text: "닫기", style: "cancel" },
    ]);
  };

  const sheetSummary =
    origin === null || destination === null
      ? "출발지와 도착지를 선택하세요"
      : `${origin.name} → ${destination.name}`;
  const parsedCurrentSteps = integer(currentSteps || "0");
  const currentStepsLabel = Number.isFinite(parsedCurrentSteps)
    ? parsedCurrentSteps.toLocaleString()
    : "입력 중";

  const toggleSheet = () => {
    snapSheet(sheetSnap === "collapsed" ? "middle" : "collapsed");
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
      <View style={[styles.appHeader, compactHeader && styles.appHeaderCompact]}>
        <View style={styles.brandLockup}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>↗</Text>
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            numberOfLines={1}
            style={styles.brand}
          >
            CHIMap
          </Text>
        </View>
        <View
          accessibilityLabel={`현재 걸음 ${currentStepsLabel}걸음`}
          style={styles.compactStepMetric}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            numberOfLines={1}
            style={styles.compactMetricLabel}
          >
            현재 걸음
          </Text>
          <TextInput
            accessibilityLabel="현재 걸음"
            {...(Platform.OS === "ios"
              ? { inputAccessoryViewID: plannerNumberAccessoryId }
              : {})}
            keyboardType="number-pad"
            onChangeText={(value) => {
              setCurrentSteps(value);
              invalidateResult();
            }}
            selectTextOnFocus
            style={styles.compactStepInput}
            value={currentSteps}
          />
          <Pressable
            accessibilityLabel="건강 앱에서 현재 걸음 새로고침"
            accessibilityRole="button"
            disabled={readingSteps}
            hitSlop={8}
            onPress={() => void readSteps()}
            style={styles.compactRefreshButton}
          >
            <Text style={styles.compactRefreshText}>{readingSteps ? "…" : "↻"}</Text>
          </Pressable>
        </View>
        <View
          accessibilityLabel={`목표 걸음 ${profile.dailyGoalSteps.toLocaleString()}걸음`}
          style={styles.compactGoalMetric}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            numberOfLines={1}
            style={styles.compactMetricLabel}
          >
            목표 걸음
          </Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={styles.compactMetricValue}
          >
            {profile.dailyGoalSteps.toLocaleString()}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="내 정보와 계정 메뉴"
          accessibilityRole="button"
          onPress={accountActions}
          style={styles.accountButton}
        >
          <Text numberOfLines={1} style={styles.accountButtonText}>
            내 정보
          </Text>
        </Pressable>
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
                origin={origin?.location ?? null}
                route={selectedRoute}
                style={{ width: mapStageWidth, height: mapStageHeight }}
              />
            )}
            {origin === null && destination === null ? (
              <View pointerEvents="none" style={styles.mapHint}>
                <Text style={styles.mapHintTitle}>어디로 갈까요?</Text>
                <Text style={styles.mapHintBody}>장소를 선택하면 지도에 경로가 표시됩니다.</Text>
              </View>
            ) : null}
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
                <Text style={styles.sheetChevron}>
                  {sheetSnap === "collapsed" ? "⌃" : "⌄"}
                </Text>
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
                onFocus={() => snapSheet("expanded")}
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
                  <Text style={styles.placeActionText}>↕ 출발·도착 바꾸기</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={locating}
                  onPress={() => void useCurrentLocation()}
                  style={styles.placeAction}
                >
                  <Text style={styles.placeActionText}>
                    {locating ? "찾는 중…" : "⌖ 현재 위치"}
                  </Text>
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
                onFocus={() => snapSheet("expanded")}
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
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={chimapTheme.white} size="small" />
                  <Text style={styles.primaryButtonText}>건강 경로 계산 중…</Text>
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
                    <Text style={styles.noticeTitle}>
                      운행 안내 {query.data.warnings.length}건
                    </Text>
                    {query.data.warnings.map((warning) => (
                      <Text key={warning.code} style={styles.noticeText}>
                        • {warning.message}
                      </Text>
                    ))}
                  </View>
                )}
                <View style={styles.routeList}>
                  {query.data.recommendations.map((route) => (
                    <RouteCard
                      key={route.id}
                      onOpenDetail={() => openDetail(route.id, route.type)}
                      onSelect={() => selectRoute(route.id, route.type)}
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
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={plannerNumberAccessoryId}>
          <View style={styles.inputAccessory}>
            <Pressable accessibilityRole="button" onPress={Keyboard.dismiss}>
              <Text style={styles.inputAccessoryDone}>완료</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      <RouteDetailSheet
        destination={destination}
        onClose={closeDetailSheet}
        open={detailSheet.open}
        origin={origin}
        route={selectedRoute}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: chimapTheme.navy },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: chimapTheme.canvas },
  appHeader: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: chimapTheme.navy },
  appHeaderCompact: { gap: 4, paddingHorizontal: 8 },
  brandLockup: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  brandMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: chimapTheme.orange },
  brandMarkText: { color: chimapTheme.navyStrong, fontSize: 20, fontWeight: "900" },
  brand: { maxWidth: 62, color: chimapTheme.white, fontSize: 17, fontWeight: "900" },
  compactStepMetric: { minWidth: 0, minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, paddingLeft: 6, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: "rgba(255,255,255,0.16)" },
  compactGoalMetric: { minWidth: 62, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 5, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: "rgba(255,255,255,0.16)" },
  compactMetricLabel: { flexShrink: 1, color: "rgba(255,255,255,0.58)", fontSize: 9, fontWeight: "800" },
  compactMetricValue: { flexShrink: 1, color: chimapTheme.white, fontSize: 11, fontWeight: "900" },
  compactStepInput: { width: 42, minWidth: 0, padding: 0, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.3)", color: chimapTheme.white, fontSize: 11, fontWeight: "900", textAlign: "right" },
  compactRefreshButton: { width: 26, minHeight: 44, alignItems: "center", justifyContent: "center" },
  compactRefreshText: { color: "#FFC49D", fontSize: 17, fontWeight: "900" },
  accountButton: { minWidth: 52, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 7, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.1)" },
  accountButtonText: { color: chimapTheme.white, fontSize: 10, fontWeight: "800" },
  mapStage: { flex: 1, overflow: "hidden", backgroundColor: "#E9ECE6" },
  mapShell: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", backgroundColor: "#E9ECE6" },
  mapHint: { position: "absolute", top: 20, left: 20, right: 20, alignItems: "center", gap: 4, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,254,249,0.92)" },
  mapHintTitle: { color: chimapTheme.navyStrong, fontSize: 15, fontWeight: "900" },
  mapHintBody: { color: chimapTheme.muted, fontSize: 11 },
  mapLegend: { position: "absolute", right: 12, flexDirection: "row", gap: 9, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: "rgba(255,254,249,0.92)" },
  legendWalk: { color: chimapTheme.orange, fontSize: 9, fontWeight: "900" },
  legendBus: { color: chimapTheme.busBlue, fontSize: 9, fontWeight: "900" },
  legendSubway: { color: chimapTheme.purple, fontSize: 9, fontWeight: "900" },
  tripSheet: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", borderTopLeftRadius: 27, borderTopRightRadius: 27, borderWidth: 1, borderBottomWidth: 0, borderColor: "rgba(23,49,55,0.1)", backgroundColor: chimapTheme.paper, shadowColor: "#071D22", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 12 },
  sheetDragArea: { minHeight: 72, paddingHorizontal: 16, paddingTop: 8, backgroundColor: chimapTheme.paper },
  sheetHandle: { width: 42, height: 5, alignSelf: "center", borderRadius: 999, backgroundColor: "#D5DAD7" },
  sheetTab: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTabCopy: { minWidth: 0, flex: 1, gap: 3 },
  sheetSummary: { color: chimapTheme.muted, fontSize: 11, fontWeight: "700" },
  sheetChevron: { width: 36, color: chimapTheme.teal, fontSize: 24, fontWeight: "900", textAlign: "center" },
  sheetContent: { gap: 14, paddingHorizontal: 16, paddingTop: 8 },
  eyebrow: { color: chimapTheme.teal, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  searchFields: { gap: 10 },
  placeActions: { flexDirection: "row", gap: 8 },
  placeAction: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderWidth: 1, borderColor: chimapTheme.line, borderRadius: 11, backgroundColor: chimapTheme.white },
  placeActionText: { color: chimapTheme.muted, fontSize: 11, fontWeight: "800" },
  message: { padding: 11, borderRadius: 10, color: chimapTheme.danger, backgroundColor: "#FFF0ED", fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: chimapTheme.navy },
  disabled: { opacity: 0.45 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  primaryButtonText: { color: chimapTheme.white, fontSize: 15, fontWeight: "900" },
  results: { gap: 13, paddingTop: 7, borderTopWidth: 1, borderTopColor: chimapTheme.line },
  resultsHeading: { gap: 5 },
  resultsTitle: { color: chimapTheme.ink, fontSize: 21, fontWeight: "900", lineHeight: 28 },
  resultsArrow: { color: chimapTheme.orange },
  sectionTitle: { color: chimapTheme.ink, fontSize: 18, fontWeight: "900" },
  muted: { color: chimapTheme.muted, fontSize: 12, lineHeight: 18 },
  noticeBox: { gap: 5, padding: 11, borderRadius: 12, backgroundColor: "#FFF4E9" },
  noticeTitle: { color: "#825016", fontSize: 12, fontWeight: "900" },
  noticeText: { color: "#825016", fontSize: 11, lineHeight: 16 },
  routeList: { gap: 9 },
  routeCard: { overflow: "hidden", borderWidth: 1, borderColor: "#DCE2DE", borderRadius: 16, backgroundColor: chimapTheme.white },
  routeCardSelected: { borderWidth: 2, borderColor: chimapTheme.teal, backgroundColor: "#F4FAF7" },
  goalLine: { height: 3, backgroundColor: chimapTheme.orange },
  routeSummary: { gap: 8, padding: 13 },
  routeTopline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  routeType: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  routeTypeText: { color: chimapTheme.white, fontSize: 10, fontWeight: "900" },
  realtimeBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: "#096343", backgroundColor: "#DFF5EA", fontSize: 10, fontWeight: "900" },
  estimateBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999, color: "#825016", backgroundColor: "#FFF0D4", fontSize: 10, fontWeight: "900" },
  routeTimeRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  routeTime: { color: chimapTheme.navyStrong, fontSize: 25, fontWeight: "900", letterSpacing: -1 },
  routeExtra: { color: chimapTheme.muted, fontSize: 10, fontWeight: "700" },
  modeStrip: { height: 8, flexDirection: "row", overflow: "hidden", borderRadius: 999, backgroundColor: "#EDF0ED" },
  modeStripSegment: { minWidth: 0, flexBasis: 0 },
  modeDistanceLegend: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  modeDistanceItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  modeDistanceDot: { width: 7, height: 7, borderRadius: 4 },
  modeDistanceText: { color: "#405355", fontSize: 10, fontWeight: "800" },
  routeMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 11 },
  routeMetric: { color: "#768482", fontSize: 10, fontWeight: "700" },
  routeActions: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 13, paddingRight: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#EDF0ED", backgroundColor: "#FAFBFA" },
  routeReason: { minWidth: 0, flex: 1, color: chimapTheme.muted, fontSize: 10 },
  detailButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  detailButtonText: { color: chimapTheme.teal, fontSize: 11, fontWeight: "900" },
  dataSources: { marginTop: 4, color: "#8A9694", fontSize: 9, lineHeight: 14, textAlign: "center" },
  detailSafeArea: { flex: 1, backgroundColor: chimapTheme.canvas },
  detailContent: { gap: 17, padding: 18, paddingBottom: 34 },
  detailHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  detailHeadingCopy: { minWidth: 0, flex: 1, gap: 5 },
  detailTitle: { color: chimapTheme.ink, fontSize: 25, fontWeight: "900" },
  closeButton: { minWidth: 54, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: chimapTheme.white },
  closeButtonText: { color: chimapTheme.teal, fontWeight: "900" },
  detailMap: { width: "100%", height: 300, overflow: "hidden", borderRadius: 20 },
  detailFacts: { flexDirection: "row", paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1, borderColor: chimapTheme.line },
  detailFact: { minWidth: 0, flex: 1, gap: 4, paddingHorizontal: 8, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: chimapTheme.line },
  detailFactLabel: { color: "#87928F", fontSize: 9, fontWeight: "700" },
  detailFactValue: { color: chimapTheme.navy, fontSize: 13, fontWeight: "900" },
  legList: { gap: 9 },
  legRow: { minHeight: 70, flexDirection: "row", gap: 12, padding: 13, borderRadius: 15, backgroundColor: chimapTheme.white },
  legIndex: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  legIndexText: { color: chimapTheme.white, fontWeight: "900" },
  legCopy: { minWidth: 0, flex: 1, gap: 5 },
  legTitle: { color: chimapTheme.ink, fontSize: 14, fontWeight: "900" },
  inputAccessory: { minHeight: 44, alignItems: "flex-end", justifyContent: "center", paddingHorizontal: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: chimapTheme.line, backgroundColor: "#F1F2F3" },
  inputAccessoryDone: { color: chimapTheme.teal, fontSize: 16, fontWeight: "800" },
});
