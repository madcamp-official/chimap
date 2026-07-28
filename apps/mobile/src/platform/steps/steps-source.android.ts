import {
  aggregateRecord,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  requestPermission as requestHealthPermission,
  SdkAvailabilityStatus,
} from "react-native-health-connect";
import { Linking } from "react-native";

import {
  normalizeAggregatedSteps,
  startOfLocalDay,
  StepSourceError,
  type ReadTodayStepsOptions,
  type StepsSource,
  type StepSourceRecoveryAction,
} from "./steps-contract";

const stepPermission = { accessType: "read", recordType: "Steps" } as const;
const healthConnectPlayUrl =
  "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";
const healthConnectMarketUrl =
  "market://details?id=com.google.android.apps.healthdata";

function hasStepReadPermission(
  permissions: readonly {
    accessType?: unknown;
    recordType?: unknown;
  }[],
): boolean {
  return permissions.some(
    (permission) =>
      permission.accessType === "read" && permission.recordType === "Steps",
  );
}

export async function openStepRecovery(
  action: StepSourceRecoveryAction,
): Promise<void> {
  if (action === "OPEN_PROVIDER_UPDATE") {
    try {
      await Linking.openURL(healthConnectMarketUrl);
    } catch {
      await Linking.openURL(healthConnectPlayUrl);
    }
    return;
  }
  if (action === "OPEN_SETTINGS") {
    openHealthConnectSettings();
  }
}

export class HealthConnectStepsSource implements StepsSource {
  public async readTodaySteps(
    options: ReadTodayStepsOptions = {},
  ): Promise<number> {
    const now = options.now ?? new Date();
    try {
      const sdkStatus = await getSdkStatus();
      if (
        sdkStatus ===
        SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
      ) {
        throw new StepSourceError(
          "PROVIDER_UPDATE_REQUIRED",
          "Health Connect 업데이트가 필요합니다.",
          { recoveryAction: "OPEN_PROVIDER_UPDATE" },
        );
      }
      if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
        throw new StepSourceError(
          "UNAVAILABLE",
          "Health Connect를 사용할 수 없습니다.",
          { recoveryAction: "RETRY" },
        );
      }
      if (!(await initialize())) {
        throw new StepSourceError(
          "UNAVAILABLE",
          "Health Connect 초기화에 실패했습니다.",
          { recoveryAction: "RETRY" },
        );
      }
      const granted = await getGrantedPermissions();
      let hasStepRead = hasStepReadPermission(granted);
      if (!hasStepRead && options.requestPermission === true) {
        hasStepRead = hasStepReadPermission(
          await requestHealthPermission([stepPermission]),
        );
      }
      if (!hasStepRead) {
        throw new StepSourceError(
          "PERMISSION_DENIED",
          "걸음 읽기 권한이 없습니다.",
          { recoveryAction: "OPEN_SETTINGS" },
        );
      }
      const response = await aggregateRecord({
        recordType: "Steps",
        timeRangeFilter: {
          operator: "between",
          startTime: startOfLocalDay(now).toISOString(),
          endTime: now.toISOString(),
        },
      });
      return normalizeAggregatedSteps(response.COUNT_TOTAL);
    } catch (error) {
      if (error instanceof StepSourceError) {
        throw error;
      }
      throw new StepSourceError(
        "READ_FAILED",
        "Health Connect 걸음 수를 읽지 못했습니다.",
        { cause: error, recoveryAction: "RETRY" },
      );
    }
  }
}

export const stepsSource: StepsSource = new HealthConnectStepsSource();
