import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  formatNotification,
  parseAlertmanagerPayload,
  parseExternalAlertsEnabled,
  summarizeAlerts,
  type NotificationProvider,
} from "./notification.js";

const MAX_BODY_BYTES = 256 * 1024;

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 9080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ALERT_RELAY_PORT 범위를 확인해 주세요.");
  }
  return port;
}

function parseProvider(value: string | undefined): NotificationProvider {
  if (value === undefined || value.trim().length === 0) {
    return "slack";
  }
  if (value === "slack" || value === "discord" || value === "generic") {
    return value;
  }
  throw new Error(
    "ALERT_NOTIFICATION_PROVIDER는 slack, discord, generic 중 하나여야 합니다.",
  );
}

const port = parsePort(process.env.ALERT_RELAY_PORT);
const externalAlertsEnabled = parseExternalAlertsEnabled(
  process.env.EXTERNAL_ALERTS_ENABLED,
);
const provider = parseProvider(process.env.ALERT_NOTIFICATION_PROVIDER);
const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim() || undefined;
const statusUrl = process.env.ALERT_STATUS_URL?.trim() || undefined;
const requestTimeoutMs = Math.min(
  Math.max(Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? 5000), 500),
  30_000,
);

let receivedTotal = 0;
let deliveredTotal = 0;
let failedTotal = 0;
let lastSuccessTimestampSeconds = 0;

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new RangeError("payload_too_large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function metrics(): string {
  return [
    "# HELP chimap_alert_relay_configured 외부 장애 알림 webhook 설정 상태",
    "# TYPE chimap_alert_relay_configured gauge",
    `chimap_alert_relay_configured{provider="${provider}"} ${webhookUrl === undefined ? 0 : 1}`,
    "# HELP chimap_alert_relay_enabled 외부 장애 알림 기능 활성화 상태",
    "# TYPE chimap_alert_relay_enabled gauge",
    `chimap_alert_relay_enabled{provider="${provider}"} ${externalAlertsEnabled ? 1 : 0}`,
    "# HELP chimap_alert_relay_received_total Alertmanager에서 받은 알림 묶음 수",
    "# TYPE chimap_alert_relay_received_total counter",
    `chimap_alert_relay_received_total ${receivedTotal}`,
    "# HELP chimap_alert_relay_delivery_total 외부 webhook 전달 결과 수",
    "# TYPE chimap_alert_relay_delivery_total counter",
    `chimap_alert_relay_delivery_total{outcome="success",provider="${provider}"} ${deliveredTotal}`,
    `chimap_alert_relay_delivery_total{outcome="error",provider="${provider}"} ${failedTotal}`,
    "# HELP chimap_alert_relay_last_success_timestamp_seconds 마지막 외부 알림 성공 Unix timestamp",
    "# TYPE chimap_alert_relay_last_success_timestamp_seconds gauge",
    `chimap_alert_relay_last_success_timestamp_seconds ${lastSuccessTimestampSeconds}`,
    "",
  ].join("\n");
}

async function handleAlerts(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!externalAlertsEnabled) {
    json(response, 202, { status: "disabled" });
    return;
  }
  if (webhookUrl === undefined) {
    json(response, 503, {
      error: "notification_not_configured",
    });
    return;
  }

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (error) {
    json(response, error instanceof RangeError ? 413 : 400, {
      error:
        error instanceof RangeError ? "payload_too_large" : "invalid_json",
    });
    return;
  }
  const payload = parseAlertmanagerPayload(raw);
  if (payload === undefined) {
    json(response, 400, { error: "invalid_alertmanager_payload" });
    return;
  }
  receivedTotal += 1;
  const deliveryPayload =
    statusUrl === undefined
      ? payload
      : {
          ...payload,
          externalURL: statusUrl,
        };
  const summary = summarizeAlerts(deliveryPayload);

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "chimap-alert-relay/0.1",
      },
      body: JSON.stringify(formatNotification(provider, deliveryPayload)),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!upstream.ok) {
      throw new Error(`webhook_http_${upstream.status}`);
    }
    deliveredTotal += 1;
    lastSuccessTimestampSeconds = Math.floor(Date.now() / 1000);
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        event: "alert.delivered",
        provider,
        status: summary.status,
        severity: summary.severity,
        alertCount: summary.alertCount,
      })}\n`,
    );
    json(response, 202, { status: "accepted" });
  } catch (error) {
    failedTotal += 1;
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "alert.delivery_failed",
        provider,
        status: summary.status,
        severity: summary.severity,
        alertCount: summary.alertCount,
        reason: error instanceof Error ? error.message : "unknown",
      })}\n`,
    );
    json(response, 502, { error: "notification_delivery_failed" });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://alert-relay.internal");
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, {
      status: !externalAlertsEnabled
        ? "disabled"
        : webhookUrl === undefined
          ? "needs_configuration"
          : "ok",
      enabled: externalAlertsEnabled,
      provider,
      configured: webhookUrl !== undefined,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/metrics") {
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(metrics());
    return;
  }
  if (request.method === "POST" && url.pathname === "/alerts") {
    void handleAlerts(request, response);
    return;
  }
  json(response, 404, { error: "not_found" });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      event: "alert_relay.started",
      port,
      enabled: externalAlertsEnabled,
      provider,
      configured: webhookUrl !== undefined,
    })}\n`,
  );
});

function shutdown(signal: string): void {
  process.stdout.write(
    `${JSON.stringify({
      level: "info",
      event: "alert_relay.stopping",
      signal,
    })}\n`,
  );
  server.close((error) => {
    process.exit(error === undefined ? 0 : 1);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
