#!/bin/sh
# Daily RDB snapshot upload for the Coolify Valkey stack (production only).
# Requests a background save, waits for it, verifies and copies the RDB, and
# uploads it to the private backup bucket. It runs once on startup, then at
# 02:15 UTC each day.
#
# Required environment:
#   REDIS_PASSWORD           Valkey auth password
#   BACKUP_ENABLED           "true" in production, "false" (or unset) in preview
# Production-only:
#   BACKUP_BUCKET            private S3 bucket name
#   BACKUP_ENDPOINT          S3-compatible endpoint URL
#   BACKUP_ACCESS_KEY_ID     least-privilege upload credential (no delete)
#   BACKUP_SECRET_ACCESS_KEY secret for the above
set -u

STATE_DIR=/var/lib/veerify-redis-backup
LAST_SUCCESS_FILE="$STATE_DIR/last-success"
LAST_FAILURE_FILE="$STATE_DIR/last-failure"
HOST=127.0.0.1
RDB=/data/dump.rdb
UPLOAD_DIR=/tmp/redis-upload

log() { echo "[redis-backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

redis_cli() {
  REDISCLI_AUTH="$REDIS_PASSWORD" valkey-cli --no-auth-warning -h "$HOST" "$@"
}

# Trigger a background save and wait for it to finish.
run_snapshot() {
  previous_save=$(redis_cli lastsave 2>/dev/null) || return 1
  case "$previous_save" in ''|*[!0-9]*) return 1 ;; esac
  redis_cli bgsave >/dev/null 2>&1 || return 1
  deadline=$(( $(date +%s) + 600 ))
  while :; do
    sleep 5
    persistence=$(redis_cli info persistence 2>/dev/null) || return 1
    if printf '%s\n' "$persistence" | grep -q '^rdb_bgsave_in_progress:0'; then
      printf '%s\n' "$persistence" | grep -q '^rdb_last_bgsave_status:ok' || return 1
      current_save=$(redis_cli lastsave 2>/dev/null) || return 1
      case "$current_save" in ''|*[!0-9]*) return 1 ;; esac
      [ "$current_save" -gt "$previous_save" ] || return 1
      return 0
    fi
    [ "$(date +%s)" -lt "$deadline" ] || return 1
  done
}

verify_and_stage() {
  valkey-check-rdb "$RDB" >/dev/null 2>&1 || return 1
  mkdir -p "$UPLOAD_DIR"
  ts=$(date -u '+%Y%m%dT%H%M%SZ')
  cp "$RDB" "$UPLOAD_DIR/dump-$ts.rdb" || return 1
  echo "$ts"
}

upload() {
  # values as env so secrets are never argv-visible in ps output
  BACKUP_BUCKET="$BACKUP_BUCKET" \
  BACKUP_ENDPOINT="$BACKUP_ENDPOINT" \
  BACKUP_REGION="$BACKUP_REGION" \
  BACKUP_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY_ID" \
  BACKUP_SECRET_ACCESS_KEY="$BACKUP_SECRET_ACCESS_KEY" \
  SRC="$1" \
  python3 /usr/local/lib/veerify-redis-backup/backup-state.py upload
}

record_success() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  date -u '+%Y-%m-%dT%H:%M:%SZ' >"$LAST_SUCCESS_FILE" 2>/dev/null || return 1
  rm -f "$LAST_FAILURE_FILE" 2>/dev/null || return 1
}

record_failure() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  date -u '+%Y-%m-%dT%H:%M:%SZ' >"$LAST_FAILURE_FILE" 2>/dev/null
}

# The first run happens immediately after startup; subsequent runs align to
# 02:15 UTC instead of drifting by 24 hours from each completion time.
sleep_until_next_backup() {
  now=$(date -u +%s)
  hhmm=$(date -u +%H%M)
  if [ "$hhmm" -lt 0215 ]; then
    target=$(date -u '+%Y-%m-%d')T02:15:00Z
  else
    target=$(date -u -d 'tomorrow 02:15' '+%Y-%m-%dT02:15:00Z')
  fi
  target_epoch=$(date -u -d "$target" +%s) || return 1
  delay=$((target_epoch - now))
  [ "$delay" -gt 0 ] && sleep "$delay"
}

# Preview (BACKUP_ENABLED != true): run once, report, and idle so the
# container stays healthy-bounded. Re-run an occasional no-op snapshot is
# unnecessary; just sleep.
if [ "$BACKUP_ENABLED" != "true" ]; then
  log "backup disabled (preview or unset); runner idle"
  record_success
  while :; do sleep 3600; done
fi

for var in BACKUP_BUCKET BACKUP_ENDPOINT BACKUP_ACCESS_KEY_ID BACKUP_SECRET_ACCESS_KEY; do
  if [ -z "$(eval "printenv $var")" ]; then
    log "missing required variable $var; exiting"
    exit 1
  fi
done

while :; do
  if run_snapshot && staged=$(verify_and_stage) && upload "$UPLOAD_DIR/dump-$staged.rdb"; then
    if record_success; then
      log "snapshot uploaded: dump-$staged.rdb"
    else
      record_failure || true
      log "snapshot uploaded, but backup success metadata could not be recorded"
    fi
  else
    record_failure || true
    log "snapshot or upload failed; will retry at the next scheduled time"
  fi
  rm -rf "$UPLOAD_DIR"
  sleep_until_next_backup || exit 1
done
