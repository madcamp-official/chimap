export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted === true) {
    controller.abort();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
