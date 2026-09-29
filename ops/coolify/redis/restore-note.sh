#!/bin/sh
# Manual restore procedure for the Coolify Redis stack. Run the fetch/verify
# steps against a separate restore-capable credential, then load the snapshot
# into an isolated replacement stack before switching REDIS_URL.
#
#   1. Fetch a snapshot from the backup bucket with restore credentials
#      (never reuse the runner's upload-only key):
#        aws s3 cp s3://<bucket>/dump-<timestamp>.rdb ./dump-<timestamp>.rdb
#   2. Verify the snapshot:
#        valkey-check-rdb ./dump-<timestamp>.rdb
#   3. Start an isolated replacement stack (this compose file with a fresh
#      volume and its own password is sufficient), stop the valkey service,
#      place the verified file at /data/dump.rdb, and start it again — Valkey
#      loads dump.rdb automatically.
#   4. Verify authenticated connectivity and expected key counts:
#        valkey-cli -a '<password>' dbsize
#        valkey-cli -a '<password>' --scan | head
#   5. Only after verification, point the app's REDIS_URL at the restored
#      stack. Production REDIS_URL is never changed by this script; the
#      switch is a reviewed manual step.
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: restore-note.sh <path-to-verified-dump.rdb>" >&2
  exit 2
fi

dump=$1
valkey-check-rdb "$dump"
echo "Snapshot verified: $dump"
echo "Follow steps 3-5 above to load it into an isolated stack and switch REDIS_URL manually."
