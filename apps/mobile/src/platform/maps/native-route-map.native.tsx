import type { Coordinate, RouteLeg } from "@chimap/contracts";
import {
  NaverMapMarkerOverlay,
  NaverMapPolylineOverlay,
  NaverMapView,
  type NaverMapViewRef,
} from "@mj-studio/react-native-naver-map";
import Constants from "expo-constants";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { chimapTheme } from "../../theme/chimap-theme";
import { dashedPolylineSegments } from "./dashed-polyline";
import type { NativeRouteMapProps } from "./map-contract";

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

export function NativeRouteMap({
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
  const coordinates = useMemo(
    () => [
      ...(origin === null ? [] : [origin]),
      ...(route?.legs.flatMap((leg) => leg.coordinates) ?? []),
      ...(destination === null ? [] : [destination]),
    ],
    [destination, origin, route],
  );
  const region = useMemo(() => routeRegion(coordinates), [coordinates]);
  const hasSubway = route?.legs.some((leg) => leg.mode === "SUBWAY") === true;

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

const styles = StyleSheet.create({
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
