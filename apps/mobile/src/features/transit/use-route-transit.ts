import {
  selectRelevantVehiclePositions,
  type RelevantVehiclePosition,
} from "@chimap/app-core";
import type { Recommendation, TransitBusLeg } from "@chimap/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getBusArrivals, getBusVehicles } from "./transit-api";
import { shouldPollRouteVehicles } from "./transit-polling-policy";

export function useRouteTransit(input: {
  apiBaseUrl: string;
  accessToken: string;
  route: Recommendation | null;
  pollingIntervalSeconds: number;
}): {
  vehiclePositions: RelevantVehiclePosition[];
  unavailable: boolean;
  stale: boolean;
} {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const busLegs = useMemo(
    () =>
      input.route?.legs.flatMap((leg) =>
        leg.mode === "BUS" && leg.bus !== undefined ? [leg.bus] : [],
      ) ?? [],
    [input.route],
  );
  const query = useQuery({
    queryKey: ["route-transit", input.route?.id ?? "none"],
    enabled: shouldPollRouteVehicles({ appActive: active, hasBusLeg: busLegs.length > 0 }),
    refetchInterval: shouldPollRouteVehicles({ appActive: active, hasBusLeg: busLegs.length > 0 })
      ? Math.max(5, input.pollingIntervalSeconds) * 1_000
      : false,
    staleTime: Math.max(5, input.pollingIntervalSeconds) * 1_000,
    queryFn: async ({ signal }) => {
      const routeKeys = new Map<string, TransitBusLeg>();
      const stopKeys = new Map<string, TransitBusLeg>();
      for (const leg of busLegs) {
        routeKeys.set(`${leg.cityCode}:${leg.routeId}`, leg);
        if (leg.boardingStop.nodeId !== null) {
          stopKeys.set(`${leg.cityCode}:${leg.boardingStop.nodeId}`, leg);
        }
      }
      const [vehicleResults, arrivalResults] = await Promise.all([
        Promise.allSettled(
          [...routeKeys.values()].map((leg) =>
            getBusVehicles({
              apiBaseUrl: input.apiBaseUrl,
              accessToken: input.accessToken,
              cityCode: leg.cityCode,
              routeId: leg.routeId,
              signal,
            }),
          ),
        ),
        Promise.allSettled(
          [...stopKeys.values()].map((leg) =>
            getBusArrivals({
              apiBaseUrl: input.apiBaseUrl,
              accessToken: input.accessToken,
              cityCode: leg.cityCode,
              nodeId: leg.boardingStop.nodeId!,
              signal,
            }),
          ),
        ),
      ]);
      const vehicles = vehicleResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value.items : [],
      );
      const arrivals = arrivalResults.flatMap((result) =>
        result.status === "fulfilled" ? result.value.items : [],
      );
      return {
        positions: selectRelevantVehiclePositions(busLegs, vehicles, arrivals),
        partial: [...vehicleResults, ...arrivalResults].some(
          (result) => result.status === "rejected",
        ),
      };
    },
  });
  return {
    vehiclePositions: query.data?.positions ?? [],
    unavailable: busLegs.length > 0 && query.isError,
    stale: query.data?.partial === true || query.isStale,
  };
}
