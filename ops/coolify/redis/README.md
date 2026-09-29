# Coolify Redis stack (production and preview)

Isolated Redis-protocol broker (Valkey 9) for the web app's realtime pub/sub
and rate-limit store, deployed as a separate Coolify Compose resource per
environment. Design and acceptance criteria:
[`docs/superpowers/specs/2026-09-28-coolify-redis-compose-design.md`](../../../docs/superpowers/specs/2026-09-28-coolify-redis-compose-design.md)

Do not deploy the repository-root `docker-compose.yml` into Coolify; this
directory is the only stack definition intended for the Coolify Redis resource.

## Contents

| File                 | Purpose                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `docker-compose.yml` | Valkey 9 (pinned, password-protected, private port) + backup-runner service                         |
| `Dockerfile`         | Backup-runner image (Valkey CLI, `boto3`, scripts)                                                  |
| `backup.sh`          | Daily RDB snapshot, verification, and private-bucket upload loop                                    |
| `backup-state.py`    | S3 upload + success-age helper (secrets stay in environment)                                        |
| `backup-health`      | Production fails on a failed attempt or stale success; explicit Preview-disabled mode stays healthy |
| `restore-note.sh`    | Manual restore procedure stub (verify → isolated stack → switch `REDIS_URL`)                        |

## Provisioning (once per environment)

1. Create the Compose resource in Coolify, pointed at this directory on `main`.
2. Enable **Connect To Predefined Network** so the web app can reach Valkey.
3. Set environment-specific secrets in Coolify (never in Git):
   - `REDIS_PASSWORD` — strong, unique per environment. Use a URL-safe value
     (for example, 32 random bytes encoded as hex) because the app uses it in
     `REDIS_URL`.
   - `VALKEY_CONTAINER_NAME` — unique Docker DNS name on the shared Coolify
     network, such as `veerify-production-redis` or `veerify-preview-redis`.
   - `BACKUP_ENABLED` is required: set `true` for Production and `false` for
     Preview. Production also requires `BACKUP_BUCKET`, `BACKUP_ENDPOINT`,
     `BACKUP_REGION`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`
     (limit the credential to `PutObject`, `AbortMultipartUpload`, and
     `ListMultipartUploadParts` on this bucket's objects; do not grant
     `ListBucket` or delete access; apply a 30-day provider lifecycle rule).
   - Preview: set `BACKUP_ENABLED=false` and omit backup credentials; the
     runner idles and no snapshot is uploaded.
4. Record the resource UUID in the matching GitHub environment for deploys.
5. In the web app's Coolify runtime environment set the matching
   `REDIS_URL=redis://:<REDIS_PASSWORD>@<VALKEY_CONTAINER_NAME>:6379` plus
   `REALTIME_DRIVER=redis` and `RATE_LIMIT_STORE=redis`.

The deploy workflow preflight checks that the required Redis runtime variables
exist, are runtime-scoped, and have the expected values in the app's Coolify
environment. It never prints variable values.

## Backups

Production runs a daily 02:15 UTC snapshot upload. Pub/sub messages are
transient and not recoverable; RPO is at most 24 hours for persisted keys.
Restore procedure: see `restore-note.sh` header and the design doc.
