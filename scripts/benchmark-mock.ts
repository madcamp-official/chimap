import { createServer } from "node:http";
import { performance } from "node:perf_hooks";

import { createApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createLogger } from "../apps/api/src/logger.js";
import { MockMobilityProvider } from "../apps/api/src/test-fixtures/mock-provider.js";

const config = loadConfig({
  NODE_ENV: "test",
  KAKAO_MODE: "mock",
  LOG_LEVEL: "silent",
});
const app = createApp({
  config,
  logger: createLogger(config),
  provider: new MockMobilityProvider(),
  rateLimits: {
    placesMax: 1_000,
    recommendationsMax: 1_000,
    windowMs: 60_000,
  },
});
const server = createServer(app);

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (address === null || typeof address === "string") {
  throw new Error("벤치마크 서버 포트를 확인하지 못했습니다.");
}

const input = {
  origin: {
    id: "kaist",
    name: "한국과학기술원 KAIST",
    address: "대전 유성구 구성동 23",
    roadAddress: "대전 유성구 대학로 291",
    category: "교육 > 대학교",
    location: { lng: 127.3604, lat: 36.3723 },
  },
  destination: {
    id: "daejeon-station",
    name: "대전역",
    address: "대전 동구 정동 1-1",
    roadAddress: "대전 동구 중앙로 215",
    category: "교통 > 기차역",
    location: { lng: 127.4342, lat: 36.3321 },
  },
  deadline: new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString(),
  currentSteps: 5_200,
  goalSteps: 8_000,
  maxExtraMinutes: 25,
  strideLengthMeters: 0.7,
  safetyBufferMinutes: 3,
};
const endpoint = `http://127.0.0.1:${address.port}/api/v1/recommendations`;

async function measure(): Promise<{
  durationMs: number;
  responseBytes: number;
}> {
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`벤치마크 요청 실패: HTTP ${response.status}`);
  }
  return {
    durationMs: performance.now() - startedAt,
    responseBytes: body.byteLength,
  };
}

try {
  for (let index = 0; index < 5; index += 1) {
    await measure();
  }

  const samples: Array<{
    durationMs: number;
    responseBytes: number;
  }> = [];
  for (let index = 0; index < 50; index += 1) {
    samples.push(await measure());
  }

  const durations = samples
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const percentile = (value: number): number =>
    durations[Math.ceil((value / 100) * durations.length) - 1]!;
  const result = {
    requests: samples.length,
    p50Ms: Number(percentile(50).toFixed(2)),
    p95Ms: Number(percentile(95).toFixed(2)),
    maxMs: Number(durations.at(-1)!.toFixed(2)),
    maxResponseBytes: Math.max(
      ...samples.map((sample) => sample.responseBytes),
    ),
    thresholdMs: 500,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.p95Ms > result.thresholdMs) {
    process.exitCode = 1;
  }
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
