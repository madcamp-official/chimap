export type AlertStatus = "firing" | "resolved";
export type AlertSeverity = "critical" | "warning" | "info";
export type NotificationProvider = "slack" | "discord" | "generic";

export type AlertmanagerAlert = {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
};

export type AlertmanagerPayload = {
  status?: string;
  receiver?: string;
  groupLabels?: Record<string, string>;
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  externalURL?: string;
  alerts?: AlertmanagerAlert[];
};

export type NotificationSummary = {
  status: AlertStatus;
  severity: AlertSeverity;
  title: string;
  lines: string[];
  alertCount: number;
  sourceUrl?: string;
};

const MAX_LINE_LENGTH = 700;
const MAX_ALERTS_IN_MESSAGE = 5;

function clipped(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }
  return normalized.length <= MAX_LINE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_LINE_LENGTH - 1)}…`;
}

function normalizedStatus(value: string | undefined): AlertStatus {
  return value === "resolved" ? "resolved" : "firing";
}

function normalizedSeverity(value: string | undefined): AlertSeverity {
  if (value === "critical" || value === "warning") {
    return value;
  }
  return "info";
}

function severityLabel(severity: AlertSeverity): string {
  if (severity === "critical") {
    return "긴급";
  }
  if (severity === "warning") {
    return "주의";
  }
  return "안내";
}

export function summarizeAlerts(
  payload: AlertmanagerPayload,
): NotificationSummary {
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const status = normalizedStatus(payload.status);
  const severity = normalizedSeverity(
    payload.commonLabels?.severity ??
      alerts.find((alert) => alert.labels?.severity !== undefined)?.labels
        ?.severity,
  );
  const alertCount = Math.max(alerts.length, 1);
  const title =
    status === "resolved"
      ? `✅ CHIMap 장애 복구 · ${severityLabel(severity)}`
      : `🚨 CHIMap 장애 발생 · ${severityLabel(severity)}`;
  const visibleAlerts = alerts.slice(0, MAX_ALERTS_IN_MESSAGE);
  const lines =
    visibleAlerts.length === 0
      ? [
          clipped(
            payload.commonAnnotations?.summary,
            "상세 경보 정보가 없습니다.",
          ),
        ]
      : visibleAlerts.map((alert) => {
          const name = clipped(
            alert.labels?.alertname,
            "이름 없는 경보",
          );
          const summary = clipped(
            alert.annotations?.summary,
            "요약 정보 없음",
          );
          const description = clipped(
            alert.annotations?.description,
            "추가 설명 없음",
          );
          return `• ${name}\n  ${summary}\n  ${description}`;
        });
  if (alerts.length > visibleAlerts.length) {
    lines.push(`• 그 외 ${alerts.length - visibleAlerts.length}건`);
  }
  const sourceUrl =
    clipped(payload.externalURL, "") ||
    clipped(visibleAlerts[0]?.generatorURL, "") ||
    undefined;
  return {
    status,
    severity,
    title,
    lines,
    alertCount,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  };
}

function plainText(summary: NotificationSummary): string {
  const parts = [
    summary.title,
    `경보 ${summary.alertCount}건`,
    ...summary.lines,
  ];
  if (summary.sourceUrl !== undefined) {
    parts.push(`상태 확인: ${summary.sourceUrl}`);
  }
  return parts.join("\n");
}

export function formatNotification(
  provider: NotificationProvider,
  payload: AlertmanagerPayload,
): unknown {
  const summary = summarizeAlerts(payload);
  const text = plainText(summary);

  if (provider === "slack") {
    return {
      text,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: summary.title,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*경보 ${summary.alertCount}건*\n${summary.lines.join("\n\n")}`,
          },
        },
        ...(summary.sourceUrl === undefined
          ? []
          : [
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "상태 확인",
                    },
                    url: summary.sourceUrl,
                  },
                ],
              },
            ]),
      ],
    };
  }

  if (provider === "discord") {
    return {
      content: summary.title,
      embeds: [
        {
          title: `경보 ${summary.alertCount}건`,
          description: summary.lines.join("\n\n"),
          color:
            summary.status === "resolved"
              ? 0x2e_9d_67
              : summary.severity === "critical"
                ? 0xc9_32_32
                : 0xe2_8a_28,
          ...(summary.sourceUrl === undefined
            ? {}
            : { url: summary.sourceUrl }),
        },
      ],
    };
  }

  return {
    service: "chimap",
    notification: summary,
    alertmanager: payload,
  };
}

export function parseAlertmanagerPayload(
  value: unknown,
): AlertmanagerPayload | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as AlertmanagerPayload;
  if (
    candidate.alerts !== undefined &&
    !Array.isArray(candidate.alerts)
  ) {
    return undefined;
  }
  return candidate;
}
