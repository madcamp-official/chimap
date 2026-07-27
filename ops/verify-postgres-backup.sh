#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

backup_dir="${BACKUP_DIR:-/var/backups/chimap}"
postgres_image="${POSTGRES_RESTORE_IMAGE:-postgis/postgis:18-3.6-alpine@sha256:4f8df0958dd321f520f917be5d0b338802928e4e1ebc4720f774168f4bbc2836}"

case "$backup_dir" in
  /var/backups/chimap|/var/backups/chimap/*) ;;
  *)
    echo "BACKUP_DIR은 /var/backups/chimap 아래여야 합니다." >&2
    exit 2
    ;;
esac

latest_backup="$(
  find "$backup_dir" -maxdepth 1 -type f -name 'chimap-daily-*.dump' \
    -printf '%T@ %p\n' |
    sort -nr |
    awk 'NR == 1 { sub(/^[^ ]+ /, ""); print; exit }'
)"
if [[ -z "$latest_backup" || ! -s "$latest_backup" ]]; then
  echo "복구 검증할 일일 백업을 찾지 못했습니다." >&2
  exit 3
fi
checksum_file="$latest_backup.sha256"
if [[ ! -s "$checksum_file" ]]; then
  echo "복구 검증할 백업 checksum 파일을 찾지 못했습니다." >&2
  exit 3
fi
(
  cd "$backup_dir"
  sha256sum --check "$(basename "$checksum_file")" >/dev/null
)

container_name="chimap-postgres-restore-check-$$"
status_temporary="$(mktemp "$backup_dir/.restore-status.XXXXXX")"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f -- "$status_temporary"
}
trap cleanup EXIT

docker run --rm -d \
  --name "$container_name" \
  --tmpfs /var/lib/postgresql:rw,noexec,nosuid,size=768m \
  -e POSTGRES_DB=chimap_restore \
  -e POSTGRES_USER=chimap_restore \
  -e POSTGRES_PASSWORD=restore-check-only \
  "$postgres_image" >/dev/null

initialized=0
for _ in $(seq 1 120); do
  if docker logs "$container_name" 2>&1 |
      grep -q "PostgreSQL init process complete; ready for start up" &&
    docker exec "$container_name" \
      pg_isready -U chimap_restore -d chimap_restore >/dev/null 2>&1; then
    initialized=1
    break
  fi
  sleep 1
done

if [[ "$initialized" != "1" ]]; then
  echo "임시 PostgreSQL 초기화를 120초 안에 완료하지 못했습니다." >&2
  docker logs --tail 100 "$container_name" >&2
  exit 4
fi

docker exec "$container_name" \
  pg_isready -U chimap_restore -d chimap_restore >/dev/null
docker exec "$container_name" \
  dropdb -U chimap_restore chimap_restore
docker exec "$container_name" \
  createdb -U chimap_restore --template=template0 chimap_restore
docker exec -i "$container_name" \
  pg_restore \
  -U chimap_restore \
  -d chimap_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges <"$latest_backup" >/dev/null

stats="$(
  docker exec "$container_name" \
    psql -U chimap_restore -d chimap_restore -At -F, -v ON_ERROR_STOP=1 \
    -c "
      SELECT
        EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')::int,
        (SELECT count(*) FROM schema_migrations),
        (SELECT count(*) FROM bus_stops),
        (SELECT count(*) FROM bus_stops
          WHERE city_code IS NOT NULL AND node_id IS NOT NULL),
        (SELECT count(*) FROM bus_routes),
        (SELECT count(*) FROM bus_route_stops);
    "
)"
IFS=',' read -r postgis migrations stops linked_stops routes route_stops <<<"$stats"

if [[ "$postgis" != "1" ||
      "$migrations" -lt 1 ||
      "$stops" -lt 1 ||
      "$linked_stops" -lt 1 ||
      "$routes" -lt 1 ||
      "$route_stops" -lt 1 ]]; then
  echo "복구 검증 통계가 readiness 조건을 만족하지 않습니다: $stats" >&2
  exit 4
fi

completed_at="$(date -u --iso-8601=seconds)"
backup_name="$(basename "$latest_backup")"
printf '{\n' >"$status_temporary"
printf '  "completedAt": "%s",\n' "$completed_at" >>"$status_temporary"
printf '  "backupFile": "%s",\n' "$backup_name" >>"$status_temporary"
printf '  "postgis": true,\n' >>"$status_temporary"
printf '  "migrations": %s,\n' "$migrations" >>"$status_temporary"
printf '  "stops": %s,\n' "$stops" >>"$status_temporary"
printf '  "linkedStops": %s,\n' "$linked_stops" >>"$status_temporary"
printf '  "routes": %s,\n' "$routes" >>"$status_temporary"
printf '  "routeStops": %s\n' "$route_stops" >>"$status_temporary"
printf '}\n' >>"$status_temporary"
mv -- "$status_temporary" "$backup_dir/restore-latest.json"
chmod 0644 "$backup_dir/restore-latest.json"

echo "CHIMap restore verification completed: file=$backup_name stats=$stats"
