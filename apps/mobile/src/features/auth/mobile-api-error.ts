export class MobileApiError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}
