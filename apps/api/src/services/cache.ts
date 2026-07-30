import type { Coordinate } from "@chimap/contracts";
import { LRUCache } from "lru-cache";

const MEBIBYTE = 1024 * 1024;

type CacheItem = {
  value: unknown;
};

export function waitForSharedLoad<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return pending;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(
        signal.reason ??
          new DOMException("요청이 취소되었습니다.", "AbortError"),
      );
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function approximateSize(item: CacheItem): number {
  try {
    return Math.max(1, Buffer.byteLength(JSON.stringify(item.value)));
  } catch {
    return 1;
  }
}

export class MemoryCache {
  readonly #cache: LRUCache<string, CacheItem>;
  readonly #inFlight = new Map<string, Promise<unknown>>();

  public constructor(maxSizeBytes = 128 * MEBIBYTE) {
    this.#cache = new LRUCache<string, CacheItem>({
      maxSize: maxSizeBytes,
      sizeCalculation: approximateSize,
    });
  }

  public get<T>(key: string): T | undefined {
    return this.#cache.get(key)?.value as T | undefined;
  }

  public getLoadState(key: string): "FRESH" | "SHARED" | "MISS" {
    if (this.get(key) !== undefined) return "FRESH";
    return this.#inFlight.has(key) ? "SHARED" : "MISS";
  }

  public set<T>(key: string, value: T, ttlMilliseconds: number): void {
    this.#cache.set(key, { value }, { ttl: ttlMilliseconds });
  }

  public async getOrLoad<T>(
    key: string,
    ttlMilliseconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    const existing = this.#inFlight.get(key) as Promise<T> | undefined;
    if (existing !== undefined) {
      return existing;
    }

    const pending = loader()
      .then((value) => {
        this.set(key, value, ttlMilliseconds);
        return value;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });

    this.#inFlight.set(key, pending);
    return pending;
  }

  public async getOrLoadWithTtl<T>(
    key: string,
    loader: () => Promise<{ value: T; ttlMilliseconds: number }>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const existing = this.#inFlight.get(key) as Promise<T> | undefined;
    if (existing !== undefined) {
      return existing;
    }
    const pending = loader()
      .then(({ value, ttlMilliseconds }) => {
        this.set(key, value, ttlMilliseconds);
        return value;
      })
      .finally(() => {
        this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, pending);
    return pending;
  }

  public clear(): void {
    this.#cache.clear();
    this.#inFlight.clear();
  }
}

export function coordinateCacheKey(coordinate: Coordinate): string {
  return `${coordinate.lng.toFixed(5)},${coordinate.lat.toFixed(5)}`;
}

export function normalizeSearchTerm(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function fiveMinuteBucket(epochMilliseconds = Date.now()): number {
  return Math.floor(epochMilliseconds / 300_000);
}
