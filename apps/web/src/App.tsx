import {
  recommendationRequestSchema,
  type Coordinate,
  type Place,
  type Recommendation,
  type RecommendationRequest,
} from "@chimap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ChevronDown,
  Crosshair,
  Info,
  Leaf,
  MapPin,
  Navigation,
  TriangleAlert,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { GoalForm } from "./components/GoalForm.js";
import {
  IntroSequence,
  shouldPlayIntro,
} from "./components/IntroSequence.js";
import { MapView } from "./components/MapView.js";
import { PlaceCombobox } from "./components/PlaceCombobox.js";
import { RecommendationCard } from "./components/RecommendationCard.js";
import { RecommendationProgress } from "./components/RecommendationProgress.js";
import { RouteDetails } from "./components/RouteDetails.js";
import {
  ApiClientError,
  createRecommendations,
  getBusVehicles,
  getHealth,
} from "./lib/api.js";
import {
  loadLastTrip,
  saveLastTrip,
  savePreferences,
} from "./lib/storage.js";
import {
  formatDistance,
  formatDuration,
  kstDateTimeLocalToIso,
} from "./lib/time.js";
import { useTripStore } from "./store/trip-store.js";

const naverMapNcpKeyId =
  import.meta.env.VITE_NAVER_MAP_NCP_KEY_ID?.trim() || undefined;
const configuredDemoMode = import.meta.env.VITE_APP_MODE !== "live";

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

