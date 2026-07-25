import type {
  BusVehiclePosition,
  TransitBusLeg,
} from "@chimap/contracts";

type VehicleSelectionLeg = Pick<
  TransitBusLeg,
  | "cityCode"
  | "routeId"
  | "vehicleNo"
  | "boardingNodeOrder"
  | "alightingNodeOrder"
>;

export type RelevantVehiclePosition = BusVehiclePosition & {
  stopsUntilBoarding: number;
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
 * TAGO의 노선별 차량 API는 회차 구간을 포함한 전체 운행 차량을 반환한다.
 * 지도에는 선택한 각 버스 구간의 탑승 정류장에 가장 가까이 접근 중인 차량
 * 한 대만 남긴다. 정류장 순서를 알 수 없거나 이미 탑승 지점을 지난 차량은
 * 사용자에게 실제로 탈 차량이라는 근거가 없으므로 표시하지 않는다.
 */
export function selectRelevantVehiclePositions(
  busLegs: VehicleSelectionLeg[],
  vehicles: BusVehiclePosition[],
): RelevantVehiclePosition[] {
  const selected: RelevantVehiclePosition[] = [];
  const seenVehicles = new Set<string>();

  for (const leg of busLegs) {
    const approaching = vehicles
      .filter(
        (vehicle) =>
          vehicle.cityCode === leg.cityCode &&
          vehicle.routeId === leg.routeId &&
          vehicle.nodeOrder !== null &&
          vehicle.nodeOrder <= leg.boardingNodeOrder,
      )
      .sort((first, second) => {
        const firstExact =
          leg.vehicleNo !== null && first.vehicleNo === leg.vehicleNo;
        const secondExact =
          leg.vehicleNo !== null && second.vehicleNo === leg.vehicleNo;
        return (
          Number(secondExact) - Number(firstExact) ||
          (second.nodeOrder ?? -1) - (first.nodeOrder ?? -1) ||
          second.fetchedAt.localeCompare(first.fetchedAt)
        );
      });
    const nearest = approaching[0];
    if (nearest?.nodeOrder === null || nearest === undefined) {
      continue;
    }
    const identity = vehicleIdentity(nearest);
    if (seenVehicles.has(identity)) {
      continue;
    }
    seenVehicles.add(identity);
    selected.push({
      ...nearest,
      stopsUntilBoarding: leg.boardingNodeOrder - nearest.nodeOrder,
    });
  }

  return selected;
}
