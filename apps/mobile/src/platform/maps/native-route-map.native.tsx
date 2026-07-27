import type { Coordinate, RouteLeg } from "@chimap/contracts";
import {
  NaverMapMarkerOverlay,
  NaverMapPolylineOverlay,
  NaverMapView,
} from "@mj-studio/react-native-naver-map";
import { useMemo } from "react";

import { chimapTheme } from "../../theme/chimap-theme";
import type { NativeRouteMapProps } from "./map-contract";

const defaultRegion = {
  latitude: 36.31,
  longitude: 127.32,
  latitudeDelta: 0.1,
  longitudeDelta: 0.13,
};

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

  return (
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
      style={style}
    >
      {route?.legs.map((leg) =>
        leg.coordinates.length < 2 ? null : (
          <NaverMapPolylineOverlay
            color={legColor(leg)}
            coords={leg.coordinates.map(nativeCoordinate)}
            key={leg.id}
            width={leg.mode === "WALK" ? 6 : 7}
            zIndex={10}
          />
        ),
      )}
      {origin === null ? null : (
        <NaverMapMarkerOverlay
          caption={{ text: "출발", color: chimapTheme.navyStrong, textSize: 11 }}
          image={{ symbol: "blue" }}
          {...nativeCoordinate(origin)}
          zIndex={20}
        />
      )}
      {destination === null ? null : (
        <NaverMapMarkerOverlay
          caption={{ text: "도착", color: chimapTheme.navyStrong, textSize: 11 }}
          image={{ symbol: "green" }}
          {...nativeCoordinate(destination)}
          zIndex={20}
        />
      )}
    </NaverMapView>
  );
}
