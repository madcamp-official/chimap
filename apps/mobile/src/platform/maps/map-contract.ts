import type { Coordinate, Recommendation } from "@chimap/contracts";
import type { StyleProp, ViewStyle } from "react-native";

export type NativeRouteMapProps = {
  origin: Coordinate | null;
  destination: Coordinate | null;
  route: Recommendation | null;
  style?: StyleProp<ViewStyle>;
};
