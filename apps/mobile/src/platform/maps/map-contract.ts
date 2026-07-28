import type { RelevantVehiclePosition } from "@chimap/app-core";
import type { Coordinate, Recommendation } from "@chimap/contracts";
import type { StyleProp, ViewStyle } from "react-native";

export type NativeRouteMapProps = {
  origin: Coordinate | null;
  destination: Coordinate | null;
  route: Recommendation | null;
  vehiclePositions?: RelevantVehiclePosition[];
  viewportInsets?: { top: number; right: number; bottom: number; left: number };
  userLocation?: Coordinate | null;
  focusCoordinate?: Coordinate | null;
  focusRequestId?: number;
  style?: StyleProp<ViewStyle>;
};
