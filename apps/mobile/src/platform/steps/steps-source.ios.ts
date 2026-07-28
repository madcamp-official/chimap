import {
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import { Linking } from "react-native";

import {
  startOfLocalDay,
  StepSourceError,
  type ReadTodayStepsOptions,
  type StepsSource,
  type StepSourceRecoveryAction,
} from "./steps-contract";

const stepType = "HKQuantityTypeIdentifierStepCount" as const;

export async function openStepRecovery(
  action: StepSourceRecoveryAction,
): Promise<void> {
  if (action === "OPEN_SETTINGS") {
    await Linking.openSettings();
  }
}

export class HealthKitStepsSource implements StepsSource {
  public async readTodaySteps(
    options: ReadTodayStepsOptions = {},
  ): Promise<number> {
    const now = options.now ?? new Date();
    try {
      if (!(await isHealthDataAvailable())) {
        throw new StepSourceError(
          "UNAVAILABLE",
          "HealthKit을 사용할 수 없습니다.",
          { recoveryAction: "RETRY" },
        );
      }
      if (options.requestPermission === true) {
        await requestAuthorization({ toRead: [stepType] });
      }
      const result = await queryStatisticsForQuantity(
        stepType,
        ["cumulativeSum"],
        {
          unit: "count",
          filter: {
            date: {
              startDate: startOfLocalDay(now),
              endDate: now,
              strictStartDate: true,
              strictEndDate: true,
            },
          },
        },
      );
      return Math.max(0, Math.round(result.sumQuantity?.quantity ?? 0));
    } catch (error) {
      if (error instanceof StepSourceError) {
        throw error;
      }
      throw new StepSourceError(
        "READ_FAILED",
        "HealthKit 걸음 수를 읽지 못했습니다.",
        { cause: error, recoveryAction: "RETRY" },
      );
    }
  }
}

export const stepsSource: StepsSource = new HealthKitStepsSource();
