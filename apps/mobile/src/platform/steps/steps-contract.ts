export type StepSourceErrorCode =
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "READ_FAILED";

export class StepSourceError extends Error {
  public constructor(
    public readonly code: StepSourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StepSourceError";
  }
}

export type StepRecord = { count?: number | null };

export function sumStepRecords(
  records: readonly StepRecord[] | null | undefined,
): number {
  if (records === null || records === undefined || records.length === 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.round(
      records.reduce(
        (total, record) =>
          total +
          (typeof record.count === "number" && Number.isFinite(record.count)
            ? record.count
            : 0),
        0,
      ),
    ),
  );
}

export interface StepsSource {
  readTodaySteps(now?: Date): Promise<number>;
}

export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
