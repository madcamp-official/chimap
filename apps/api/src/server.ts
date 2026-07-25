import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import type { TransitService } from "./transit/transit-service.js";

try {
  process.loadEnvFile(
    fileURLToPath(new URL("../../../.env", import.meta.url)),
  );
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code !== "ENOENT") {
    throw error;
  }
}

const config = loadConfig();
const logger = createLogger(config);
const app = createApp({ config, logger });
const server = createServer(app);

server.listen(config.port, "0.0.0.0", () => {
  logger.info({
    event: "server.started",
    mode: config.kakaoMode,
    port: config.port,
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: "server.stopping", signal });

  const forceTimer = setTimeout(() => {
    logger.error({ event: "server.force_stopped" });
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close((error) => {
    clearTimeout(forceTimer);
    if (error !== undefined) {
      logger.error({ event: "server.stop_failed" });
      process.exit(1);
    }
    (app.locals.transitService as TransitService | undefined)?.repository.close();
    logger.info({ event: "server.stopped" });
    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
