#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

repo_root="${CHIMAP_REPO_ROOT:-/root/chimap}"
status_dir="${TRANSIT_SYNC_STATUS_DIR:-/var/backups/chimap/transit-sync}"
areas_file="${TRANSIT_SYNC_AREAS_FILE:-$repo_root/ops/transit-sync-areas.json}"

case "$status_dir" in
  /var/backups/chimap|/var/backups/chimap/*) ;;
  *)
    echo "TRANSIT_SYNC_STATUS_DIR은 /var/backups/chimap 아래여야 합니다." >&2
    exit 2
    ;;
esac

if [[ ! -s "$areas_file" ]]; then
  echo "교통 동기화 지역 파일을 찾을 수 없습니다: $areas_file" >&2
  exit 3
fi

# Official Node images run the application as uid/gid 1000. Keep the
# status directory private while allowing the same unprivileged identity
# to atomically replace the status file from the one-shot container.
install -d -m 0750 -o 1000 -g 1000 "$status_dir"
exec 9>"$status_dir/.transit-sync.lock"
if ! flock -n 9; then
  echo "다른 CHIMap 교통 데이터 동기화가 실행 중입니다." >&2
  exit 4
fi

cd "$repo_root"

docker compose run --rm \
  -v "$areas_file:/config/transit-sync-areas.json:ro" \
  -v "$status_dir:/status" \
  api node dist/cli/transit.js sync-areas \
  --path /config/transit-sync-areas.json \
  --statusPath /status/transit-sync-latest.json \
  --concurrency 2
