import {
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";

import {
  startOfLocalDay,
  StepSourceError,
  sumStepRecords,
  type StepsSource,
} from "./steps-contract";

const stepPermission = { accessType: "read", recordType: "Steps" } as const;

export class HealthConnectStepsSource implements StepsSource {
  public async readTodaySteps(now = new Date()): Promise<number> {
    try {
      if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) {
        throw new StepSourceError(
          "UNAVAILABLE",
          "Health Connect를 사용할 수 없습니다.",
        );
      }
      if (!(await initialize())) {
        throw new StepSourceError("UNAVAILABLE", "Health Connect 초기화에 실패했습니다.");
      }
      const granted = await getGrantedPermissions();
      const hasStepRead = granted.some(
        (permission) =>
          permission.accessType === "read" && permission.recordType === "Steps",
      );
      if (!hasStepRead) {
        const requested = await requestPermission([stepPermission]);
        if (
          !requested.some(
            (permission) =>
              permission.accessType === "read" && permission.recordType === "Steps",
          )
        ) {
          throw new StepSourceError("PERMISSION_DENIED", "걸음 읽기 권한이 없습니다.");
        }
      }
      const response = await readRecords("Steps", {
        timeRangeFilter: {
          operator: "between",
          startTime: startOfLocalDay(now).toISOString(),
          endTime: now.toISOString(),
        },
      });
      // 연결된 데이터 생산 앱이 없으면 records는 빈 배열이며 정상 상태다.
      return sumStepRecords(response.records);
    } catch (error) {
      if (error instanceof StepSourceError) {
        throw error;
      }
      throw new StepSourceError(
        "READ_FAILED",
        "Health Connect 걸음 수를 읽지 못했습니다.",
        { cause: error },
      );
    }
  }
}

export const stepsSource: StepsSource = new HealthConnectStepsSource();
