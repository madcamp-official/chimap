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
        "NAVER_MAP_NCP_KEY",
        "DATABASE_URL",
      ],
      censor: "[REDACTED]",
    },
    base: {
      service: "chimap-api",
    },
    ...(config.nodeEnv === "test" ? { enabled: false } : {}),
  });
}