export function App() {
  const [introActive, setIntroActive] = useState(shouldPlayIntro);
  const [appEntered, setAppEntered] = useState(() => !shouldPlayIntro());
  const {
    origin,
    destination,
    currentSteps,
    goalSteps,
    deadlineLocal,
    maxExtraMinutes,
    strideLengthMeters,
    safetyBufferMinutes,
    selectedRouteId,
    setOrigin,
    setDestination,
    swapPlaces,
    setSelectedRouteId,
  } = useTripStore();
  const [currentLocation, setCurrentLocation] = useState<
    Coordinate | undefined
  >();
  const [locationMessage, setLocationMessage] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const requestAbortController = useRef<AbortController | undefined>(
    undefined,
  );
  const lastTrip = useMemo(() => loadLastTrip(), []);
  const revealApp = useCallback(() => setAppEntered(true), []);
  const completeIntro = useCallback(() => setIntroActive(false), []);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 60_000,
  });
  const demoMode =
    healthQuery.data?.mode === "mock" ||
    (healthQuery.data === undefined && configuredDemoMode);

  const recommendationMutation = useMutation({
    mutationFn: (request: RecommendationRequest) => {
      requestAbortController.current?.abort();
      const controller = new AbortController();
      requestAbortController.current = controller;
      return createRecommendations(request, controller.signal);
    },
    onSuccess: (response) => {
      setSelectedRouteId(response.recommendations[0]?.id);
      setFormError(undefined);
    },
    onError: (error) => {
      setFormError(readableError(error));
    },
  });

  useEffect(
    () => () => {
      requestAbortController.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      savePreferences({
        version: 1,
        dailyGoalSteps: goalSteps,
        strideLengthMeters,
        maxExtraMinutes,
        safetyBufferMinutes,
        ...(origin === undefined ? {} : { lastOrigin: origin }),
        ...(destination === undefined
          ? {}
          : { lastDestination: destination }),
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    destination,
    goalSteps,
    maxExtraMinutes,
    origin,
    safetyBufferMinutes,
    strideLengthMeters,
  ]);

  const result = recommendationMutation.data;
  const routeProvider =
    result?.mode === "live"
      ? "TAGO"
      : result?.mode === "mock"
        ? "DEMO"
        : demoMode
          ? "DEMO"
          : "TAGO";
  const selectedRecommendation =
    result?.recommendations.find((route) => route.id === selectedRouteId) ??
    result?.recommendations[0];
  const selectedBusLegs = useMemo(
    () =>
      selectedRecommendation?.legs.flatMap((leg) =>
        leg.bus === undefined ? [] : [leg.bus],
      ) ?? [],
    [selectedRecommendation],
  );
  const vehicleQuery = useQuery({
    queryKey: [
      "bus-vehicles",
      ...selectedBusLegs.map(
        (leg) => `${leg.cityCode}:${leg.routeId}`,
      ),
    ],
    queryFn: async ({ signal }) => {
      const responses = await Promise.all(
        selectedBusLegs.map((leg) =>
          getBusVehicles({
            cityCode: leg.cityCode,
            routeId: leg.routeId,
            signal,
          }),
        ),
      );
      return {
        items: responses.flatMap((response) => response.items),
        realtimeAvailable: responses.some(
          (response) => response.realtimeAvailable,
        ),
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
    setFormError(undefined);
  }

  function chooseOrigin(place: Place | undefined): void {
    invalidateResult();
    setOrigin(place);
  }

  function chooseDestination(place: Place | undefined): void {
    invalidateResult();
    setDestination(place);
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
        chooseOrigin({
          id: "current-location",
          name: "현재 위치",
          address: "",
          roadAddress: "",
          category: "현재 위치",
          location,
        });
        setLocationMessage("현재 위치를 출발지로 설정했어요.");
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
    if (origin === undefined || destination === undefined) {
      setFormError("출발지와 목적지를 먼저 선택해 주세요.");
      return;
    }
    try {
      const request = recommendationRequestSchema.parse({
        origin,
        destination,
        deadline: kstDateTimeLocalToIso(deadlineLocal),
        currentSteps,
        goalSteps,
        maxExtraMinutes,
        strideLengthMeters,
        safetyBufferMinutes,
      });
      setFormError(undefined);
      recommendationMutation.mutate(request);
    } catch {
      setFormError("입력 범위와 도착 마감시간을 확인해 주세요.");
    }
  }

  function selectRecommendation(recommendation: Recommendation): void {
    if (origin === undefined || destination === undefined) {
      return;
    }
    setSelectedRouteId(recommendation.id);
    saveLastTrip({
      version: 1,
      selectedAt: new Date().toISOString(),
      originName: origin.name,
      destinationName: destination.name,
      routeType: recommendation.type,
      expectedSteps: recommendation.estimatedSteps,
      expectedArrivalAt: recommendation.arrivalAt,
    });
  }

  const hasPlaces = origin !== undefined && destination !== undefined;

  return (
    <>
      {introActive ? (
        <IntroSequence
          onReveal={revealApp}
          onComplete={completeIntro}
        />
      ) : null}
      <div
        className={`app-shell ${appEntered ? "is-entered" : "is-intro-pending"}`}
        inert={introActive || undefined}
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
        <div className="header-status">
          <span className="departure-badge">
            <span className="live-dot" />
            지금 출발 기준
          </span>
          {demoMode ? (
            <span className="demo-badge">
              <Leaf aria-hidden="true" size={14} />
              데모 데이터
            </span>
          ) : null}
        </div>
      </header>

      <main className="workspace">
        <div className="map-column">
          <div className="search-panel" aria-label="출발지와 목적지 검색">
            <div className="search-fields">
              <PlaceCombobox
                label="출발지"
                placeholder="출발 장소 검색"
                value={origin}
                {...(currentLocation === undefined
                  ? {}
                  : { center: currentLocation })}
                onChange={chooseOrigin}
              />
              <div className="place-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="출발지와 목적지 바꾸기"
                  disabled={origin === undefined && destination === undefined}
                  onClick={() => {
                    invalidateResult();
                    swapPlaces();
                  }}
                >
                  <ArrowDownUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="현재 위치를 출발지로 사용"
                  onClick={useCurrentLocation}
                >
                  <Crosshair aria-hidden="true" />
                </button>
              </div>
              <PlaceCombobox
                label="목적지"
                placeholder="도착 장소 검색"
                value={destination}
                {...destinationSearchCenter === undefined
                  ? {}
                  : { center: destinationSearchCenter }}
                onChange={chooseDestination}
              />
            </div>
            {locationMessage === undefined ? null : (
              <p className="location-message" role="status">
                <MapPin aria-hidden="true" size={15} />
                {locationMessage}
              </p>
            )}
          </div>

          <MapView
            origin={origin}
            destination={destination}
            recommendations={result?.recommendations ?? []}
            selectedRouteId={selectedRouteId}
            routeProvider={routeProvider}
            vehiclePositions={vehicleQuery.data?.items ?? []}
            {...(naverMapNcpKeyId === undefined
              ? {}
              : { ncpKeyId: naverMapNcpKeyId })}
          />
        </div>

        <aside id="trip-panel" className="trip-panel">
          <div className="sheet-handle" aria-hidden="true" />
          {demoMode ? (
            <div className="demo-callout">
              <Leaf aria-hidden="true" />
              <span>
                <strong>현재는 데모 경로를 보여드려요.</strong>
                TAGO 및 카카오 서버 키를 연결하면 실제 장소와 버스 경로를 조회합니다.
              </span>
            </div>
          ) : null}

          {!hasPlaces ? (
            <section className="initial-state">
              <span className="initial-icon">
                <Navigation aria-hidden="true" />
              </span>
              <span className="eyebrow">건강한 이동의 시작</span>
              <h1>어디로 이동하시나요?</h1>
              <p>
                출발지와 목적지는 그대로 두고, 마감시간 안에서 조금 더 걷는
                경로를 찾아드려요.
              </p>
              <ol>
                <li><span>1</span>장소를 선택해요</li>
                <li><span>2</span>오늘 걸음 목표를 알려주세요</li>
                <li><span>3</span>시간에 맞는 건강 경로를 비교해요</li>
              </ol>
              {lastTrip === undefined ? null : (
                <div className="last-trip">
                  <small>지난 선택</small>
                  <strong>
                    {lastTrip.originName} → {lastTrip.destinationName}
                  </strong>
                  <span>
                    {lastTrip.routeType} · 약{" "}
                    {lastTrip.expectedSteps.toLocaleString("ko-KR")}걸음
                  </span>
                </div>
              )}
            </section>
          ) : recommendationMutation.isPending ? (
            <RecommendationProgress />
          ) : result === undefined ? (
            <GoalForm
              canSubmit={hasPlaces}
              isSubmitting={false}
              {...(formError === undefined ? {} : { errorMessage: formError })}
              onSubmit={submitRecommendation}
            />
          ) : (
            <div className="results">
              <div className="results-heading">
                <span className="eyebrow">건강 경로 추천</span>
                <h1>
                  {origin.name} <span>→</span> {destination.name}
                </h1>
                <p>
                  기본 {formatDuration(result.baseline.durationSeconds)} · 기본
                  도보 {formatDistance(result.baseline.walkDistanceMeters)}
                </p>
              </div>

              <ul className="warning-list">
                {result.warnings.map((warning) => (
                  <ResultsNotice key={warning.code} warning={warning} />
                ))}
              </ul>

              <div className="recommendation-list">
                {result.recommendations.map((recommendation) => (
                  <RecommendationCard
                    key={recommendation.id}
                    recommendation={recommendation}
                    selected={recommendation.id === selectedRecommendation?.id}
                    onSelect={() => selectRecommendation(recommendation)}
                  />
                ))}
              </div>

              {selectedRecommendation === undefined ? null : (
                <>
                  <RouteDetails recommendation={selectedRecommendation} />
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

              <details className="condition-editor">
                <summary>
                  이동 조건 수정
                  <ChevronDown aria-hidden="true" size={18} />
                </summary>
                <GoalForm
                  canSubmit={hasPlaces}
                  isSubmitting={false}
                  onSubmit={submitRecommendation}
                />
              </details>
            </div>
          )}
        </aside>
      </main>
      </div>
    </>
  );
}
