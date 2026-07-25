import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMilliseconds: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebounced(value),
      delayMilliseconds,
    );
    return () => window.clearTimeout(timeout);
  }, [delayMilliseconds, value]);

  return debounced;
}
