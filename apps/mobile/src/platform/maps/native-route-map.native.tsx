import type { Coordinate, RouteLeg } from "@chimap/contracts";
import {
  NaverMapMarkerOverlay,
  NaverMapPolylineOverlay,
  NaverMapView,
} from "@mj-studio/react-native-naver-map";
import Constants from "expo-constants";
import { Fragment, useMemo } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { chimapTheme } from "../../theme/chimap-theme";
import type { NativeRouteMapProps } from "./map-contract";
import { dashedPolylineSegments } from "./dashed-polyline";

const defaultRegion = {
  latitude: 36.31,
  longitude: 127.32,
  latitudeDelta: 0.1,
  longitudeDelta: 0.13,
};

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
  style,
}: NativeRouteMapProps) {
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

  return (
    <View style={style}>
      <NaverMapView
        animationDuration={450}
        layerGroups={{
          BUILDING: true,
          TRAFFIC: false,
          TRANSIT: true,
          BICYCLE: false,
          MOUNTAIN: false,
          CADASTRAL: false,
        }}
        region={region}
        style={StyleSheet.absoluteFill}
      >
        {route?.legs.map((leg) => {
          if (leg.coordinates.length < 2) return null;
          const approximate = leg.geometryQuality === "APPROXIMATE";
          const segments = approximate
            ? dashedPolylineSegments(leg.coordinates)
            : [leg.coordinates];
          return (
            <Fragment key={leg.id}>
              {segments.map((segment, index) => (
                <NaverMapPolylineOverlay
                  color={approximate ? approximateColor(legColor(leg)) : legColor(leg)}
                  coords={segment.map(nativeCoordinate)}
                  key={`${leg.id}:${index}`}
                  width={leg.mode === "WALK" ? 6 : 7}
                  zIndex={10}
                />
              ))}
            </Fragment>
          );
        })}
        {origin === null ? null : (
          <NaverMapMarkerOverlay
            caption={{
              text: "출발",
              color: chimapTheme.navyStrong,
              textSize: 11,
            }}
            image={{ symbol: "blue" }}
            {...nativeCoordinate(origin)}
            zIndex={20}
          />
        )}
        {destination === null ? null : (
          <NaverMapMarkerOverlay
            caption={{
              text: "도착",
              color: chimapTheme.navyStrong,
              textSize: 11,
            }}
            image={{ symbol: "green" }}
            {...nativeCoordinate(destination)}
            zIndex={20}
          />
        )}
      </NaverMapView>
      {hasSubway ? (
        <Pressable
          accessibilityHint="OpenStreetMap 선로 데이터 라이선스를 엽니다"
          accessibilityRole="link"
          onPress={() => void Linking.openURL(trackGeometrySourcesUrl())}
          style={styles.attribution}
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
  attribution: {
    position: "absolute",
    right: 6,
    bottom: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  attributionText: {
    color: "#293241",
    fontSize: 9,
    fontWeight: "600",
  },
});
