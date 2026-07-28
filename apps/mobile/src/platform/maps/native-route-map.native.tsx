import type { Coordinate, RouteLeg } from "@chimap/contracts";
import {
  NaverMapMarkerOverlay,
  NaverMapPolylineOverlay,
  NaverMapView,
  type NaverMapViewRef,
} from "@mj-studio/react-native-naver-map";
import Constants from "expo-constants";
import {
  Component,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { chimapTheme } from "../../theme/chimap-theme";
import { dashedPolylineSegments } from "./dashed-polyline";
import type { NativeRouteMapProps } from "./map-contract";
import {
  deriveRouteMarkers,
  type RouteMarkerRole,
} from "./route-markers";

const defaultRegion = {
  latitude: 36.31,
  longitude: 127.32,
  latitudeDelta: 0.1,
  longitudeDelta: 0.13,
};

const endpointMarker = {
  anchor: { x: 0.5, y: 0.93 },
  height: 60,
  width: 50,
} as const;

const originMarkerImage = require("./assets/route-marker-origin.png");
const destinationMarkerImage = require("./assets/route-marker-destination.png");
const mapInitializationTimeoutMs = 10_000;

function MapFallback({ style }: Pick<NativeRouteMapProps, "style">) {
  return (
    <View style={[style, styles.mapFallback]}>
      <Text accessibilityRole="alert" style={styles.mapFallbackTitle}>
        지도를 불러오지 못했습니다
      </Text>
      <Text style={styles.mapFallbackBody}>
        추천 카드와 상세 이동 단계는 계속 확인할 수 있습니다.
      </Text>
    </View>
  );
}

class MapErrorBoundary extends Component<
  { children: ReactNode; style: NativeRouteMapProps["style"] },
  { failed: boolean }
> {
  public override state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override componentDidCatch(): void {
    console.error("[CHIMap map] code=MAP_RENDER_FAILED");
  }

  public override render(): ReactNode {
    return this.state.failed ? (
      <MapFallback style={this.props.style} />
    ) : (
      this.props.children
    );
  }
}

function trackGeometrySourcesUrl(): string {
  const baseUrl = Constants.expoConfig?.extra?.apiBaseUrl;
  return typeof baseUrl === "string" && baseUrl.length > 0
    ? `${baseUrl}/subway-track-sources.html`
    : "https://www.openstreetmap.org/copyright";
}

function nativeCoordinate(coordinate: Coordinate) {
  return { latitude: coordinate.lat, longitude: coordinate.lng };
}

function legColor(leg: RouteLeg): string {
  if (leg.mode === "BUS") {
    return chimapTheme.busBlue;
  }
  if (leg.mode === "SUBWAY") {
    return chimapTheme.purple;
  }
  return chimapTheme.orange;
}

function approximateColor(color: string): string {
  return /^#[0-9a-f]{6}$/iu.test(color) ? `${color}73` : color;
}

function routeRegion(coordinates: Coordinate[]) {
  if (coordinates.length === 0) {
    return defaultRegion;
  }
  const latitudes = coordinates.map((coordinate) => coordinate.lat);
  const longitudes = coordinates.map((coordinate) => coordinate.lng);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);
  const latitudePadding = Math.max(0.008, (maximumLatitude - minimumLatitude) * 0.18);
  const longitudePadding = Math.max(0.008, (maximumLongitude - minimumLongitude) * 0.18);
  return {
    latitude: minimumLatitude - latitudePadding,
    longitude: minimumLongitude - longitudePadding,
    latitudeDelta: maximumLatitude - minimumLatitude + latitudePadding * 2,
    longitudeDelta: maximumLongitude - minimumLongitude + longitudePadding * 2,
  };
}

