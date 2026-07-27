import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { AppMetrics } from "./monitoring/metrics.js";
import { TransitService } from "./transit/transit-service.js";

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
const transitService = new TransitService({ config, logger });
await transitService.initialize();
const metrics = new AppMetrics({
  config,
  repository: transitService.repository,
});
const app = createApp({ config, logger, transitService, metrics });
const server = createServer(app);
const metricsServer = config.metrics.enabled
  ? createServer(metrics.handleRequest)
  : undefined;

server.listen(config.port, "0.0.0.0", () => {
  logger.info({
    event: "server.started",
    port: config.port,
  });
});

metricsServer?.listen(config.metrics.port, "0.0.0.0", () => {
  logger.info({
    event: "metrics.started",
    port: config.metrics.port,
  });
});

function closeServer(target: Server | undefined): Promise<void> {
  if (target === undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    target.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

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

  void Promise.all([closeServer(server), closeServer(metricsServer)])
    .then(() => transitService.close())
    .then(() => {
      clearTimeout(forceTimer);
      logger.info({ event: "server.stopped" });
      process.exit(0);
    })
    .catch(() => {
      clearTimeout(forceTimer);
      logger.error({ event: "server.stop_failed" });
      process.exit(1);
    });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
