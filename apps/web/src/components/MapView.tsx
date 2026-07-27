import type {
  Coordinate,
  Place,
  Recommendation,
  RouteLeg,
} from "@chimap/contracts";
import { AlertTriangle, Map, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import busIconUrl from "../../../../bus_icon.webp";
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
  if (leg.mode === "WALK") {
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
    | "destination"
    | "boarding"
    | "transfer"
    | "alighting"
    | "vehicle",
  title?: string,
): { element: HTMLElement; width: number; height: number } {
  if (tone === "vehicle") {
    const element = document.createElement("div");
    element.className = "map-marker map-marker-vehicle";
    element.title = title ?? label;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", title ?? label);
    const image = document.createElement("img");
    image.src = busIconUrl;
    image.alt = "";
    const routeNumber = document.createElement("span");
    routeNumber.className = "map-marker-vehicle-number";
    routeNumber.textContent = label;
    routeNumber.style.fontSize = `${Math.max(5, Math.min(12, 38 / Math.max(1, label.length)))}px`;
    routeNumber.style.transform = `scaleX(${Math.min(1, 4.5 / Math.max(1, label.length))})`;
    element.append(image, routeNumber);
    return { element, width: 60, height: 60 };
  }
  const width = Math.max(48, Math.min(96, label.length * 13 + 22));
  const element = document.createElement("div");
  element.className = `map-marker map-marker-${tone}`;
  element.textContent = label;
  element.title = title ?? label;
  element.style.width = `${width}px`;
  element.setAttribute("aria-hidden", "true");
  return { element, width, height: 34 };
}

function vehicleMarkerTitle(vehicle: RelevantVehiclePosition): string {
  const vehicleLabel =
    vehicle.vehicleNo === null ? "" : ` · 차량 ${vehicle.vehicleNo}`;
  if (vehicle.displayReason === "ARRIVING_SOON") {
    const minutes = Math.max(
      1,
      Math.ceil((vehicle.arrivalSeconds ?? 0) / 60),
    );
    return `${vehicle.routeNo}번 · ${minutes}분 후 도착${vehicleLabel}`;
  }
  return `${vehicle.routeNo}번 · 이동 구간 운행 중${vehicleLabel}`;
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
  recommendations,
  selectedRouteId,
  highlightedRouteId,
  origin,
  destination,
  vehiclePositions,
}: {
  recommendations: Recommendation[];
  selectedRouteId: string | undefined;
  highlightedRouteId: string | undefined;
  origin: Place | undefined;
  destination: Place | undefined;
  vehiclePositions: RelevantVehiclePosition[];
}) {
  const selectedRoute =
    recommendations.find((route) => route.id === selectedRouteId) ??
    recommendations[0];
  const geometry = useMemo(() => {
    const coordinates = recommendations.flatMap((route) =>
      route.legs.flatMap((leg) => leg.coordinates),
    );
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
  }, [destination, origin, recommendations]);

  if (geometry === undefined) {
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
      {recommendations.length === 0 &&
      origin !== undefined &&
      destination !== undefined ? (
        <line
          className="preview-place-connection"
          x1={geometry.project(origin.location)[0]}
          y1={geometry.project(origin.location)[1]}
          x2={geometry.project(destination.location)[0]}
          y2={geometry.project(destination.location)[1]}
        />
      ) : null}
      {recommendations.map((route) => {
        const selected = route.id === selectedRoute?.id;
        const highlighted = route.id === highlightedRouteId;
        return route.legs.map((leg) => {
          if (leg.coordinates.length < 2) {
            return null;
          }
          const style = legStyle(leg);
          return (
            <polyline
              key={`${route.id}:${leg.id}`}
              className={`preview-route-line ${
                selected ? "is-selected" : highlighted ? "is-highlighted" : ""
              }`}
              points={leg.coordinates
                .map((point) => geometry.project(point).join(","))
                .join(" ")}
              fill="none"
              stroke={style.color}
              strokeWidth={selected ? style.width : Math.max(3, style.width - 2)}
              strokeDasharray={style.dash === "shortdash" ? "5 7" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        });
      })}
      {origin === undefined ? null : (
        <g transform={`translate(${geometry.project(origin.location).join(" ")})`}>
          <circle r="9" fill="#2e6dd8" stroke="white" strokeWidth="4" />
          <text x="12" y="4" className="preview-label">
            출발
          </text>
        </g>
      )}
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
      {transitMarkers(selectedRoute).map((marker) => {
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
            <title>{vehicleMarkerTitle(vehicle)}</title>
            <image href={busIconUrl} x="-18" y="-27" width="36" height="36" />
            <rect
              className="preview-vehicle-display"
              x="-7.2"
              y="-14.75"
              width="14.4"
              height="7.9"
              fill="#fff"
            />
            <text
              x="0"
              y="-9.3"
              textAnchor="middle"
              fill="#111"
              className="preview-vehicle-number"
              {...(vehicle.routeNo.length > 5
                ? { textLength: 14, lengthAdjust: "spacingAndGlyphs" }
                : {})}
            >
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
  highlightedRouteId?: string;
  cameraResetKey?: string | undefined;
  ncpKeyId?: string;
  vehiclePositions?: RelevantVehiclePosition[];
};

export function MapView({
  origin,
  destination,
  recommendations,
  selectedRouteId,
  highlightedRouteId,
  cameraResetKey,
  ncpKeyId,
  vehiclePositions = [],
}: MapViewProps) {
  const normalizedNcpKeyId = ncpKeyId?.trim();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | undefined>(undefined);
  const routeOverlaysRef = useRef<NaverOverlay[]>([]);
  const vehicleOverlaysRef = useRef<NaverOverlay[]>([]);
  const lastCameraSignatureRef = useRef<string | undefined>(undefined);
  const cameraFitCountRef = useRef(0);
  const [status, setStatus] = useState<
    "missing" | "loading" | "ready" | "error"
  >(normalizedNcpKeyId === undefined || normalizedNcpKeyId.length === 0
    ? "missing"
    : "loading");
  const [reloadToken, setReloadToken] = useState(0);
  const selectedRoute =
    recommendations.find((route) => route.id === selectedRouteId) ??
    recommendations[0];
  const cameraSignature = useMemo(
    () =>
      JSON.stringify({
        cameraResetKey: cameraResetKey ?? null,
        reloadToken,
        routeId: selectedRoute?.id ?? null,
        origin: origin?.location ?? null,
        destination: destination?.location ?? null,
        coordinates:
          selectedRoute?.legs.flatMap((leg) => leg.coordinates) ?? [],
      }),
    [cameraResetKey, destination, origin, reloadToken, selectedRoute],
  );

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
      routeOverlaysRef.current.forEach(detachOverlay);
      vehicleOverlaysRef.current.forEach(detachOverlay);
      routeOverlaysRef.current = [];
      vehicleOverlaysRef.current = [];
      lastCameraSignatureRef.current = undefined;
      cameraFitCountRef.current = 0;
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
      routeOverlaysRef.current.forEach(detachOverlay);
      vehicleOverlaysRef.current.forEach(detachOverlay);
      routeOverlaysRef.current = [];
      vehicleOverlaysRef.current = [];
      lastCameraSignatureRef.current = undefined;
      cameraFitCountRef.current = 0;
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

    routeOverlaysRef.current.forEach(detachOverlay);
    const overlays: NaverOverlay[] = [];
    try {
      for (const recommendation of recommendations) {
        const selected = recommendation.id === selectedRoute?.id;
        const highlighted = recommendation.id === highlightedRouteId;
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
              strokeWeight: selected
                ? style.width
                : Math.max(3, style.width - 2),
              strokeColor: style.color,
              strokeOpacity: selected ? 0.95 : highlighted ? 0.55 : 0.18,
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
          | "destination"
          | "boarding"
          | "transfer"
          | "alighting";
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
        ...transitMarkers(selectedRoute),
      ];
      markerPoints.forEach((marker) => {
        const icon = createMarkerElement(marker.label, marker.tone, marker.title);
        overlays.push(
          new maps.Marker({
            map,
            position: new maps.LatLng(
              marker.coordinate.lat,
              marker.coordinate.lng,
            ),
            icon: {
              content: icon.element,
              size: { width: icon.width, height: icon.height },
              anchor: { x: icon.width / 2, y: icon.height },
            },
            title: marker.title ?? marker.label,
            clickable: false,
            zIndex: 30,
          }),
        );
      });
      routeOverlaysRef.current = overlays;
    } catch {
      overlays.forEach(detachOverlay);
      routeOverlaysRef.current = [];
      setStatus("error");
      return;
    }

    return () => {
      overlays.forEach(detachOverlay);
      if (routeOverlaysRef.current === overlays) {
        routeOverlaysRef.current = [];
      }
    };
  }, [
    destination,
    highlightedRouteId,
    origin,
    recommendations,
    selectedRoute,
    status,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = (window as NaverWindow).naver?.maps;
    if (status !== "ready" || map === undefined || !isNaverMapsApi(maps)) {
      return;
    }

    vehicleOverlaysRef.current.forEach(detachOverlay);
    const overlays: NaverOverlay[] = [];
    try {
      vehiclePositions.forEach((vehicle) => {
        const title = vehicleMarkerTitle(vehicle);
        const icon = createMarkerElement(vehicle.routeNo, "vehicle", title);
        overlays.push(
          new maps.Marker({
            map,
            position: new maps.LatLng(vehicle.latitude, vehicle.longitude),
            icon: {
              content: icon.element,
              size: { width: icon.width, height: icon.height },
              anchor: { x: icon.width / 2, y: icon.height },
            },
            title,
            clickable: false,
            zIndex: 35,
          }),
        );
      });
      vehicleOverlaysRef.current = overlays;
    } catch {
      overlays.forEach(detachOverlay);
      vehicleOverlaysRef.current = [];
      setStatus("error");
      return;
    }

    return () => {
      overlays.forEach(detachOverlay);
      if (vehicleOverlaysRef.current === overlays) {
        vehicleOverlaysRef.current = [];
      }
    };
  }, [status, vehiclePositions]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = (window as NaverWindow).naver?.maps;
    if (
      status !== "ready" ||
      map === undefined ||
      !isNaverMapsApi(maps) ||
      lastCameraSignatureRef.current === cameraSignature
    ) {
      return;
    }

    const visibleCoordinates = [
      ...(selectedRoute?.legs.flatMap((leg) => leg.coordinates) ?? []),
      ...(origin === undefined ? [] : [origin.location]),
      ...(destination === undefined ? [] : [destination.location]),
    ];
    try {
      if (visibleCoordinates.length >= 2) {
        const latitudes = visibleCoordinates.map((point) => point.lat);
        const longitudes = visibleCoordinates.map((point) => point.lng);
        map.fitBounds(
          new maps.LatLngBounds(
            new maps.LatLng(Math.min(...latitudes), Math.min(...longitudes)),
            new maps.LatLng(Math.max(...latitudes), Math.max(...longitudes)),
          ),
          { top: 54, right: 54, bottom: 54, left: 54, maxZoom: 16 },
        );
      } else if (visibleCoordinates[0] !== undefined) {
        map.setCenter(
          new maps.LatLng(
            visibleCoordinates[0].lat,
            visibleCoordinates[0].lng,
          ),
        );
        map.setZoom(15);
      }
      lastCameraSignatureRef.current = cameraSignature;
      cameraFitCountRef.current += 1;
      if (containerRef.current !== null) {
        containerRef.current.dataset.cameraFitCount = String(
          cameraFitCountRef.current,
        );
      }
    } catch {
      setStatus("error");
    }
  }, [cameraSignature, destination, origin, selectedRoute, status]);

  return (
    <section className="map-region" aria-label="경로 지도">
      <div
        ref={containerRef}
        className={`naver-map ${status === "ready" ? "" : "is-hidden"}`}
        aria-label="네이버 지도에 표시된 추천 경로"
        data-camera-fit-count="0"
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
            recommendations={recommendations}
            selectedRouteId={selectedRouteId}
            highlightedRouteId={highlightedRouteId}
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

      <div className="map-legend" aria-label="지도 경로 범례">
        <span><i className="legend-bus" />버스</span>
        <span><i className="legend-subway" />지하철</span>
        <span><i className="legend-walk" />도보</span>
      </div>
    </section>
  );
}
