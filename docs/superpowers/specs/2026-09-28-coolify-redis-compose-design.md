# Coolify Redis-compatible Compose stack

**Status:** Implemented for review. Stack definition lives in `ops/coolify/redis/`; deploy workflow
preflight in `.github/workflows/coolify-deploy.yml`. Not yet provisioned in Coolify; live acceptance
evidence (criteria 1-7) still requires the prerequisites below and staging verification.

**Date:** 2026-09-28

## Goal

Give Veerify's Coolify production and preview deployments an isolated Redis-protocol broker for
realtime fan-out and rate limiting, with an automated off-server backup for production. Keep the
service definition reviewable in Git and independent from normal application releases.

The support-platform architecture already uses `ioredis` and calls for a self-hosted
`valkey/valkey:9` service. This design follows that provider-neutral Redis protocol decision. The
application's PostgreSQL database remains the source of truth; Redis snapshots preserve short-lived
keys such as rate-limit state, not in-flight pub/sub messages or durable business records.

## Approaches considered

1. **Coolify standalone Redis resource plus separate backup runner.** This gets Coolify's generated
   credentials and database controls, but the backup worker and its network/configuration become a
   second independently managed resource.
2. **Dedicated Compose stack containing Valkey and a backup runner (recommended).** One versioned
   Compose definition owns the Redis-compatible server, persistent volume, health checks, and backup
   process. It is one Coolify-managed deployment unit and keeps the backup tools beside the service
   without exposing Redis publicly.
3. **Managed Redis provider.** This reduces host-level operations and may provide provider-managed
   durability, but adds an external service and billing dependency. It is not selected for this
   Coolify migration.

## Architecture

- Add a dedicated Git-based Coolify Compose application/resource for the Redis stack, separate from
  the Veerify web application. Keep its source in `ops/coolify/redis/` so Compose, backup scripts,
  and container build configuration are versioned together.
- Use the patch-pinned `valkey/valkey:9.1.2-alpine3.24` image, compatible with the application's
  `ioredis` wire-protocol clients. Enable AOF and RDB persistence on the persistent `/data` volume.
  Do not use a floating tag.
- Define separate production and preview Compose resources, each with its own password and persistent
  `/data` volume. Do not share a volume or credentials between environments. Provisioning and stack
  redeployment must be explicit; ordinary web-app deploys must not recreate either Redis stack.
- Give each resource a unique `VALKEY_CONTAINER_NAME` so the app can resolve the correct Valkey
  container after Coolify attaches the stack to the shared network. Verify that name in Coolify's
  deployable Compose view before setting the app's `REDIS_URL`. Set the same host in the matching
  GitHub environment's `COOLIFY_REDIS_HOST`; deployment preflight rejects cross-environment hosts.
- Require explicit `VALKEY_MAXMEMORY` and `VALKEY_MEMORY_LIMIT` settings on each Compose resource.
  Keep maxmemory below the container limit with measured headroom for allocator overhead, client
  buffers, and AOF/RDB copy-on-write during persistence operations.
- Keep port 6379 private. Enable Coolify's **Connect To Predefined Network** on each stack so the
  separately deployed web app can reach it over the server's `coolify` network. Set each app's
  `REDIS_URL` in that app's Coolify runtime environment; never echo the URL in GitHub Actions logs.
- Configure both `REALTIME_DRIVER=redis` and `RATE_LIMIT_STORE=redis` explicitly in app runtime
  settings. Before deploying an app, the workflow reads its Coolify environment-variable metadata
  and checks only that the required keys exist, are runtime variables, and have valid values. It
  also checks the correct deployment scope: production variables for Production, preview variables
  for Preview. The Redis URL must use the corresponding environment's configured host. It must
  never print or store the URL or password in GitHub Actions. This avoids copying the Redis URL into
  a second secret store while preventing missing or cross-environment Redis configuration.
- The preview stack is isolated and may be reset without impacting production. Its backup runner is
  disabled; both `BACKUP_REQUIRED=false` and `BACKUP_ENABLED=false` are required. Production
  requires both flags to be `true`, and its backup runner rejects any disabled/mismatched setting.

