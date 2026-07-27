import { describe, expect, it } from "vitest";

import {
  formatNotification,
  parseAlertmanagerPayload,
  parseExternalAlertsEnabled,
  summarizeAlerts,
  type AlertmanagerPayload,
} from "./notification.js";

const firingPayload: AlertmanagerPayload = {
  status: "firing",
  commonLabels: {
    severity: "critical",
  },
  externalURL: "http://alertmanager:9093",
  alerts: [
    {
      status: "firing",
      labels: {
        alertname: "ChimapDatabaseNotReady",
        severity: "critical",
      },
      annotations: {
        summary: "CHIMap PostgreSQL readiness failed",
        description:
          "PostgreSQL, PostGIS, or the migration checksum is not ready.",
      },
    },
  ],
};

describe("운영자 장애 알림 표현", () => {
  it("외부 알림은 명시적으로 활성화한 경우에만 켠다", () => {
    expect(parseExternalAlertsEnabled(undefined)).toBe(false);
    expect(parseExternalAlertsEnabled("0")).toBe(false);
    expect(parseExternalAlertsEnabled("1")).toBe(true);
    expect(() => parseExternalAlertsEnabled("yes")).toThrow(/0 또는 1/u);
  });

  it("발생 경보를 한국어 제목과 행동 가능한 설명으로 요약한다", () => {
    const summary = summarizeAlerts(firingPayload);

    expect(summary).toMatchObject({
      status: "firing",
      severity: "critical",
      title: "🚨 CHIMap 장애 발생 · 긴급",
      alertCount: 1,
      sourceUrl: "http://alertmanager:9093",
    });
    expect(summary.lines.join(" ")).toContain(
      "ChimapDatabaseNotReady",
    );
    expect(summary.lines.join(" ")).toContain("PostgreSQL");
  });

  it("Slack과 Discord에 읽기 쉬운 발생·복구 payload를 만든다", () => {
    const slack = formatNotification("slack", firingPayload);
    const discord = formatNotification("discord", {
      ...firingPayload,
      status: "resolved",
    });

    expect(JSON.stringify(slack)).toContain("CHIMap 장애 발생");
    expect(JSON.stringify(slack)).toContain("상태 확인");
    expect(JSON.stringify(discord)).toContain("CHIMap 장애 복구");
  });

  it("배열이 아닌 alerts payload는 거절한다", () => {
    expect(parseAlertmanagerPayload({ alerts: "invalid" })).toBeUndefined();
    expect(parseAlertmanagerPayload({ alerts: [] })).toEqual({
      alerts: [],
    });
  });
});