function NativeRouteMapContent({
  origin,
  destination,
  route,
  vehiclePositions = [],
  viewportInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  userLocation = null,
  focusCoordinate = null,
  focusRequestId = 0,
  style,
}: NativeRouteMapProps) {
  const mapRef = useRef<NaverMapViewRef>(null);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [mapInitializationFailed, setMapInitializationFailed] = useState(false);
  const coordinates = useMemo(
    () => [
      ...(origin === null ? [] : [origin]),
      ...(route?.legs.flatMap((leg) => leg.coordinates) ?? []),
      ...(destination === null ? [] : [destination]),
    ],
    [destination, origin, route],
  );
  const region = useMemo(() => routeRegion(coordinates), [coordinates]);
  const routeMarkers = useMemo(
    () => deriveRouteMarkers(route?.legs ?? []),
    [route],
  );
  const hasSubway = route?.legs.some((leg) => leg.mode === "SUBWAY") === true;

  useEffect(() => {
    if (mapInitialized) {
      return;
    }
    const timeout = setTimeout(() => {
      setMapInitializationFailed(true);
      console.error("[CHIMap map] code=MAP_INITIALIZATION_TIMEOUT");
    }, mapInitializationTimeoutMs);
    return () => clearTimeout(timeout);
  }, [mapInitialized]);

  useEffect(() => {
    if (focusCoordinate === null || focusRequestId === 0) {
      return;
    }
    mapRef.current?.animateCameraTo({
      ...nativeCoordinate(focusCoordinate),
      duration: 420,
      easing: "EaseOut",
      zoom: 16,
    });
  }, [focusCoordinate, focusRequestId]);

  if (mapInitializationFailed) {
    return <MapFallback style={style} />;
  }

  return (
    <View style={style}>
      <NaverMapView
        animationDuration={450}
        isShowLocationButton={false}
        isShowZoomControls={false}
        layerGroups={{
          BUILDING: true,
          TRAFFIC: false,
          TRANSIT: true,
          BICYCLE: false,
          MOUNTAIN: false,
          CADASTRAL: false,
        }}
        locationOverlay={{
          isVisible: userLocation !== null,
          ...(userLocation === null
            ? {}
            : {
                position: nativeCoordinate(userLocation),
                circleColor: "rgba(0, 122, 255, 0.14)",
                circleOutlineColor: "rgba(0, 122, 255, 0.34)",
                circleRadius: 22,
              }),
        }}
        logoAlign="BottomLeft"
        logoMargin={{ bottom: 0, left: 4 }}
        mapPadding={viewportInsets}
        onInitialized={() => setMapInitialized(true)}
        ref={mapRef}
        region={region}
        style={StyleSheet.absoluteFill}
      >
        {route?.legs.map((leg) => {
          if (leg.coordinates.length < 2) {
            return null;
          }
          const approximate = leg.geometryQuality === "APPROXIMATE";
          const segments = approximate
            ? dashedPolylineSegments(leg.coordinates)
            : [leg.coordinates];
          return (
            <Fragment key={leg.id}>
              {segments.map((segment, index) => (
                <Fragment key={`${leg.id}:${index}`}>
                  {leg.isExerciseSegment ? (
                    <NaverMapPolylineOverlay
                      color={chimapTheme.exerciseHalo}
                      coords={segment.map(nativeCoordinate)}
                      width={12}
                      zIndex={9}
                    />
                  ) : null}
                  <NaverMapPolylineOverlay
                    color={
                      approximate
                        ? approximateColor(legColor(leg))
                        : legColor(leg)
                    }
                    coords={segment.map(nativeCoordinate)}
                    width={
                      leg.isExerciseSegment ? 8 : leg.mode === "WALK" ? 6 : 7
                    }
                    zIndex={10}
                  />
                </Fragment>
              ))}
            </Fragment>
          );
        })}
        {routeMarkers.map((marker) => (
          <NaverMapMarkerOverlay
            anchor={{ x: 0.5, y: 0.5 }}
            height={36}
            key={marker.id}
            latitude={marker.coordinate.lat}
            longitude={marker.coordinate.lng}
            width={36}
            zIndex={transitMarkerZIndex(marker.role)}
          >
            <View
              collapsable={false}
              style={[
                styles.transitMarker,
                marker.role === "TRANSFER" && styles.transferMarker,
                marker.role === "ALIGHT" && styles.alightMarker,
              ]}
            >
              <Text style={styles.transitMarkerText}>
                {marker.role === "BOARD"
                  ? "승"
                  : marker.role === "TRANSFER"
                    ? "환"
                    : "하"}
              </Text>
            </View>
          </NaverMapMarkerOverlay>
        ))}
        {vehiclePositions.map((vehicle) => (
          <NaverMapMarkerOverlay
            anchor={{ x: 0.5, y: 0.5 }}
            caption={{
              text:
                vehicle.displayReason === "ARRIVING_SOON"
                  ? `${vehicle.stopsUntilBoarding}정류장 전`
                  : "운행 중",
              color: chimapTheme.busBlue,
              haloColor: chimapTheme.white,
              textSize: 10,
              offset: 4,
            }}
            height={38}
            key={`${vehicle.cityCode}:${vehicle.routeId}:${vehicle.vehicleNo ?? vehicle.nodeOrder}`}
            latitude={vehicle.latitude}
            longitude={vehicle.longitude}
            width={38}
            zIndex={18}
          >
            <View collapsable={false} key={vehicle.routeNo} style={styles.vehicleMarker}>
              <Text numberOfLines={1} style={styles.vehicleMarkerText}>
                {vehicle.routeNo}
              </Text>
            </View>
          </NaverMapMarkerOverlay>
        ))}
        {origin === null ? null : (
          <NaverMapMarkerOverlay
            anchor={endpointMarker.anchor}
            height={endpointMarker.height}
            image={originMarkerImage}
            isForceShowIcon
            isHideCollidedSymbols
            {...nativeCoordinate(origin)}
            width={endpointMarker.width}
            zIndex={20}
          />
        )}
        {destination === null ? null : (
          <NaverMapMarkerOverlay
            anchor={endpointMarker.anchor}
            height={endpointMarker.height}
            image={destinationMarkerImage}
            isForceShowIcon
            isHideCollidedSymbols
            {...nativeCoordinate(destination)}
            width={endpointMarker.width}
            zIndex={21}
          />
        )}
      </NaverMapView>
      {hasSubway ? (
        <Pressable
          accessibilityHint="OpenStreetMap 선로 데이터 라이선스를 엽니다"
          accessibilityRole="link"
          hitSlop={18}
          onPress={() => void Linking.openURL(trackGeometrySourcesUrl())}
          style={[
            styles.attribution,
            { bottom: Math.max(6, viewportInsets.bottom + 6) },
          ]}
        >
          <Text style={styles.attributionText}>
            선로 데이터: © OpenStreetMap contributors 외
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function transitMarkerZIndex(role: RouteMarkerRole): number {
  if (role === "BOARD") return 14;
  if (role === "TRANSFER") return 15;
  return 16;
}

export function NativeRouteMap(props: NativeRouteMapProps) {
  return (
    <MapErrorBoundary style={props.style}>
      <NativeRouteMapContent {...props} />
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  mapFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 20,
    backgroundColor: chimapTheme.mapCanvas,
  },
  mapFallbackTitle: {
    color: chimapTheme.navy,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  mapFallbackBody: {
    color: chimapTheme.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  transitMarker: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 3,
    borderColor: chimapTheme.white,
    backgroundColor: chimapTheme.busBlue,
  },
  transferMarker: { backgroundColor: chimapTheme.purple },
  alightMarker: { backgroundColor: chimapTheme.orange },
  transitMarkerText: {
    color: chimapTheme.white,
    fontSize: 13,
    fontWeight: "900",
  },
  vehicleMarker: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    borderWidth: 3,
    borderColor: chimapTheme.white,
    backgroundColor: chimapTheme.busBlue,
  },
  vehicleMarkerText: { color: chimapTheme.white, fontSize: 9, fontWeight: "900" },
  attribution: {
    position: "absolute",
    right: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  attributionText: {
    color: chimapTheme.ink,
    fontSize: 9,
    fontWeight: "600",
  },
});
