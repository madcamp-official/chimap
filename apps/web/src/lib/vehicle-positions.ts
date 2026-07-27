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
  displayReason: "ARRIVING_SOON" | "ON_ROUTE";
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
 * 차량을 도착 예정 차량으로 근사하고, 승차~하차 구간을 운행 중인 차량은
 * 별도로 모두 표시한다.
 */
export function selectRelevantVehiclePositions(
  busLegs: VehicleSelectionLeg[],
  vehicles: BusVehiclePosition[],
  arrivals: BusArrival[] = [],
): RelevantVehiclePosition[] {
  const selected = new Map<string, RelevantVehiclePosition>();

  const addVehicle = (
    vehicle: BusVehiclePosition,
    leg: VehicleSelectionLeg,
    displayReason: RelevantVehiclePosition["displayReason"],
    arrivalSeconds: number | null,
  ) => {
    if (vehicle.nodeOrder === null) {
      return;
    }
    const identity = vehicleIdentity(vehicle);
    const candidate: RelevantVehiclePosition = {
      ...vehicle,
      stopsUntilBoarding: Math.max(
        0,
        leg.boardingNodeOrder - vehicle.nodeOrder,
      ),
      stopsUntilAlighting: Math.max(
        0,
        leg.alightingNodeOrder - vehicle.nodeOrder,
      ),
      displayReason,
      arrivalSeconds,
    };
    const existing = selected.get(identity);
    if (
      existing === undefined ||
      (existing.displayReason === "ARRIVING_SOON" &&
        displayReason === "ON_ROUTE")
    ) {
      selected.set(identity, candidate);
    }
  };

  for (const leg of busLegs) {
    const routeVehicles = vehicles.filter(
      (vehicle) =>
        vehicle.cityCode === leg.cityCode && vehicle.routeId === leg.routeId,
    );
    const earliestArrival = arrivals
      .filter(
        (arrival) =>
          arrival.cityCode === leg.cityCode &&
          arrival.routeId === leg.routeId &&
          arrival.nodeId === leg.boardingStop.nodeId,
      )
      .sort((first, second) => first.arrivalSeconds - second.arrivalSeconds)[0];

    if (earliestArrival !== undefined && earliestArrival.arrivalSeconds <= 600) {
      const nearestApproaching = routeVehicles
      .filter(
        (vehicle) =>
          vehicle.nodeOrder !== null &&
          vehicle.nodeOrder < leg.boardingNodeOrder,
      )
        .sort(
          (first, second) =>
            (second.nodeOrder ?? -1) - (first.nodeOrder ?? -1) ||
            second.fetchedAt.localeCompare(first.fetchedAt),
        )[0];
      if (nearestApproaching !== undefined) {
        addVehicle(
          nearestApproaching,
          leg,
          "ARRIVING_SOON",
          earliestArrival.arrivalSeconds,
        );
      }
    }

    routeVehicles
      .filter(
        (vehicle) =>
          vehicle.nodeOrder !== null &&
          vehicle.nodeOrder >= leg.boardingNodeOrder &&
          vehicle.nodeOrder <= leg.alightingNodeOrder,
      )
      .forEach((vehicle) => addVehicle(vehicle, leg, "ON_ROUTE", null));
  }

  return [...selected.values()];
}
