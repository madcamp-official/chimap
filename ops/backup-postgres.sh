#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

repo_root="${CHIMAP_REPO_ROOT:-/root/chimap}"
backup_dir="${BACKUP_DIR:-/var/backups/chimap}"

case "$backup_dir" in
  /var/backups/chimap|/var/backups/chimap/*) ;;
  *)
    echo "BACKUP_DIR은 /var/backups/chimap 아래여야 합니다." >&2
    exit 2
    ;;
esac

mkdir -p "$backup_dir"
chmod 0755 "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
if ! flock -n 9; then
  echo "다른 CHIMap 백업이 실행 중입니다." >&2
  exit 3
fi

cd "$repo_root"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
daily_name="chimap-daily-${timestamp}.dump"
daily_path="$backup_dir/$daily_name"
temporary_path="$(mktemp "$backup_dir/.chimap-backup.XXXXXX")"
status_temporary="$(mktemp "$backup_dir/.latest-status.XXXXXX")"

cleanup() {
  rm -f -- "$temporary_path" "$status_temporary"
}
trap cleanup EXIT

docker compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  >"$temporary_path"

if [[ ! -s "$temporary_path" ]]; then
  echo "생성된 PostgreSQL 백업이 비어 있습니다." >&2
  exit 4
fi

docker compose exec -T postgres \
  pg_restore --list <"$temporary_path" >/dev/null

mv -- "$temporary_path" "$daily_path"
sha256="$(sha256sum "$daily_path" | awk '{print $1}')"
bytes="$(stat --printf='%s' "$daily_path")"
printf '%s  %s\n' "$sha256" "$daily_name" >"$daily_path.sha256"

if [[ "$(date -u +%u)" == "7" ]]; then
  weekly_name="chimap-weekly-$(date -u +%G-W%V).dump"
  weekly_path="$backup_dir/$weekly_name"
  cp --reflink=auto -- "$daily_path" "$weekly_path"
  printf '%s  %s\n' "$sha256" "$weekly_name" >"$weekly_path.sha256"
fi

completed_at="$(date -u --iso-8601=seconds)"
printf '{\n' >"$status_temporary"
printf '  "completedAt": "%s",\n' "$completed_at" >>"$status_temporary"
printf '  "file": "%s",\n' "$daily_name" >>"$status_temporary"
printf '  "bytes": %s,\n' "$bytes" >>"$status_temporary"
printf '  "sha256": "%s"\n' "$sha256" >>"$status_temporary"
printf '}\n' >>"$status_temporary"
mv -- "$status_temporary" "$backup_dir/latest.json"
chmod 0644 "$backup_dir/latest.json"

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'chimap-daily-*.dump' -o -name 'chimap-daily-*.dump.sha256' \) \
  -mtime +6 -delete
find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'chimap-weekly-*.dump' -o -name 'chimap-weekly-*.dump.sha256' \) \
  -mtime +27 -delete

echo "CHIMap PostgreSQL backup completed: file=$daily_name bytes=$bytes sha256=$sha256"
