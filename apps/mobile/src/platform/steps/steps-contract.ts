export type StepSourceErrorCode =
  | "UNAVAILABLE"
  | "PROVIDER_UPDATE_REQUIRED"
  | "PERMISSION_DENIED"
  | "READ_FAILED";

export type StepSourceRecoveryAction =
  | "OPEN_PROVIDER_UPDATE"
  | "OPEN_SETTINGS"
  | "RETRY";

export type StepSourceErrorOptions = ErrorOptions & {
  recoveryAction: StepSourceRecoveryAction;
};

export class StepSourceError extends Error {
  public readonly recoveryAction: StepSourceRecoveryAction;

  public constructor(
    public readonly code: StepSourceErrorCode,
    message: string,
    options: StepSourceErrorOptions,
  ) {
    super(message, { cause: options.cause });
    this.name = "StepSourceError";
    this.recoveryAction = options.recoveryAction;
  }
}

export function normalizeAggregatedSteps(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export type ReadTodayStepsOptions = {
  now?: Date;
  requestPermission?: boolean;
};

export interface StepsSource {
  readTodaySteps(options?: ReadTodayStepsOptions): Promise<number>;
}

export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
