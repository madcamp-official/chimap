import type {
  Coordinate,
  Place,
  Recommendation,
  RouteLeg,
} from "@chimap/contracts";
import { AlertTriangle, Map, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { RelevantVehiclePosition } from "../lib/vehicle-positions.js";

type NaverLatLng = object;
type NaverBounds = object;
type NaverMap = {
  destroy: () => void;
  fitBounds: (
    bounds: NaverBounds,
    options?: {
      top: number;
      right: number;
      bottom: number;
      left: number;
      maxZoom: number;
    },
  ) => void;
  setCenter: (center: NaverLatLng) => void;
  setZoom: (zoom: number) => void;
};
type NaverOverlay = {
  setMap: (map: NaverMap | null) => void;
};
type NaverMapsApi = {
  Map: new (
    element: HTMLElement,
    options: {
      center: NaverLatLng;
      zoom: number;
      mapTypeId: string;
      logoControl: boolean;
      mapDataControl: boolean;
      scaleControl: boolean;
      zoomControl: boolean;
      zoomControlOptions: { position: string };
    },
  ) => NaverMap;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new (
    southWest: NaverLatLng,
    northEast: NaverLatLng,
  ) => NaverBounds;
  Polyline: new (options: {
    map: NaverMap;
    path: NaverLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: "solid" | "shortdash";
    strokeLineCap: "round";
    strokeLineJoin: "round";
    zIndex: number;
  }) => NaverOverlay;
  Marker: new (options: {
    map: NaverMap;
    position: NaverLatLng;
    icon: {
      content: HTMLElement;
      size: { width: number; height: number };
      anchor: { x: number; y: number };
    };
    title: string;
    clickable: boolean;
    zIndex: number;
  }) => NaverOverlay;
  MapTypeId: {
    NORMAL: string;
  };
  Position: {
    RIGHT_CENTER: string;
  };
};

type NaverWindow = Window & {
  naver?: {
    maps: NaverMapsApi;
  };
  __chimapNaverMapsReady?: () => void;
  navermap_authFailure?: () => void;
};

const NAVER_SDK_SCRIPT_ID = "chimap-naver-maps-sdk";
const NAVER_SDK_TIMEOUT_MS = 12_000;
const NAVER_SDK_AUTH_SETTLE_MS = 500;
const DEFAULT_CENTER: Coordinate = { lng: 127.3845, lat: 36.3504 };

type TransitMarker = {
  coordinate: Coordinate;
  label: "탑승" | "환승" | "하차";
  tone: "boarding" | "transfer" | "alighting";
  title: string;
};

let sdkPromise: Promise<NaverMapsApi> | undefined;
let sdkAuthenticationFailed = false;

function isNaverMapsApi(value: unknown): value is NaverMapsApi {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const maps = value as Partial<NaverMapsApi>;
  return (
    typeof maps.Map === "function" &&
    typeof maps.LatLng === "function" &&
    typeof maps.LatLngBounds === "function" &&
    typeof maps.Polyline === "function" &&
    typeof maps.Marker === "function" &&
    maps.MapTypeId !== undefined &&
    maps.Position !== undefined
  );
}

function detachOverlay(overlay: NaverOverlay): void {
  try {
    overlay.setMap(null);
  } catch {
    // 인증 실패 시 NAVER SDK가 내부 namespace를 먼저 정리할 수 있다.
  }
}

function destroyMap(map: NaverMap | undefined): void {
  try {
    map?.destroy();
  } catch {
    // 인증 실패 후 SDK의 destroy가 예외를 내더라도 React cleanup은 유지한다.
  }
}

function loadNaverSdk(ncpKeyId: string): Promise<NaverMapsApi> {
  const naverWindow = window as NaverWindow;
  if (isNaverMapsApi(naverWindow.naver?.maps)) {
    return Promise.resolve(naverWindow.naver.maps);
  }
  if (sdkPromise !== undefined) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    document.getElementById(NAVER_SDK_SCRIPT_ID)?.remove();
    const script = document.createElement("script");
    script.id = NAVER_SDK_SCRIPT_ID;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(ncpKeyId)}&callback=__chimapNaverMapsReady`;
    script.async = true;
    let timeout = 0;
    let readyTimer = 0;
    let settled = false;
    const previousAuthFailure = naverWindow.navermap_authFailure;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(readyTimer);
      delete naverWindow.__chimapNaverMapsReady;
      if (previousAuthFailure === undefined) {
        delete naverWindow.navermap_authFailure;
      } else {
        naverWindow.navermap_authFailure = previousAuthFailure;
      }
    };
    const resolveWhenReady = () => {
      if (settled) {
        return;
      }
      const maps = naverWindow.naver?.maps;
      if (!isNaverMapsApi(maps)) {
        return;
      }
      if (readyTimer !== 0) {
        return;
      }
      readyTimer = window.setTimeout(() => {
        if (settled) {
          return;
        }
        const settledMaps = naverWindow.naver?.maps;
        if (!isNaverMapsApi(settledMaps)) {
          fail(new Error("NAVER Maps SDK namespace를 확인하지 못했습니다."));
          return;
        }
        settled = true;
        cleanup();
        resolve(settledMaps);
      }, NAVER_SDK_AUTH_SETTLE_MS);
    };
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      script.remove();
      sdkPromise = undefined;
      reject(error);
    };
    timeout = window.setTimeout(() => {
      fail(new Error("NAVER Maps SDK 응답 시간이 초과됐습니다."));
    }, NAVER_SDK_TIMEOUT_MS);
    naverWindow.__chimapNaverMapsReady = resolveWhenReady;
    naverWindow.navermap_authFailure = () => {
      sdkAuthenticationFailed = true;
      fail(new Error("NAVER Maps Client ID 인증에 실패했습니다."));
    };
    script.onload = resolveWhenReady;
    script.onerror = () => {
      fail(new Error("NAVER Maps SDK를 불러오지 못했습니다."));
    };
    document.head.append(script);
  });
  return sdkPromise;
}

function legStyle(leg: RouteLeg): {
  color: string;
  width: number;
  dash: "solid" | "shortdash";
} {
  if (leg.isExerciseSegment) {
    return { color: "#f47b35", width: 8, dash: "solid" };
  }
  if (leg.mode === "BUS") {
    return { color: "#2e6dd8", width: 6, dash: "solid" };
  }
  if (leg.mode === "SUBWAY") {
    return { color: "#7957b8", width: 6, dash: "solid" };
  }
  return { color: "#6f7775", width: 5, dash: "shortdash" };
}

function createMarkerElement(
  label: string,
  tone:
    | "origin"
    | "exercise"
    | "destination"
    | "boarding"
    | "transfer"
    | "alighting"
    | "vehicle",
  title?: string,
): { element: HTMLElement; width: number } {
  const width = Math.max(48, Math.min(96, label.length * 13 + 22));
  const element = document.createElement("div");
  element.className = `map-marker map-marker-${tone}`;
  element.textContent = label;
  element.title = title ?? label;
  element.style.width = `${width}px`;
  element.setAttribute("aria-hidden", "true");
  return { element, width };
}

export function transitMarkers(
  route: Recommendation | undefined,
): TransitMarker[] {
  const busLegs = route?.legs.filter((leg) => leg.bus !== undefined) ?? [];
  if (busLegs.length === 0) {
    return [];
  }
  const firstBus = busLegs[0]!.bus!;
  const lastBus = busLegs.at(-1)!.bus!;
  const markers: TransitMarker[] = [
    {
      coordinate: {
        lat: firstBus.boardingStop.latitude,
        lng: firstBus.boardingStop.longitude,
      },
      label: "탑승",
      tone: "boarding",
      title: `${firstBus.boardingStop.name} · ${firstBus.routeNo}번 탑승`,
    },
  ];
  for (let index = 1; index < busLegs.length; index += 1) {
    const previous = busLegs[index - 1]!.bus!;
    const current = busLegs[index]!.bus!;
    markers.push({
      coordinate: {
        lat: current.boardingStop.latitude,
        lng: current.boardingStop.longitude,
      },
      label: "환승",
      tone: "transfer",
      title: `${current.boardingStop.name} · ${previous.routeNo}번에서 ${current.routeNo}번으로 환승`,
    });
  }
  markers.push({
    coordinate: {
      lat: lastBus.alightingStop.latitude,
      lng: lastBus.alightingStop.longitude,
    },
    label: "하차",
    tone: "alighting",
    title: `${lastBus.alightingStop.name} · ${lastBus.routeNo}번 하차`,
  });
  return markers;
}

function RoutePreview({
  route,
  origin,
  destination,
  vehiclePositions,
}: {
  route: Recommendation | undefined;
  origin: Place | undefined;
  destination: Place | undefined;
  vehiclePositions: RelevantVehiclePosition[];
}) {
  const geometry = useMemo(() => {
    const coordinates = route?.legs.flatMap((leg) => leg.coordinates) ?? [];
    const all = [
      ...coordinates,
      ...(origin === undefined ? [] : [origin.location]),
      ...(destination === undefined ? [] : [destination.location]),
    ];
    if (all.length === 0) {
      return undefined;
    }
    const lngValues = all.map((point) => point.lng);
    const latValues = all.map((point) => point.lat);
    const minLng = Math.min(...lngValues);
    const maxLng = Math.max(...lngValues);
    const minLat = Math.min(...latValues);
    const maxLat = Math.max(...latValues);
    const lngSpan = Math.max(maxLng - minLng, 0.002);
    const latSpan = Math.max(maxLat - minLat, 0.002);
    const project = (point: Coordinate): [number, number] => [
      28 + ((point.lng - minLng) / lngSpan) * 304,
      212 - ((point.lat - minLat) / latSpan) * 184,
    ];
    return { project };
  }, [destination, origin, route]);

  if (geometry === undefined || route === undefined) {
    return (
      <div className="map-empty-illustration">
        <Map aria-hidden="true" />
        <p>장소를 선택하면 경로가 이곳에 표시돼요.</p>
      </div>
    );
  }

  return (
    <svg
      className="route-preview-svg"
      viewBox="0 0 360 240"
      role="img"
      aria-label={`${origin?.name ?? "출발지"}에서 ${destination?.name ?? "목적지"}까지 선택 경로선 미리보기`}
    >
      <defs>
        <pattern
          id="grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 24 0 L 0 0 0 24"
            fill="none"
            stroke="#d9ddd8"
            strokeWidth="0.7"
          />
        </pattern>
      </defs>
      <rect width="360" height="240" fill="url(#grid)" />
      {route.legs.map((leg) => {
        if (leg.coordinates.length < 2) {
          return null;
        }
        const style = legStyle(leg);
        return (
          <polyline
            key={leg.id}
            points={leg.coordinates
              .map((point) => geometry.project(point).join(","))
              .join(" ")}
            fill="none"
            stroke={style.color}
            strokeWidth={style.width}
            strokeDasharray={style.dash === "shortdash" ? "5 7" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {origin === undefined ? null : (
        <g transform={`translate(${geometry.project(origin.location).join(" ")})`}>
          <circle r="9" fill="#2e6dd8" stroke="white" strokeWidth="4" />
          <text x="12" y="4" className="preview-label">
            출발
          </text>
        </g>
      )}
      {route.legs
        .filter((leg) => leg.isExerciseSegment)
        .slice(0, 1)
        .map((leg) => {
          const point = leg.coordinates[0];
          return point === undefined ? null : (
            <g
              key={leg.id}
              transform={`translate(${geometry.project(point).join(" ")})`}
            >
              <circle r="8" fill="#f47b35" stroke="white" strokeWidth="3" />
              <text x="11" y="4" className="preview-label">
                운동 시작
              </text>
            </g>
          );
        })}
      {destination === undefined ? null : (
        <g
          transform={`translate(${geometry.project(destination.location).join(" ")})`}
        >
          <circle r="9" fill="#2a9864" stroke="white" strokeWidth="4" />
          <text x="-12" y="-14" textAnchor="end" className="preview-label">
            도착
          </text>
        </g>
      )}
      {transitMarkers(route).map((marker) => {
          const [x, y] = geometry.project(marker.coordinate);
          const fill =
            marker.tone === "boarding"
              ? "#2e6dd8"
              : marker.tone === "transfer"
                ? "#f47b35"
                : "#7957b8";
          return (
            <g
              key={`${marker.label}:${marker.coordinate.lat}:${marker.coordinate.lng}`}
              transform={`translate(${x} ${y})`}
            >
              <circle r="7" fill={fill} stroke="white" strokeWidth="2" />
              <text x="10" y="4" className="preview-label">
                {marker.label}
              </text>
            </g>
          );
        })}
      {vehiclePositions.map((vehicle, index) => {
        const [x, y] = geometry.project({
          lat: vehicle.latitude,
          lng: vehicle.longitude,
        });
        return (
          <g
            key={`${vehicle.routeId}:${vehicle.vehicleNo ?? index}`}
            transform={`translate(${x} ${y})`}
          >
            <circle r="7" fill="#0b6b50" stroke="white" strokeWidth="2" />
            <text x="10" y="4" className="preview-label">
              {vehicle.routeNo}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type MapViewProps = {
  origin: Place | undefined;
  destination: Place | undefined;
  recommendations: Recommendation[];
  selectedRouteId: string | undefined;
  ncpKeyId?: string;
  vehiclePositions?: RelevantVehiclePosition[];
};

export function MapView({
  origin,
  destination,
  recommendations,
  selectedRouteId,
  ncpKeyId,
  vehiclePositions = [],
}: MapViewProps) {
  const normalizedNcpKeyId = ncpKeyId?.trim();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | undefined>(undefined);
  const overlaysRef = useRef<NaverOverlay[]>([]);
  const [status, setStatus] = useState<
    "missing" | "loading" | "ready" | "error"
  >(normalizedNcpKeyId === undefined || normalizedNcpKeyId.length === 0
    ? "missing"
    : "loading");
  const [reloadToken, setReloadToken] = useState(0);
  const selectedRoute =
    recommendations.find((route) => route.id === selectedRouteId) ??
    recommendations[0];

  useEffect(() => {
    if (normalizedNcpKeyId === undefined || normalizedNcpKeyId.length === 0) {
      setStatus("missing");
      return;
    }
    let cancelled = false;
    const naverWindow = window as NaverWindow;
    if (sdkAuthenticationFailed) {
      document.getElementById(NAVER_SDK_SCRIPT_ID)?.remove();
      sdkPromise = undefined;
      delete naverWindow.naver;
      sdkAuthenticationFailed = false;
    }
    const previousAuthFailure = naverWindow.navermap_authFailure;
    const handleAuthFailure = () => {
      sdkPromise = undefined;
      sdkAuthenticationFailed = true;
      overlaysRef.current.forEach(detachOverlay);
      overlaysRef.current = [];
      destroyMap(mapRef.current);
      mapRef.current = undefined;
      if (!cancelled) {
        setStatus("error");
      }
    };
    naverWindow.navermap_authFailure = handleAuthFailure;
    setStatus("loading");
    loadNaverSdk(normalizedNcpKeyId)
      .then(() => {
        if (!cancelled) {
          sdkAuthenticationFailed = false;
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
      if (naverWindow.navermap_authFailure === handleAuthFailure) {
        if (previousAuthFailure === undefined) {
          delete naverWindow.navermap_authFailure;
        } else {
          naverWindow.navermap_authFailure = previousAuthFailure;
        }
      }
    };
  }, [normalizedNcpKeyId, reloadToken]);

  useEffect(() => {
    if (status !== "ready" || containerRef.current === null) {
      return;
    }
    const maps = (window as NaverWindow).naver?.maps;
    if (!isNaverMapsApi(maps)) {
      setStatus("error");
      return;
    }

    const initialCenter = origin?.location ?? destination?.location ?? DEFAULT_CENTER;
    try {
      mapRef.current = new maps.Map(containerRef.current, {
        center: new maps.LatLng(initialCenter.lat, initialCenter.lng),
        zoom: 14,
        mapTypeId: maps.MapTypeId.NORMAL,
        logoControl: true,
        mapDataControl: true,
        scaleControl: true,
        zoomControl: true,
        zoomControlOptions: { position: maps.Position.RIGHT_CENTER },
      });
    } catch {
      setStatus("error");
      return;
    }

    return () => {
      overlaysRef.current.forEach(detachOverlay);
      overlaysRef.current = [];
      destroyMap(mapRef.current);
      mapRef.current = undefined;
    };
  }, [status]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = (window as NaverWindow).naver?.maps;
    if (status !== "ready" || map === undefined || !isNaverMapsApi(maps)) {
      return;
    }

    overlaysRef.current.forEach(detachOverlay);
    const overlays: NaverOverlay[] = [];

    try {

    for (const recommendation of recommendations) {
      const selected = recommendation.id === selectedRoute?.id;
      for (const leg of recommendation.legs) {
        if (leg.coordinates.length < 2) {
          continue;
        }
        const style = legStyle(leg);
        overlays.push(
          new maps.Polyline({
            map,
            path: leg.coordinates.map(
              (point) => new maps.LatLng(point.lat, point.lng),
            ),
            strokeWeight: selected ? style.width : Math.max(3, style.width - 2),
            strokeColor: style.color,
            strokeOpacity: selected ? 0.95 : 0.2,
            strokeStyle: style.dash,
            strokeLineCap: "round",
            strokeLineJoin: "round",
            zIndex: selected ? 20 : 10,
          }),
        );
      }
    }

    const markerPoints: Array<{
      coordinate: Coordinate;
      label: string;
      tone:
        | "origin"
        | "exercise"
        | "destination"
        | "boarding"
        | "transfer"
        | "alighting"
        | "vehicle";
      title?: string;
    }> = [
      ...(origin === undefined
        ? []
        : [
            {
              coordinate: origin.location,
              label: "출발",
              tone: "origin" as const,
            },
          ]),
      ...(destination === undefined
        ? []
        : [
            {
              coordinate: destination.location,
              label: "도착",
              tone: "destination" as const,
            },
          ]),
    ];
    const exerciseStart = selectedRoute?.legs
      .find((leg) => leg.isExerciseSegment)
      ?.coordinates[0];
    if (exerciseStart !== undefined) {
      markerPoints.push({
        coordinate: exerciseStart,
        label: "운동 시작",
        tone: "exercise",
      });
    }
    markerPoints.push(...transitMarkers(selectedRoute));
    vehiclePositions.forEach((vehicle) => {
      markerPoints.push({
        coordinate: {
          lat: vehicle.latitude,
          lng: vehicle.longitude,
        },
        label: vehicle.routeNo,
        tone: "vehicle",
        title:
          vehicle.vehicleNo === null
            ? `${vehicle.routeNo}번 탑승 예정 차량 · ${vehicle.stopsUntilBoarding}정류장 전`
            : `${vehicle.routeNo}번 탑승 예정 차량 ${vehicle.vehicleNo} · ${vehicle.stopsUntilBoarding}정류장 전`,
      });
    });
    markerPoints.forEach((marker) => {
      const icon = createMarkerElement(
        marker.label,
        marker.tone,
        marker.title,
      );
      overlays.push(
        new maps.Marker({
          map,
          position: new maps.LatLng(
            marker.coordinate.lat,
            marker.coordinate.lng,
          ),
          icon: {
            content: icon.element,
            size: { width: icon.width, height: 34 },
            anchor: { x: icon.width / 2, y: 34 },
          },
          title: marker.title ?? marker.label,
          clickable: false,
          zIndex: 30,
        }),
      );
    });
    overlaysRef.current = overlays;

    const selectedCoordinates =
      selectedRoute?.legs.flatMap((leg) => leg.coordinates) ?? [];
    const visibleCoordinates = [
      ...selectedCoordinates,
      ...(origin === undefined ? [] : [origin.location]),
      ...(destination === undefined ? [] : [destination.location]),
    ];
    if (visibleCoordinates.length >= 2) {
      const latitudes = visibleCoordinates.map((point) => point.lat);
      const longitudes = visibleCoordinates.map((point) => point.lng);
      const bounds = new maps.LatLngBounds(
        new maps.LatLng(Math.min(...latitudes), Math.min(...longitudes)),
        new maps.LatLng(Math.max(...latitudes), Math.max(...longitudes)),
      );
      map.fitBounds(bounds, {
        top: 128,
        right: 54,
        bottom: 54,
        left: 54,
        maxZoom: 16,
      });
    } else if (visibleCoordinates[0] !== undefined) {
      map.setCenter(
        new maps.LatLng(
          visibleCoordinates[0].lat,
          visibleCoordinates[0].lng,
        ),
      );
      map.setZoom(15);
    }

    } catch {
      overlays.forEach(detachOverlay);
      if (overlaysRef.current === overlays) {
        overlaysRef.current = [];
      }
      setStatus("error");
      return;
    }

    return () => {
      overlays.forEach(detachOverlay);
      if (overlaysRef.current === overlays) {
        overlaysRef.current = [];
      }
    };
  }, [
    destination,
    origin,
    recommendations,
    selectedRoute,
    status,
    vehiclePositions,
  ]);

  return (
    <section className="map-region" aria-label="경로 지도">
      <div
        ref={containerRef}
        className={`naver-map ${status === "ready" ? "" : "is-hidden"}`}
        aria-label="네이버 지도에 표시된 추천 경로"
      />
      <p className="sr-only" role="status">
        {status === "ready"
          ? "네이버 지도가 준비됐어요. 경로 계산에는 KAKAO 도보와 TAGO 버스를 사용합니다."
          : status === "missing"
            ? "네이버 지도 키가 없어 경로선 미리보기를 표시합니다."
            : status === "loading"
              ? "네이버 지도를 불러오는 중입니다."
              : "네이버 지도를 불러오지 못했습니다."}
      </p>
      {status !== "ready" ? (
        <div className="map-fallback">
          <RoutePreview
            route={selectedRoute}
            origin={origin}
            destination={destination}
            vehiclePositions={vehiclePositions}
          />
          <div className="map-fallback-notice">
            <AlertTriangle aria-hidden="true" size={17} />
            <span>
              <strong>
                {status === "missing"
                  ? "네이버 지도 키 없이 경로선 미리보기로 표시 중"
                  : status === "loading"
                    ? "네이버 지도를 불러오는 중"
                    : "네이버 지도를 불러오지 못했어요"}
              </strong>
              추천 카드와 텍스트 이동 단계는 계속 사용할 수 있어요.
            </span>
            {status === "error" ? (
              <button
                type="button"
                className="map-retry"
                onClick={() => setReloadToken((value) => value + 1)}
              >
                <RefreshCw aria-hidden="true" size={15} />
                다시 불러오기
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="map-provider-chip" aria-label="지도와 경로 데이터 제공자">
        <span><strong>NAVER</strong> 지도</span>
        <i aria-hidden="true">+</i>
        <span><strong>KAKAO</strong> 검색/도보</span>
        <i aria-hidden="true">+</i>
        <span><strong>TAGO</strong> 버스</span>
      </div>
      <div className="map-legend" aria-label="지도 경로 범례">
        <span><i className="legend-bus" />버스</span>
        <span><i className="legend-subway" />지하철</span>
        <span><i className="legend-walk" />일반 도보</span>
        <span><i className="legend-exercise" />추가 운동</span>
      </div>
    </section>
  );
}
