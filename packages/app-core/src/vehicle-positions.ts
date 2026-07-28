import type {
  BusArrival,
  BusVehiclePosition,
  TransitBusLeg,
} from "@chimap/contracts";

type VehicleSelectionLeg = Pick<
  TransitBusLeg,
  | "cityCode"
  | "routeId"
  | "vehicleNo"
  | "boardingStop"
  | "boardingNodeOrder"
  | "alightingNodeOrder"
>;

export type RelevantVehiclePosition = BusVehiclePosition & {
  stopsUntilBoarding: number;
  stopsUntilAlighting: number;
  displayReason: "ARRIVING_SOON" | "JUST_PASSED";
  arrivalSeconds: number | null;
};

function vehicleIdentity(vehicle: BusVehiclePosition): string {
  return [
    vehicle.cityCode,
    vehicle.routeId,
    vehicle.vehicleNo ??
      `${vehicle.nodeOrder ?? "unknown"}:${vehicle.latitude}:${vehicle.longitude}`,
  ].join(":");
}

/**
 * TAGO 도착 응답에는 차량번호가 없으므로 ETA가 10분 이하일 때 승차 정류장
 * 직전의 가장 가까운 차량을 근사한다. 노선별로 접근 중/방금 지난 차량을
 * 각각 최대 한 대만 선택해 지도의 정보 밀도를 제한한다.
 */
export function selectRelevantVehiclePositions(
  busLegs: VehicleSelectionLeg[],
  vehicles: BusVehiclePosition[],
  arrivals: BusArrival[] = [],
): RelevantVehiclePosition[] {
  const legsByRoute = new Map<string, VehicleSelectionLeg[]>();
  for (const leg of busLegs) {
    const key = `${leg.cityCode}:${leg.routeId}`;
    legsByRoute.set(key, [...(legsByRoute.get(key) ?? []), leg]);
  }

  const selected: RelevantVehiclePosition[] = [];
  for (const [routeKey, routeLegs] of legsByRoute) {
    const [cityCode, routeId] = routeKey.split(":", 2) as [string, string];
    const routeVehicles = vehicles.filter(
      (vehicle) => vehicle.cityCode === cityCode && vehicle.routeId === routeId,
    );
    const approaching = routeLegs
      .flatMap((leg) => {
        const earliestArrival = arrivals
          .filter(
            (arrival) =>
              arrival.cityCode === leg.cityCode &&
              arrival.routeId === leg.routeId &&
              arrival.nodeId === leg.boardingStop.nodeId &&
              arrival.arrivalSeconds <= 600,
          )
          .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds)[0];
        if (earliestArrival === undefined) return [];
        const vehicle = routeVehicles
          .filter(
            (candidate) =>
              candidate.nodeOrder !== null &&
              candidate.nodeOrder < leg.boardingNodeOrder,
          )
          .sort(
            (a, b) =>
              (b.nodeOrder ?? -1) - (a.nodeOrder ?? -1) ||
              b.fetchedAt.localeCompare(a.fetchedAt),
          )[0];
        if (vehicle === undefined || vehicle.nodeOrder === null) return [];
        return [{
          ...vehicle,
          stopsUntilBoarding: leg.boardingNodeOrder - vehicle.nodeOrder,
          stopsUntilAlighting: Math.max(0, leg.alightingNodeOrder - vehicle.nodeOrder),
          displayReason: "ARRIVING_SOON" as const,
          arrivalSeconds: earliestArrival.arrivalSeconds,
        }];
      })
      .sort(
        (a, b) =>
          a.stopsUntilBoarding - b.stopsUntilBoarding ||
          (a.arrivalSeconds ?? Infinity) - (b.arrivalSeconds ?? Infinity) ||
          b.fetchedAt.localeCompare(a.fetchedAt),
      )[0];
    if (approaching !== undefined) selected.push(approaching);

    const justPassed = routeLegs
      .flatMap((leg) =>
        routeVehicles
          .filter(
            (vehicle) =>
              vehicle.nodeOrder !== null &&
              vehicle.nodeOrder >= leg.boardingNodeOrder &&
              vehicle.nodeOrder <= leg.alightingNodeOrder,
          )
          .map((vehicle) => ({ vehicle, leg })),
      )
      .sort(
        (a, b) =>
          (a.vehicle.nodeOrder! - a.leg.boardingNodeOrder) -
            (b.vehicle.nodeOrder! - b.leg.boardingNodeOrder) ||
          b.vehicle.fetchedAt.localeCompare(a.vehicle.fetchedAt),
      )[0];
    if (
      justPassed !== undefined &&
      justPassed.vehicle.nodeOrder !== null &&
      vehicleIdentity(justPassed.vehicle) !==
        (approaching === undefined ? undefined : vehicleIdentity(approaching))
    ) {
      selected.push({
        ...justPassed.vehicle,
        stopsUntilBoarding: 0,
        stopsUntilAlighting: Math.max(
          0,
          justPassed.leg.alightingNodeOrder - justPassed.vehicle.nodeOrder,
        ),
        displayReason: "JUST_PASSED",
        arrivalSeconds: null,
      });
    }
  }
  return selected;
}
