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
 * TAGO 도착 응답에는 차량번호가 없으므로 가장 빠른 도착 응답과 개별 차량을
 * 직접 연결할 수 없다. ETA가 10분 이하이면 승차 정류장 직전의 가장 가까운
 * 차량을 도착 예정 차량으로 근사한다. 같은 노선에서 승차 정류장을 지난
 * 차량은 승차~하차 구간 중 승차 지점에 가장 가까운 한 대만 선택한다.
 * 따라서 노선별로 "오고 있는 차량"과 "방금 지난 차량"을 최대 한 대씩,
 * 합계 두 대까지만 표시한다.
 */
export function selectRelevantVehiclePositions(
  busLegs: VehicleSelectionLeg[],
  vehicles: BusVehiclePosition[],
  arrivals: BusArrival[] = [],
): RelevantVehiclePosition[] {
  const legsByRoute = new Map<string, VehicleSelectionLeg[]>();
  for (const leg of busLegs) {
    const key = `${leg.cityCode}:${leg.routeId}`;
    const routeLegs = legsByRoute.get(key) ?? [];
    routeLegs.push(leg);
    legsByRoute.set(key, routeLegs);
  }

  const selected: RelevantVehiclePosition[] = [];
  for (const [routeKey, routeLegs] of legsByRoute) {
    const [cityCode, routeId] = routeKey.split(":", 2) as [string, string];
    const routeVehicles = vehicles.filter(
      (vehicle) =>
        vehicle.cityCode === cityCode && vehicle.routeId === routeId,
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
          .sort(
            (first, second) =>
              first.arrivalSeconds - second.arrivalSeconds,
          )[0];
        if (earliestArrival === undefined) {
          return [];
        }
        const vehicle = routeVehicles
          .filter(
            (candidate) =>
              candidate.nodeOrder !== null &&
              candidate.nodeOrder < leg.boardingNodeOrder,
          )
          .sort(
            (first, second) =>
              (second.nodeOrder ?? -1) - (first.nodeOrder ?? -1) ||
              second.fetchedAt.localeCompare(first.fetchedAt),
          )[0];
        if (vehicle?.nodeOrder === null || vehicle === undefined) {
          return [];
        }
        return [{
          ...vehicle,
          stopsUntilBoarding: leg.boardingNodeOrder - vehicle.nodeOrder,
          stopsUntilAlighting: Math.max(
            0,
            leg.alightingNodeOrder - vehicle.nodeOrder,
          ),
          displayReason: "ARRIVING_SOON" as const,
          arrivalSeconds: earliestArrival.arrivalSeconds,
        }];
      })
      .sort(
        (first, second) =>
          first.stopsUntilBoarding - second.stopsUntilBoarding ||
          (first.arrivalSeconds ?? Infinity) -
            (second.arrivalSeconds ?? Infinity) ||
          second.fetchedAt.localeCompare(first.fetchedAt),
      )[0];
    if (approaching !== undefined) {
      selected.push(approaching);
    }

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
        (first, second) =>
          (first.vehicle.nodeOrder! - first.leg.boardingNodeOrder) -
            (second.vehicle.nodeOrder! - second.leg.boardingNodeOrder) ||
          second.vehicle.fetchedAt.localeCompare(first.vehicle.fetchedAt),
      )[0];
    if (
      justPassed?.vehicle.nodeOrder !== null &&
      justPassed !== undefined &&
      vehicleIdentity(justPassed.vehicle) !==
        (approaching === undefined ? undefined : vehicleIdentity(approaching))
    ) {
      selected.push({
        ...justPassed.vehicle,
        stopsUntilBoarding: 0,
        stopsUntilAlighting: Math.max(
          0,
          justPassed.leg.alightingNodeOrder -
            justPassed.vehicle.nodeOrder,
        ),
        displayReason: "JUST_PASSED",
        arrivalSeconds: null,
      });
    }
  }

  return selected;
}
