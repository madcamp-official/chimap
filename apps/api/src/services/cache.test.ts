import { describe, expect, it, vi } from "vitest";

import { MemoryCache } from "./cache.js";

describe("MemoryCache", () => {
  it("동일 cache miss를 single-flight로 한 번만 불러온다", async () => {
    const cache = new MemoryCache(1024);
    const loader = vi.fn(async () => {
      await Promise.resolve();
      return { routeId: "shared" };
    });

    const [first, second, third] = await Promise.all([
      cache.getOrLoad("route", 1000, loader),
      cache.getOrLoad("route", 1000, loader),
      cache.getOrLoad("route", 1000, loader),
    ]);

    expect(loader).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(await cache.getOrLoad("route", 1000, loader)).toBe(first);
  });

  it("실패한 loader를 고정하지 않고 다음 요청이 재시도하게 한다", async () => {
    const cache = new MemoryCache(1024);
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.getOrLoad("route", 1000, loader)).rejects.toThrow(
      "temporary",
    );
    await expect(cache.getOrLoad("route", 1000, loader)).resolves.toBe(
      "recovered",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("TTL이 지나면 값을 다시 불러온다", async () => {
    const cache = new MemoryCache(1024);
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    await expect(cache.getOrLoad("ttl", 5, loader)).resolves.toBe(
      "first",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(cache.getOrLoad("ttl", 5, loader)).resolves.toBe(
      "second",
    );
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
