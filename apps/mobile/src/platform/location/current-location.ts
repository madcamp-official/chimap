import type { Coordinate } from "@chimap/contracts";
import * as Location from "expo-location";

export class CurrentLocationError extends Error {}

export async function requestCurrentLocation(): Promise<Coordinate> {
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new CurrentLocationError("기기의 위치 서비스를 켜 주세요.");
  }
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== Location.PermissionStatus.GRANTED) {
    throw new CurrentLocationError(
      "위치 권한을 허용하지 않아 주소 검색으로 계속합니다.",
    );
  }
  const result = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    lng: result.coords.longitude,
    lat: result.coords.latitude,
  };
}
