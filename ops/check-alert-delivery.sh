#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="${CHIMAP_REPO_ROOT:-/root/chimap}"
alertmanager_url="${ALERTMANAGER_URL:-http://127.0.0.1:9093}"
started_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
started_epoch=$(date +%s)

cd "$repo_root"

resolve_alert() {
  local ended_at
  ended_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  curl --fail --silent --show-error \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "$alertmanager_url/api/v2/alerts" >/dev/null <<JSON
[
  {
    "labels": {
      "alertname": "ChimapOperatorNotificationCheck",
      "severity": "critical",
      "service": "chimap",
      "environment": "production"
    },
    "annotations": {
      "summary": "CHIMap 운영자 장애 알림 전달 확인",
      "description": "운영자가 요청한 실제 알림 전달 확인이며 서비스 장애가 아닙니다."
    },
    "startsAt": "$started_at",
    "endsAt": "$ended_at"
  }
]
JSON
}

trap resolve_alert EXIT

curl --fail --silent --show-error \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$alertmanager_url/api/v2/alerts" >/dev/null <<JSON
[
  {
    "labels": {
      "alertname": "ChimapOperatorNotificationCheck",
      "severity": "critical",
      "service": "chimap",
      "environment": "production"
    },
    "annotations": {
      "summary": "CHIMap 운영자 장애 알림 전달 확인",
      "description": "운영자가 요청한 실제 알림 전달 확인이며 서비스 장애가 아닙니다."
    },
    "startsAt": "$started_at"
  }
]
JSON

for attempt in $(seq 1 20); do
  last_success=$(
    docker compose exec -T alert-relay node -e "
      fetch('http://127.0.0.1:9080/metrics')
        .then((response) => response.text())
        .then((body) => {
          const match = body.match(
            /^chimap_alert_relay_last_success_timestamp_seconds ([0-9]+)$/m,
          );
          process.stdout.write(match?.[1] ?? '0');
        });
    "
  )
  if (( last_success >= started_epoch )); then
    printf '%s\n' \
      "외부 장애 알림 전달을 확인했습니다. 복구 알림은 Alertmanager 묶음 주기 뒤 도착할 수 있습니다."
    exit 0
  fi
  sleep 2
done

printf '%s\n' \
  "외부 장애 알림 성공을 확인하지 못했습니다. alert-relay 로그와 webhook 설정을 확인해 주세요." >&2
exit 1
