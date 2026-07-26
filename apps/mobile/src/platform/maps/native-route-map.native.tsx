import {
  NaverMapPathOverlay,
  NaverMapView,
} from "@mj-studio/react-native-naver-map";

import type { NativeRouteMapProps } from "./map-contract";

export function NativeRouteMap({
  coordinates,
  color,
  style,
}: NativeRouteMapProps) {
  const first = coordinates[0];
  if (first === undefined) {
    return null;
  }
  return (
    <NaverMapView
      style={style}
      initialCamera={{ latitude: first.lat, longitude: first.lng, zoom: 14 }}
    >
      {coordinates.length < 2 ? null : (
        <NaverMapPathOverlay
          coords={coordinates.map(({ lat, lng }) => ({
            latitude: lat,
            longitude: lng,
          }))}
          color={color}
          width={6}
          outlineColor="#FFFFFF"
          outlineWidth={2}
        />
      )}
    </NaverMapView>
  );
}
