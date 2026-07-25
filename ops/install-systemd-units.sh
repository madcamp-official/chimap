#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="${CHIMAP_REPO_ROOT:-/root/chimap}"
unit_source="$repo_root/ops/systemd"
unit_target="/etc/systemd/system"

for unit in \
  chimap-backup.service \
  chimap-backup.timer \
  chimap-backup-verify.service \
  chimap-backup-verify.timer \
  chimap-transit-sync.service \
  chimap-transit-sync.timer; do
  install -m 0644 "$unit_source/$unit" "$unit_target/$unit"
done

systemctl daemon-reload
systemctl enable --now \
  chimap-backup.timer \
  chimap-backup-verify.timer \
  chimap-transit-sync.timer
systemctl list-timers --all --no-pager \
  chimap-backup.timer \
  chimap-backup-verify.timer \
  chimap-transit-sync.timer
