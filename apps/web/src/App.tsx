import {
  estimatePersonalizedStepLengthMeters,
  automaticRecommendationRequestSchema,
  type Coordinate,
  type Place,
  type PlannerUiState,
  type Recommendation,
  type RecommendationRequest,
  type UiEventPayload,
} from "@chimap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ChevronDown,
  Crosshair,
  Info,
  MapPin,
  Navigation,
  Settings2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ExperienceSettingsDialog } from "./components/ExperienceSettingsDialog.js";
import { AuthControl } from "./components/AuthControl.js";
import { HeaderStepSummary } from "./components/HeaderStepSummary.js";
import {
  IntroSequence,
  shouldPlayIntro,
} from "./components/IntroSequence.js";
import { MapView } from "./components/MapView.js";
import { PlaceCombobox } from "./components/PlaceCombobox.js";
import { RecommendationCard } from "./components/RecommendationCard.js";
import { RecommendationProgress } from "./components/RecommendationProgress.js";
import { RouteDetails } from "./components/RouteDetails.js";
import { WalkingProfileDialog } from "./components/WalkingProfileDialog.js";
import {
  UiExperienceProvider,
  useUiExperience,
} from "./components/UiExperienceProvider.js";
import {
  ApiClientError,
  createRecommendations,
  getBusVehicles,
  reverseGeocode,
  sendUiEvent,
} from "./lib/api.js";
import {
  clearPreferences,
  savePreferences,
} from "./lib/storage.js";
import {
  formatDistance,
  formatDuration,
  kstDateKey,
  millisecondsUntilNextKstDay,
} from "./lib/time.js";
import { selectRelevantVehiclePositions } from "./lib/vehicle-positions.js";
import { useTripStore } from "./store/trip-store.js";

const naverMapNcpKeyId =
  import.meta.env.VITE_NAVER_MAP_NCP_KEY_ID?.trim() || undefined;

function durationBucket(
  startMilliseconds: number | undefined,
): UiEventPayload["durationBucket"] {
  if (startMilliseconds === undefined) {
    return undefined;
  }
  const duration = performance.now() - startMilliseconds;
  if (duration < 1000) {
    return "lt1s";
  }
  if (duration < 3000) {
    return "1to3s";
  }
  if (duration < 8000) {
    return "3to8s";
  }
  return "gt8s";
}

