import type { Coordinate } from "@chimap/contracts";
import type { StyleProp, ViewStyle } from "react-native";

export type NativeRouteMapProps = {
  coordinates: Coordinate[];
  color: string;
  style?: StyleProp<ViewStyle>;
};