Coolify Services are Docker Compose stacks and support persistent volumes. A Compose stack uses its
own resource network by default; connecting it to another Coolify resource requires enabling its
predefined network. [Coolify services](https://coolify.io/docs/services), [networking](https://coolify.io/docs/services/configuration/networking), and
[persistent storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Backup and restore

- Include a small backup-runner container in each stack definition; it has no public ports. In the
  production resource, run a daily RDB snapshot job at 02:15 UTC and run once after startup. Keep the
  runner disabled in Preview.
  The runner requests a background snapshot, waits for it to complete, reads `/data/dump.rdb` through
  a read-only mount of Valkey's persistent volume, verifies the RDB file, and uploads it to a
  dedicated private S3-compatible backup bucket. A failed snapshot or upload marks the runner
  unhealthy; it retries at the next scheduled time.
- Use separate, least-privilege backup credentials scoped to that bucket/prefix. Do not reuse the
  app's general storage credentials. The Boto3 uploader uses multipart transfer for large snapshots,
  so scope `PutObject`, `AbortMultipartUpload`, and `ListMultipartUploadParts` to this bucket's
  objects; do not grant `ListBucket` or delete access. Apply a 30-day object lifecycle expiration at
  the storage provider.
- Keep successful-run metadata locally in the runner container and expose a health check that fails
  immediately after any failed backup attempt or when no backup completed in the previous 36 hours.
  Coolify health and container logs provide the first operational signal; external alert delivery is
  outside this change because no monitoring destination has been selected.
- Document a manual restore procedure: fetch a snapshot using a separate restore-capable credential,
  verify it with `valkey-check-rdb`, restore to an isolated replacement/test stack, then verify
  authenticated connectivity and expected key counts before switching the app's `REDIS_URL`.
- Set recovery expectations to an RPO of at most 24 hours for persisted Redis keys. Measure restore
  time during the first restore drill rather than promising an untested RTO. Pub/sub messages are
  transient and cannot be recovered from an RDB snapshot.

Valkey documents RDB as a compact point-in-time backup format and recommends transferring a copy at
least daily outside the server. Copying a completed RDB file is safe while the server is running.
[Valkey persistence and backup guidance](https://valkey.io/topics/persistence/).

Coolify's persistent volume survives normal container replacement but is not an off-server backup;
Coolify's scheduled database-backup workflow does not support standalone Redis. [Coolify backup
limits](https://coolify.io/docs/databases/backups) and [persistent storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Deployment automation

- Extend the existing manual Coolify workflow with an explicit resource selector for the web app or
  Redis stack. Select environment independently (Preview or Production); use distinct Coolify UUIDs
  for the two stacks and the two apps.
- A Preview app deploy continues to require a validated PR number and adds the Coolify `pr` query
  only for the app resource. A preview Redis-stack redeploy targets the stable preview stack and
  must not create a per-PR Redis instance.
- Before a Redis-stack deploy, read that Coolify service's environment variables and require both
  `BACKUP_REQUIRED` and `BACKUP_ENABLED` to match the selected environment (`true` for Production,
  `false` for Preview). Do not log or store their values.
- Continue requiring dispatch from `main`, protected GitHub environments, Tailscale access, and
  environment-scoped Coolify credentials. Never deploy infrastructure automatically for untrusted
  fork code.
- Provision each Compose resource once in Coolify, point it at the repository's Compose file on
  `main`, configure its environment-specific secrets, and record the generated application/resource
  UUID in the matching GitHub environment. Subsequent workflow dispatches redeploy that selected
  resource; they do not create a new one.
- The web application remains a separate Coolify Dockerfile deployment. It must be configured with
  the matching private `REDIS_URL`; the Redis password and S3 backup credentials stay in Coolify
  secrets, not source control or the GitHub deploy request.

## Security and failure behavior

- Redis/Valkey listens only on the container network. Do not define a host-published `6379` port.
- Require a strong environment-specific password. Backup credentials are separate from the Redis
  password and limited to snapshot upload; restore access is held separately.
- Pin Redis-compatible server and backup-runner image versions. Review upgrades before redeploying
  production because the Redis volume is persistent state.
- If Redis is unhealthy, Coolify must show the service as unhealthy and the web process must report
  connection errors rather than claiming Redis-backed guarantees while silently using memory.
- If a backup fails, the runner health check must become unhealthy on its next check, and the failed
  command/status must be visible in container logs. App deploys and backups must not print secrets.
- A single Coolify server remains a Redis availability boundary. This design provides persistence
  and off-server recovery, not Redis clustering or zero-downtime failover. Revisit managed/replicated
  Redis before running the app on multiple Coolify servers.

## Acceptance criteria

1. Production and preview are distinct Coolify Compose resources using the versioned definition with
   separate passwords, volumes, and internal URLs; neither exposes port 6379 publicly.
2. Each app's runtime explicitly selects Redis for realtime and rate limiting and uses its own stack.
   The workflow preflight checks the applicable Coolify runtime-variable keys without logging values.
3. A PR preview app deploy cannot create or deploy a PR-specific Redis stack.
4. Production creates one timestamped RDB object per successful daily backup in a private bucket with
   30-day provider lifecycle expiration; Preview creates none.
5. A failed snapshot or upload makes the runner unhealthy at its next health check, and no successful
   backup causes the health check to fail within 36 hours.
6. The documented restore procedure verifies a snapshot and restores it into an isolated stack
   without changing production `REDIS_URL`; the initial drill records measured restore time.
7. Normal web-app deploy requests cannot create, reset, or remove Redis volumes.

## Scope and prerequisites

This design does not move PostgreSQL or object storage, change public DNS, enable public Redis access,
add multi-node Redis/Valkey replication, or introduce an alerting provider. Implementation requires a
fresh Coolify API token (the prior token was shared and is treated as exposed), the Coolify UUIDs for
the app and Redis Compose resources, S3-compatible bucket endpoint and lifecycle support, and separate
backup/restore credentials. The selected backup bucket must be outside the Coolify deployment host.
