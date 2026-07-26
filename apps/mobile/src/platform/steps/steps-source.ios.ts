import {
  isHealthDataAvailable,
  queryStatisticsForQuantity,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";

import {
  startOfLocalDay,
  StepSourceError,
  type StepsSource,
} from "./steps-contract";

const stepType = "HKQuantityTypeIdentifierStepCount" as const;

export class HealthKitStepsSource implements StepsSource {
  public async readTodaySteps(now = new Date()): Promise<number> {
    try {
      if (!(await isHealthDataAvailable())) {
        throw new StepSourceError("UNAVAILABLE", "HealthKit을 사용할 수 없습니다.");
      }
      await requestAuthorization({ toRead: [stepType] });
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
      throw new StepSourceError("READ_FAILED", "HealthKit 걸음 수를 읽지 못했습니다.", {
        cause: error,
      });
    }
  }
}

export const stepsSource: StepsSource = new HealthKitStepsSource();
