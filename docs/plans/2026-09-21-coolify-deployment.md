# Coolify staging and cutover plan

Status: deployment wiring prepared; production and staging infrastructure are not yet provisioned.
Refreshed against `support-platform` at `c6220ac` on 2026-09-25.
This is a runtime migration first; database and object-storage relocation are separate projects.

## Current state (2026-09-25)

- Coolify is reachable only over the tailnet. The inspected instance had no Veerify application,
  database, service, or GitHub webhook. The existing `Production` GitHub environment has no
  deployment protection rules. No production domain or public ingress target has been confirmed.
- PR [#47](https://github.com/Frogbyte-io/veerify/pull/47) remains open from `support-platform` to
  `main`. Its CI and Neon PR E2E checks pass, but the Vercel status still fails.
- The application config uses `veerify.io` for team subdomains, defaults the dashboard to
  `app.veerify.io`, and points custom-domain CNAMEs at `cname.veerify.io`. Current public DNS for
  `veerify.io`, `www`, `app`, `cname`, and a wildcard probe resolves to Vercel. No DNS records have
  been changed. Replace these with the Coolify host's public ingress only after wildcard routing,
  HTTPS, and existing customer-domain behavior are verified. Never publish the server's Tailscale
  `100.x` address in public DNS.
- Do not run the support-platform migrations against a database that has applied `main`'s
  `0019_supreme_groot` yet. The new `0019`–`0027` timestamps precede the main journal's `0019`,
  so Drizzle's timestamp-based migrator can skip them; `0040_thankful_triathlon.sql` is identical
  to main's `0019_supreme_groot.sql` and can then collide with existing tables. Test and correct
  this migration history before selecting a production database or deploying this PR.
- Coolify's API token shared during setup is considered exposed. Rotate it before adding a token to
  GitHub or performing Coolify writes; do not reuse the old value.

### Guarded GitHub deployment workflow

`.github/workflows/coolify-deploy.yml` provides manual production and preview deploy requests. It
must run from `main`, uses an ephemeral GitHub-hosted Tailscale node with workload identity
federation, validates that preview PRs are open and from a repository collaborator, and sends the
deploy request to the environment's Coolify application UUID. It does not check out or execute PR
code in the GitHub runner. Coolify does build the selected PR code, so its preview environment must
remain isolated from production services and secrets.

Before enabling the workflow:

1. Add required reviewers and a `main`-only deployment branch rule to the GitHub `Production`
   environment. Create a separate `Coolify Preview` environment with its own required reviewers.
2. Create a Tailscale workload identity federation client for this repository and `tag:ci-coolify-deploy`.
   Its tag ACL must allow access only to the Coolify host on TCP 8000. The port 8000 management UI
   must remain tailnet-only; public 80/443 should reach only the Coolify proxy. Add repository secrets
   `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`.
3. In each GitHub environment, configure variables `COOLIFY_API_URL` (Coolify base plus `/api/v1`),
   `COOLIFY_APPLICATION_UUID`, and `COOLIFY_TAILSCALE_HOST`; add a freshly rotated
   `COOLIFY_API_TOKEN` as an environment secret. Use separate production and preview app UUIDs.
4. Configure the Coolify production app from `main` and a separate preview app from `main`. Use the
   repository Dockerfile, port 3000, one runtime process, and separate environment values and
   service credentials. Disable public fork previews. Keep production and preview databases,
   Redis, S3 buckets, mail destinations, auth secrets, and provider webhooks separate.
5. Dispatch the workflow manually from `main`. Production additionally requires the operator to
   confirm that the reviewed backup and release migration have completed. That checkbox is an
   attestation; it does not run or verify the migration. The API response only confirms that Coolify
   accepted a deployment request. Verify the Coolify deployment log and app routes separately.

The workflow deliberately does not deploy automatically on `push` or `pull_request`. Automatic
production deployment waits for protected GitHub environment approvals and a verified release
migration path. Automatic preview cleanup also needs a trusted GitHub close-event route because the
Coolify server cannot receive public GitHub webhooks; until then, delete completed previews in
Coolify after their PR is closed.

## Target and decisions

- Deploy the existing `Dockerfile` as a Coolify application listening on port 3000. Set
  `APP_DEPLOYMENT_MODE=self-hosted` for build and runtime; use Nitro's Node server output.
- Retain managed PostgreSQL, S3-compatible storage, and initially managed Redis. Staging uses
  separate credentials/database/bucket and a test mail destination. Never point a staging worker
  at production support queues. A scrubbed snapshot is optional; empty seeded staging data is enough.
- Start with exactly one app process and stop-before-start deployment. Nitro registers scheduled
  tasks in every process. Outbound claim locks do not make every automation action globally safe.
  Multiple replicas/rolling overlap require a scheduler-disable flag and a dedicated scheduler or
  leader election before rollout. Do not add duplicate Coolify scheduled tasks on top of Nitro.
- Keep outbound every minute; cleanup, SLA, automation, and CSAT every five minutes. Daily reporting
  rollups are deferred out of MVP; do not add reporting jobs now. No Vercel Hobby restriction applies to Nitro.
- Keep the existing GitHub CI and Neon PR test workflow. Runtime relocation does not require moving
  CI databases or disabling tests. Retire the Vercel deployment integration only after successful
  cutover; leaving it enabled will keep creating the existing failed deployment status.

Coolify supports [Dockerfile/Compose deployments](https://coolify.io/docs/applications/builds/docker-compose)
and [scheduled container commands](https://coolify.io/docs/services/operations/scheduled-tasks).
The latter is an alternative scheduler, not needed for this initial single-process setup.

## Compatibility gaps to close before staging

1. **Proxy:** do not deploy production `docker-compose.yml` unchanged. Its Caddy binds 80/443 and
   would conflict with Coolify's proxy; it also hardcodes local database/MinIO services. Use a
   Dockerfile application with managed services, not a second reverse proxy on those host ports.
2. **Domains:** configure dashboard, root/public board, and a team subdomain in Coolify. A wildcard
   DNS record alone does not install wildcard routing or a certificate; configure and test both.
   If wildcard TLS is chosen, supply the DNS challenge configuration appropriate to the DNS provider.
3. **Customer domains:** `static-cname` verifies DNS but does not provision Coolify routes. The
   existing Caddy `on_demand_tls` + `/api/system/tls-ask` mechanism will not run behind a normal
   Coolify proxy. For staging, register one test customer hostname manually in Coolify and verify it
   through the app. Before production, inventory every existing customer hostname and provision
   its route/certificate. Automated onboarding needs a separate reviewed Coolify domain adapter,
   or a dedicated ingress design preserving Caddy's strict issuance gate. Do not mark automatic
   customer-domain onboarding ready just because a manually registered hostname works.
4. **Runtime config:** set Nuxt's `NUXT_PUBLIC_APP_DOMAIN`, `NUXT_PUBLIC_DASHBOARD_DOMAIN`, and
   `NUXT_PUBLIC_CNAME_TARGET` alongside their APP/CNAME counterparts. Some consumers use runtime
   config and others process environment. Verify compiled/browser config has staging hosts, not
   Docker build defaults. Set `NUXT_DOMAIN_PROVIDER=static-cname` as well as `DOMAIN_PROVIDER`.
   Storage and mail also require the runtime overrides below; unprefixed variables referenced in
   `nuxt.config.ts` are build-time defaults, not automatic production runtime overrides. Do not bake
   credentials into the image to work around this.
5. **Migrations:** image startup does not migrate. Invoke the same image with argument `migrate`
   as a one-off release operation with database access, and require success before starting traffic.
   This runs Drizzle migrations and the idempotent domain backfill. Do not run seed/reset commands.
   Test the actual Coolify release-hook/container mechanism before relying on it.
6. **Storage privacy:** the existing Compose bootstrap grants public access to the whole MinIO
   bucket. Do not copy that policy. All `support/` objects (attachments/raw inbound payloads) must
   be private, including when the object key is known. Public branding objects need narrowly scoped
   prefix policies or a separate public storage path; verify the prefixes used by the actual upload
   routes. Preserve app-authorized support downloads and temporary-upload expiry policies.
7. **Database TLS:** verify certificate trust consistently for the runtime, migrator, and domain
   backfill. MVP-DEP-1 implements the shared [verified TLS policy](../deployment-database-tls.md)
   with migration-path regression coverage; a temporary local Postgres handshake accepted the
   configured CA and rejected the same certificate without it. Hosted-provider trust remains a
   staging gate. Do not assume encryption alone verifies identity.

See [Coolify domain configuration](https://coolify.io/docs/core/networking/domains) for domain-to-port
routing. The public URL uses HTTPS normally; the configured port selects the container's port 3000.

## Environment inventory

Secrets belong in Coolify environment settings, never the repository or deployment logs.

| Area     | Required settings and checks                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | APP_DEPLOYMENT_MODE=self-hosted, NODE_ENV=production, HOST=0.0.0.0, PORT=3000; build must use Node server preset, not a Vercel preset                                                                                                                         |
| Database | DATABASE_URL for isolated managed staging DB; same target for app/migrator; SSL trust configured and tested                                                                                                                                                   |
| Auth     | BETTER_AUTH_URL, BETTER_AUTH_SECRET; optional previous secret; staging-specific GitHub OAuth callback/credentials                                                                                                                                             |
| Domains  | APP_DOMAIN, APP_DASHBOARD_DOMAIN, CNAME_TARGET, DOMAIN_PROVIDER=static-cname; matching NUXT runtime overrides above                                                                                                                                           |
| Links    | APP_URL as an absolute reachable HTTPS origin for CSAT links                                                                                                                                                                                                  |
| Redis    | REDIS_URL, REALTIME_DRIVER=redis, RATE_LIMIT_STORE=redis; TLS/credentials per managed provider                                                                                                                                                                |
| Storage  | `NUXT_STORAGE_DRIVER=s3`, `NUXT_STORAGE_BUCKET`, `NUXT_STORAGE_REGION`, `NUXT_STORAGE_ENDPOINT`, `NUXT_STORAGE_ACCESS_KEY_ID`, `NUXT_STORAGE_SECRET_ACCESS_KEY`, `NUXT_STORAGE_FORCE_PATH_STYLE`, `NUXT_STORAGE_PUBLIC_BASE_URL`, `NUXT_UPLOAD_TOKEN_SECRET`  |
| Mail     | Runtime `NUXT_NODEMAILER_HOST`, `_PORT`, `_SECURE`, `_FROM`; authenticated SMTP also needs `_AUTH_USER` and `_AUTH_PASS` when the built config contains `auth`; set direct `MAIL_FROM` for support fallbacks and use a staging sink or allowlisted recipients |
| Support  | `SUPPORT_CHANNEL_PROVIDER` and selected provider's `SUPPORT_POSTMARK_*` or `SUPPORT_MAILGUN_*` credentials, with staging webhook URL                                                                                                                          |

Use `.env.example` for local/build variables and direct process-environment consumers; this plan
documents the production Nuxt runtime mappings. `NUXT_STORAGE_DIRECT_UPLOAD_CONSTRAINTS` defaults to
`proxy-required`; retain that unless the chosen S3 provider's constraint enforcement is verified.
`NUXT_NODEMAILER` is not a JSON override: the Nodemailer module maps individual
`NUXT_NODEMAILER_<OPTION>` variables onto options already present in the built config. The app always
defines `host`, `port`, `secure`, and `from`; it only defines `auth` when both `SMTP_USER` and
`SMTP_PASS` are non-empty during the image build. For authenticated runtime SMTP without build-time
secrets, provide non-secret placeholder values for those two variables during the build so the
`auth` keys exist, then set the real `NUXT_NODEMAILER_AUTH_USER` and `NUXT_NODEMAILER_AUTH_PASS` at
runtime. Set the other `NUXT_NODEMAILER_*` overrides at runtime too. Use a full mailbox string such
as `Veerify <noreply@example.com>` for `from`; `MAIL_FROM_NAME` is not mapped by the current app.
Verify effective settings without printing credentials. Also set direct `MAIL_FROM` to the same
sender mailbox: support message fallbacks read it outside Nuxt's Nodemailer runtime configuration.

An APP_DEPLOYMENT_MODE of cloud selects the Vercel
backend; do not use it to disable scheduling in a self-hosted replica. The dedicated scheduler switch
does not exist yet. External cron HTTP calls additionally need `CRON_SECRET`; Nitro itself does not.

## Staging execution and evidence

- [ ] Record Coolify version, server/IP, region, chosen image commit, resource name, and staging hosts.
- [ ] Configure isolated services, private support storage policy, lifecycle/versioning, and secrets.
- [ ] Verify a managed DB backup and restore into a disposable database before release migration.
- [ ] Build the image without database mutation; run the explicit migration operation once.
- Local packaging evidence: image build for `c73effb` succeeded without database access; the 436 MB
  runtime image uses non-root `nuxt`, exposes port 3000, and contains the TLS helper, Drizzle config,
  backfill script, and 45 SQL migrations. The explicit migration operation was smoke-tested against
  a disposable database; it still needs one controlled run against staging after backup/restore.
- Local migration evidence: the image's `migrate` command first rejected a temporary self-signed
  certificate without its CA, then applied all migrations and completed the domain backfill against
  a disposable Postgres 17.5 database when given that CA. This does not verify managed database
  trust roots or replace the staging backup/restore and one-run migration checks.
- Local runtime smoke: after the explicit migration operation, the same image started as its
  non-root user and served `/login` with HTTP 200 against that TLS database. Storage used the
  app's local driver; this does not verify Coolify routing, managed storage, or live email settings.
- [ ] Build without storage/SMTP/upload secrets, supply runtime settings only, and verify resolved
      domains, S3 driver/bucket, upload signing, SMTP authentication, and sender identity in staging.
- [ ] Deploy one app container through Coolify and verify health plus root/dashboard/team HTTPS.
- [ ] Verify login, verification/reset mail, OAuth callback if enabled, and correct secure cookies.
- [ ] Verify branding upload URLs and authenticated support attachment download. Try an unauthorized
      download and an anonymous direct S3 request for the same support object: both must be denied.
- [ ] Send real provider test mail, reply, verify threading and delivery webhook correlation using
      `docs/plans/2026-08-11-support-platform/stage-01-04-provider-checklist.md`. Record observed results.
- [ ] Verify WebSocket upgrade through the proxy, two browser sessions receiving updates, and
      reconnect after restart. Do not rely on notification polling as proof that sockets work.
- [ ] Observe actual outbound retry, due SLA breach, automation, CSAT, and cleanup effects over
      multiple scheduler ticks; record IDs/counts, never message bodies or secrets. Repeat a restart.
- [ ] Verify a manually provisioned customer hostname and denial for an unknown hostname.
- [ ] Exercise deployment failure and return to the previous image; prove scheduler ownership is
      singular before, during, and after the switch. Accept a brief maintenance window initially.
- [ ] Run required harness and affected deployment/behavior tests before opening a deployment PR.

## Production cutover and rollback

Production traffic cutover follows staging evidence and a confirmed public DNS/ingress design. Retain the production
database and object store during this move. Inventory existing domains, callbacks, webhooks, secrets,
storage policies, and schedulers. Record the old image, DNS records/TTL, and a recoverable DB backup.

Pause/disable old scheduled invocations and prevent the old app from accepting writes before enabling
the new production scheduler. Switch traffic/webhooks in the maintenance window, verify delivery and
login, and leave only one scheduler owner. Preserve existing auth/upload secrets at production cutover
so sessions/tokens are not invalidated unintentionally. Staging secrets remain separate.

Rollback first stops the new app/scheduler, then restores routing and the compatible previous image
and scheduler. Database migrations are forward-only: image rollback is safe only if the old image
supports the current schema. A database restore can lose post-backup writes and therefore requires a
separate recovery decision, not an automatic deployment hook. S3 objects need their own backup or
versioning; a database dump does not include them.

## Implementation ownership

MVP-DEP-1 owns the shared database TLS policy; MVP-DEP-2 records the static runtime/container audit.
MVP-DEP-4 removes fabricated analytics while reporting remains deferred. MVP-DEP-3 and the staging
checklist above still require isolated services and real-provider evidence. Domain automation and
multi-replica scheduler ownership each require their own design and tests; neither is needed for the
initial single-container MVP. No live infrastructure changes have been performed by these local tasks.
