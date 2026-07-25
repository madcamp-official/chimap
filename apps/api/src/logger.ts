import pino, { type Logger } from "pino";

import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "authorization",
        "KAKAO_REST_API_KEY",
      ],
      censor: "[REDACTED]",
    },
    base: {
      service: "chimap-api",
      mode: config.kakaoMode,
    },
    ...(config.nodeEnv === "test" ? { enabled: false } : {}),
  });
}