function readableError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.requestId === undefined
      ? error.message
      : `${error.message} (요청 ID ${error.requestId.slice(0, 8)})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "경로를 계산하지 못했어요. 다시 시도해 주세요.";
}

function ResultsNotice({
  warning,
}: {
  warning: { code: string; message: string };
}) {
  const caution =
    warning.code === "GOAL_UNREACHABLE_WITHIN_CONSTRAINTS" ||
    warning.code === "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET" ||
    warning.code === "PARTIAL_CANDIDATE_FAILURE" ||
    warning.code === "LIMITED_ROUTE_VARIETY";
  return (
    <li className={caution ? "warning-caution" : ""}>
      {caution ? (
        <TriangleAlert aria-hidden="true" size={17} />
      ) : (
        <Info aria-hidden="true" size={17} />
      )}
      {warning.message}
    </li>
  );
}

type AppProps = {
  reverseAddress?: typeof reverseGeocode;
  authEnabled?: boolean;
};

export function App({
  reverseAddress = reverseGeocode,
  authEnabled = true,
}: AppProps = {}) {
  return (
    <UiExperienceProvider>
      <PlannerApp
        reverseAddress={reverseAddress}
        authEnabled={authEnabled}
      />
    </UiExperienceProvider>
  );
}

function PlannerApp({ reverseAddress, authEnabled }: Required<AppProps>) {
  const {
    state: experienceState,
    mode: experienceMode,
    reducedMotion,
    compactTransitionVisible,
    setTelemetryConsent,
    registerRecommendationSuccess,
    dismissCompactTransition,
    restoreGuidedMode,
  } = useUiExperience();
  const [introActive, setIntroActive] = useState(
    () => !reducedMotion && shouldPlayIntro(),
  );
  const [appEntered, setAppEntered] = useState(
    () => reducedMotion || !shouldPlayIntro(),
  );
  const {
    origin,
    destination,
    currentSteps,
    goalSteps,
    walkingProfile,
    selectedRouteId,
    setOrigin,
    setDestination,
    swapPlaces,
    setCurrentSteps,
    setGoalSteps,
    setWalkingProfile,
    setSelectedRouteId,
  } = useTripStore();
  const [profileEditorOpen, setProfileEditorOpen] = useState(
    walkingProfile === undefined,
  );
  const [profileEditorVersion, setProfileEditorVersion] = useState(0);
  const [currentLocation, setCurrentLocation] = useState<
    Coordinate | undefined
  >();
  const [locationMessage, setLocationMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [expandedRouteId, setExpandedRouteId] = useState<string>();
  const [activePlaceEditor, setActivePlaceEditor] = useState<
    "origin" | "destination" | undefined
  >();
  const [previewRouteId, setPreviewRouteId] = useState<string>();
  const [routeInteracted, setRouteInteracted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestAbortController = useRef<AbortController | undefined>(
    undefined,
  );
  const recommendationStartedAt = useRef<number | undefined>(undefined);
  const plannerViewedTracked = useRef(false);
  const currentStepsDateRef = useRef(kstDateKey());
  const revealApp = useCallback(() => setAppEntered(true), []);
  const completeIntro = useCallback(() => setIntroActive(false), []);
  const emitUiEvent = useCallback(
    (
      event: UiEventPayload["event"],
      uiState: PlannerUiState,
      extra: Pick<UiEventPayload, "outcome" | "durationBucket"> = {},
      mode = experienceMode,
    ): void => {
      if (experienceState.telemetryConsent !== "granted") {
        return;
      }
      void sendUiEvent({
        version: "route-pulse-v1",
        event,
        uiState,
        experienceMode: mode,
        ...(extra.outcome === undefined ? {} : { outcome: extra.outcome }),
        ...(extra.durationBucket === undefined
          ? {}
          : { durationBucket: extra.durationBucket }),
      }).catch(() => {
        // 사용성 지표 전송 실패는 경로 탐색 흐름을 방해하지 않는다.
      });
    },
    [experienceMode, experienceState.telemetryConsent],
  );

  const recommendationMutation = useMutation({
    mutationFn: (request: RecommendationRequest) => {
      requestAbortController.current?.abort();
      const controller = new AbortController();
      requestAbortController.current = controller;
      return createRecommendations(request, controller.signal);
    },
    onSuccess: (response) => {
      setSelectedRouteId(response.primaryRecommendationId);
      setExpandedRouteId(undefined);
      setRouteInteracted(false);
      setFormError(undefined);
      registerRecommendationSuccess();
      emitUiEvent("recommendation_succeeded", "results", {
        outcome: "success",
        durationBucket: durationBucket(recommendationStartedAt.current),
      });
    },
    onError: (error) => {
      setFormError(readableError(error));
      emitUiEvent("recommendation_failed", "error", {
        outcome: "error",
        durationBucket: durationBucket(recommendationStartedAt.current),
      });
    },
  });
  const recommendationResetRef = useRef(recommendationMutation.reset);
  recommendationResetRef.current = recommendationMutation.reset;

  useEffect(
    () => () => {
      requestAbortController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (reducedMotion && introActive) {
      setAppEntered(true);
      setIntroActive(false);
    }
  }, [introActive, reducedMotion]);

  useEffect(() => {
    if (
      experienceState.telemetryConsent === "granted" &&
      !plannerViewedTracked.current
    ) {
      plannerViewedTracked.current = true;
      emitUiEvent("planner_viewed", "idle");
    }
  }, [emitUiEvent, experienceState.telemetryConsent]);

  useEffect(() => {
    if (expandedRouteId === undefined) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`route-details-${expandedRouteId}`)
        ?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedRouteId, reducedMotion]);

  useEffect(() => {
    if (walkingProfile === undefined) {
      return;
    }
    const timeout = window.setTimeout(() => {
      savePreferences({
        version: 3,
        dailyGoalSteps: goalSteps,
        walkingProfile,
        currentSteps,
        currentStepsDate: kstDateKey(),
        ...(origin === undefined ? {} : { lastOrigin: origin }),
        ...(destination === undefined
          ? {}
          : { lastDestination: destination }),
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    destination,
    currentSteps,
    goalSteps,
    origin,
    walkingProfile,
  ]);

  useEffect(() => {
    let midnightTimeout: number | undefined;
    const resetForNewDay = () => {
      const nextDate = kstDateKey();
      if (nextDate === currentStepsDateRef.current) {
        return;
      }
      currentStepsDateRef.current = nextDate;
      requestAbortController.current?.abort();
      recommendationResetRef.current();
      setSelectedRouteId(undefined);
      setExpandedRouteId(undefined);
      setPreviewRouteId(undefined);
      setRouteInteracted(false);
      setFormError(undefined);
      setCurrentSteps(0);
    };
    const scheduleMidnightReset = () => {
      if (midnightTimeout !== undefined) {
        window.clearTimeout(midnightTimeout);
      }
      midnightTimeout = window.setTimeout(() => {
        resetForNewDay();
        scheduleMidnightReset();
      }, millisecondsUntilNextKstDay() + 100);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        resetForNewDay();
        scheduleMidnightReset();
      }
    };
    scheduleMidnightReset();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (midnightTimeout !== undefined) {
        window.clearTimeout(midnightTimeout);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [setCurrentSteps, setSelectedRouteId]);

  const result = recommendationMutation.data;
  const hasPlaces = origin !== undefined && destination !== undefined;
  const selectedRecommendation =
    result?.recommendations.find((route) => route.id === selectedRouteId) ??
    result?.recommendations.find(
      (route) => route.id === result.primaryRecommendationId,
    ) ??
    result?.recommendations[0];
  const selectedBusLegs = useMemo(
    () =>
      selectedRecommendation?.legs.flatMap((leg) =>
        leg.bus === undefined ? [] : [leg.bus],
      ) ?? [],
    [selectedRecommendation],
  );
  const plannerUiState = useMemo<PlannerUiState>(() => {
    if (recommendationMutation.isPending) {
      return "calculating";
    }
    if (formError !== undefined) {
      return "error";
    }
    if (activePlaceEditor !== undefined) {
      return "editing-place";
    }
    if (result !== undefined) {
      return routeInteracted ? "route-selected" : "results";
    }
    return hasPlaces ? "ready" : "idle";
  }, [
    activePlaceEditor,
    formError,
    hasPlaces,
    recommendationMutation.isPending,
    result,
    routeInteracted,
  ]);
  const routeFit =
    selectedRecommendation === undefined
      ? "none"
      : selectedRecommendation.dailyGoalCompletionRate >= 1
        ? "complete"
        : "in-progress";
  const vehicleQuery = useQuery({
    queryKey: [
      "bus-vehicles",
      ...selectedBusLegs.map(
        (leg) =>
          `${leg.cityCode}:${leg.routeId}:${leg.boardingNodeOrder}:${leg.alightingNodeOrder}`,
      ),
    ],
    queryFn: async ({ signal }) => {
      const uniqueRoutes = Array.from(
        new Map(
          selectedBusLegs.map((leg) => [
            `${leg.cityCode}:${leg.routeId}`,
            leg,
          ]),
        ).values(),
      );
      const responses = await Promise.all(
        uniqueRoutes.map((leg) =>
          getBusVehicles({
            cityCode: leg.cityCode,
            routeId: leg.routeId,
            signal,
          }),
        ),
      );
      const items = selectRelevantVehiclePositions(
        selectedBusLegs,
        responses.flatMap((response) => response.items),
      );
      return {
        items,
        realtimeAvailable: responses.some(
          (response) => response.realtimeAvailable,
        ) && items.length > 0,
      };
    },
    enabled: selectedBusLegs.length > 0,
    staleTime: 9_000,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 10_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const destinationSearchCenter = origin?.location ?? currentLocation;

  function invalidateResult(): void {
    requestAbortController.current?.abort();
    recommendationMutation.reset();
    setSelectedRouteId(undefined);
    setExpandedRouteId(undefined);
    setPreviewRouteId(undefined);
    setRouteInteracted(false);
    setFormError(undefined);
  }

  function chooseOrigin(place: Place | undefined): void {
    invalidateResult();
    setOrigin(place);
    if (place !== undefined) {
      emitUiEvent("place_selected", "editing-place", { outcome: "success" });
    }
  }

  function chooseDestination(place: Place | undefined): void {
    invalidateResult();
    setDestination(place);
    if (place !== undefined) {
      emitUiEvent("place_selected", "editing-place", { outcome: "success" });
    }
  }

  function setPlaceEditing(
    editor: "origin" | "destination",
    editing: boolean,
  ): void {
    setActivePlaceEditor((current) =>
      editing ? editor : current === editor ? undefined : current,
    );
  }

  function useCurrentLocation(): void {
    if (!("geolocation" in navigator)) {
      setLocationMessage(
        "이 브라우저에서는 현재 위치를 사용할 수 없어요. 장소를 직접 검색해 주세요.",
      );
      return;
    }
    setLocationMessage("현재 위치를 확인하고 있어요.");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lng: position.coords.longitude,
          lat: position.coords.latitude,
        };
        setCurrentLocation(location);
        setLocationMessage("현재 위치의 주소를 확인하고 있어요.");
        void reverseAddress(location)
          .then((result) => {
            chooseOrigin(
              result.place ?? {
                id: `device:coordinate:${location.lng.toFixed(5)}:${location.lat.toFixed(5)}`,
                name: "현재 위치",
                address: "",
                roadAddress: "",
                category: "현재 위치",
                location,
              },
            );
            setLocationMessage(
              result.place === null
                ? "주소는 찾지 못했지만 현재 좌표를 출발지로 설정했어요."
                : "현재 위치를 출발지로 설정했어요.",
            );
          })
          .catch(() => {
            chooseOrigin({
              id: `device:coordinate:${location.lng.toFixed(5)}:${location.lat.toFixed(5)}`,
              name: "현재 위치",
              address: "",
              roadAddress: "",
              category: "현재 위치",
              location,
            });
            setLocationMessage(
              "주소 확인이 지연되어 현재 좌표를 출발지로 설정했어요.",
            );
          });
      },
      (error) => {
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "위치 권한을 사용하지 않았어요. 출발지를 직접 검색하면 계속 이용할 수 있어요."
            : "현재 위치를 확인하지 못했어요. 출발지를 직접 검색해 주세요.",
        );
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60_000,
      },
    );
  }

  function submitRecommendation(): void {
    if (walkingProfile === undefined) {
      setProfileEditorOpen(true);
      setFormError("개인화 걸음 설정을 먼저 완료해 주세요.");
      return;
    }
    if (origin === undefined || destination === undefined) {
      setFormError("출발지와 목적지를 먼저 선택해 주세요.");
      return;
    }
    try {
      const request = automaticRecommendationRequestSchema.parse({
        origin,
        destination,
        currentSteps,
        goalSteps,
        walkingMetric: {
          stepLengthMeters:
            estimatePersonalizedStepLengthMeters(walkingProfile),
          source: "RESEARCH_ESTIMATE",
          modelVersion: "HAN_2026_V1",
        },
      });
      setFormError(undefined);
      recommendationStartedAt.current = performance.now();
      emitUiEvent("recommendation_started", "calculating");
      recommendationMutation.mutate(request);
    } catch {
      setFormError("현재 걸음과 개인화 설정을 확인해 주세요.");
    }
  }

  function selectRecommendation(recommendation: Recommendation): void {
    if (origin === undefined || destination === undefined) {
      return;
    }
    if (selectedRouteId !== recommendation.id) {
      setExpandedRouteId(undefined);
    }
    setRouteInteracted(true);
    setSelectedRouteId(recommendation.id);
    emitUiEvent("route_selected", "route-selected", { outcome: "success" });
  }

  function toggleRecommendationDetails(
    recommendation: Recommendation,
  ): void {
    const willOpen = expandedRouteId !== recommendation.id;
    selectRecommendation(recommendation);
    setExpandedRouteId(willOpen ? recommendation.id : undefined);
    if (willOpen) {
      emitUiEvent("route_details_opened", "route-selected");
    }
  }

  return (
    <>
      {introActive ? (
        <IntroSequence
          onReveal={revealApp}
          onComplete={completeIntro}
        />
      ) : null}
      {!introActive && profileEditorOpen ? (
        <WalkingProfileDialog
          key={profileEditorVersion}
          {...(walkingProfile === undefined
            ? {}
            : {
                initialProfile: walkingProfile,
                initialDailyGoalSteps: goalSteps,
                onCancel: () => setProfileEditorOpen(false),
                onClear: () => {
                  clearPreferences();
                  invalidateResult();
                  setOrigin(undefined);
                  setDestination(undefined);
                  setCurrentSteps(0);
                  setGoalSteps(8000);
                  setWalkingProfile(undefined);
                  setProfileEditorVersion((version) => version + 1);
                },
              })}
          onSave={(profile, dailyGoalSteps) => {
            invalidateResult();
            setWalkingProfile(profile);
            setGoalSteps(dailyGoalSteps);
            setProfileEditorOpen(false);
          }}
        />
      ) : null}
      <ExperienceSettingsDialog
        open={!introActive && settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onModeChanged={(nextMode) =>
          emitUiEvent(
            "experience_mode_changed",
            plannerUiState,
            {},
            nextMode,
          )
        }
      />
      <div
        className={`app-shell ${appEntered ? "is-entered" : "is-intro-pending"}`}
        data-ui-state={plannerUiState}
        data-experience-mode={experienceMode}
        data-route-fit={routeFit}
        data-reduced-motion={reducedMotion ? "true" : "false"}
        data-telemetry-consent={experienceState.telemetryConsent}
        inert={introActive || profileEditorOpen || settingsOpen || undefined}
      >
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark">
              <Navigation aria-hidden="true" />
            </span>
            <span>
              <strong>CHIMap</strong>
              <small>가는 길을 더 건강하게</small>
            </span>
          </div>
          <HeaderStepSummary
            currentSteps={currentSteps}
            goalSteps={goalSteps}
            {...(walkingProfile === undefined ? {} : { walkingProfile })}
            onCurrentStepsChange={(value) => {
              if (value !== currentSteps) {
                invalidateResult();
                setCurrentSteps(value);
              }
            }}
            onEditProfile={() => setProfileEditorOpen(true)}
          />
          <div className="header-status">
            {authEnabled ? <AuthControl /> : null}
            <span className="departure-badge">
              <span className="live-dot" />
              지금 출발 기준
            </span>
            <button
              type="button"
              className="header-settings-button"
              aria-label="화면 사용 설정 열기"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 aria-hidden="true" />
              <span>화면 설정</span>
            </button>
          </div>
        </header>

      <main className="workspace">
        <div className="map-column">
          <MapView
            origin={origin}
            destination={destination}
            recommendations={result?.recommendations ?? []}
            selectedRouteId={selectedRouteId}
            {...(previewRouteId === undefined
              ? {}
              : { highlightedRouteId: previewRouteId })}
            vehiclePositions={vehicleQuery.data?.items ?? []}
            {...(naverMapNcpKeyId === undefined
              ? {}
              : { ncpKeyId: naverMapNcpKeyId })}
          />
        </div>

        <aside id="trip-panel" className="trip-panel">
          <div className="sheet-handle" aria-hidden="true" />
          <form
            className="route-search-form"
            aria-label="출발지와 목적지 검색"
            data-active-editor={activePlaceEditor ?? "none"}
            onSubmit={(event) => {
              event.preventDefault();
              submitRecommendation();
            }}
          >
            <PlaceCombobox
              label="출발지"
              placeholder="출발 장소 검색"
              value={origin}
              {...(currentLocation === undefined
                ? {}
                : { center: currentLocation })}
              onChange={chooseOrigin}
              onEditingChange={(editing) =>
                setPlaceEditing("origin", editing)
              }
              onSearchStart={() =>
                emitUiEvent("place_search_started", "editing-place")
              }
            />
            <div className="route-place-actions">
              <button
                type="button"
                className="route-place-action"
                disabled={origin === undefined && destination === undefined}
                onClick={() => {
                  invalidateResult();
                  swapPlaces();
                }}
              >
                <ArrowDownUp aria-hidden="true" />
                출발·도착 바꾸기
              </button>
              <button
                type="button"
                className="route-place-action"
                aria-label="현재 위치를 출발지로 사용"
                onClick={useCurrentLocation}
              >
                <Crosshair aria-hidden="true" />
                현재 위치
              </button>
            </div>
            <PlaceCombobox
              label="도착지"
              placeholder="도착 장소 검색"
              value={destination}
              {...(destinationSearchCenter === undefined
                ? {}
                : { center: destinationSearchCenter })}
              onChange={chooseDestination}
              onEditingChange={(editing) =>
                setPlaceEditing("destination", editing)
              }
              onSearchStart={() =>
                emitUiEvent("place_search_started", "editing-place")
              }
            />
            {locationMessage === undefined ? null : (
              <p className="location-message" role="status">
                <MapPin aria-hidden="true" size={15} />
                {locationMessage}
              </p>
            )}
            {formError === undefined ? null : (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={
                !hasPlaces ||
                walkingProfile === undefined ||
                recommendationMutation.isPending
              }
            >
              {recommendationMutation.isPending
                ? "건강 경로 계산 중…"
                : "건강 경로 찾기"}
            </button>
          </form>

          <div className="route-output">
            {recommendationMutation.isPending ? (
              <RecommendationProgress />
            ) : result === undefined ? null : (
              <div className="results">
              <div className="results-heading">
                <span className="eyebrow">건강 경로 추천</span>
                <h1>
                  {origin?.name ?? "출발지"} <span>→</span>{" "}
                  {destination?.name ?? "도착지"}
                </h1>
                <p>
                  기본 {formatDuration(result.baseline.durationSeconds)} · 기본
                  도보 {formatDistance(result.baseline.walkDistanceMeters)}
                </p>
                <small className="guided-copy results-guidance">
                  카드를 선택하면 같은 색의 지도 경로와 승하차 위치가 함께
                  바뀝니다.
                </small>
              </div>

              {compactTransitionVisible ? (
                <div className="compact-transition-notice" role="status">
                  <span>
                    <strong>자주 쓰는 화면을 간결하게 정리했어요.</strong>
                    주요 기능 위치는 그대로이고 보조 설명만 줄였습니다.
                  </span>
                  <button type="button" onClick={restoreGuidedMode}>
                    자세히 보기
                  </button>
                  <button
                    type="button"
                    className="compact-notice-dismiss"
                    aria-label="안내 닫기"
                    onClick={dismissCompactTransition}
                  >
                    닫기
                  </button>
                </div>
              ) : null}

              {result.warnings.length === 0 ? null : (
                <details className="results-notices">
                  <summary>
                    <Info aria-hidden="true" size={16} />
                    운행 안내 {result.warnings.length}건
                    <ChevronDown aria-hidden="true" size={17} />
                  </summary>
                  <ul className="warning-list">
                    {result.warnings.map((warning) => (
                      <ResultsNotice key={warning.code} warning={warning} />
                    ))}
                  </ul>
                </details>
              )}

              <div className="recommendation-list">
                {result.recommendations.map((recommendation, index) => {
                  const detailsId = `route-details-${recommendation.id}`;
                  return (
                    <RecommendationCard
                      key={recommendation.id}
                      recommendation={recommendation}
                      selected={
                        recommendation.id === selectedRecommendation?.id
                      }
                      detailsOpen={expandedRouteId === recommendation.id}
                      detailsId={detailsId}
                      onSelect={() => selectRecommendation(recommendation)}
                      resultIndex={index}
                      onPreviewChange={(active) =>
                        setPreviewRouteId(active ? recommendation.id : undefined)
                      }
                      onToggleDetails={() =>
                        toggleRecommendationDetails(recommendation)
                      }
                    />
                  );
                })}
              </div>

              {selectedRecommendation === undefined ||
              expandedRouteId !== selectedRecommendation.id ? null : (
                <>
                  <RouteDetails
                    id={`route-details-${selectedRecommendation.id}`}
                    recommendation={selectedRecommendation}
                    onCollapse={() => setExpandedRouteId(undefined)}
                  />
                  {selectedBusLegs.length > 0 &&
                  (vehicleQuery.isError ||
                    vehicleQuery.data?.realtimeAvailable === false) ? (
                    <p className="realtime-unavailable" role="status">
                      현재 차량 위치를 제공하지 않는 노선이거나 실시간 조회를
                      완료하지 못했습니다. 경로와 정류장 정보는 계속
                      표시됩니다.
                    </p>
                  ) : null}
                </>
              )}

              </div>
            )}
          </div>
          <footer className="data-sources-footer">
            데이터 제공: NAVER 지도 · KAKAO 장소/도보 · 국토교통부 TAGO 버스
          </footer>
        </aside>
        </main>
        {!introActive && experienceState.telemetryConsent === "unknown" ? (
          <aside className="telemetry-banner" aria-label="익명 사용성 정보 선택">
          <span>
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>더 편한 화면을 만드는 데 도움을 주실래요?</strong>
              검색어나 위치 없이 사용 흐름만 익명으로 집계합니다.
            </span>
          </span>
          <div>
            <button
              type="button"
              className="telemetry-accept"
              onClick={() => setTelemetryConsent("granted")}
            >
              허용
            </button>
            <button
              type="button"
              onClick={() => setTelemetryConsent("denied")}
            >
              괜찮아요
            </button>
          </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
