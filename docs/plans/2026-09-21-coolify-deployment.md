# Coolify staging and cutover plan

Status: deployment wiring prepared; production and staging infrastructure are not yet provisioned.
Refreshed against the active `support-platform` PR on 2026-09-25.
This is a runtime migration first; database and object-storage relocation are separate projects.

## Current state (2026-09-25)

- Coolify is reachable only over the tailnet. The inspected instance had no Veerify application,
  database, service, or GitHub webhook. The user confirmed production should use `veerify.io`
  domains with direct public ports 80/443; the public ingress IP/forwarding target is not recorded.
  Both GitHub deployment environments are now restricted to the `main` branch, but `Production`
  still has no required reviewer rule.
- The `Production` and `Coolify Preview` GitHub environments now have nonsecret Coolify API and
  tailnet-host variables. They still need Coolify application UUIDs, a fresh Coolify API token,
  Tailscale workload identity secrets, and production reviewer approval.
- PR [#47](https://github.com/Frogbyte-io/veerify/pull/47) remains open from `support-platform` to
  `main`. Its CI and Neon PR E2E checks pass, but the Vercel status still fails.
- The application config uses `veerify.io` for team subdomains, defaults the dashboard to
  `app.veerify.io`, and points custom-domain CNAMEs at `cname.veerify.io`. Current public DNS for
  `veerify.io`, `www`, `app`, `cname`, and a wildcard probe resolves to Vercel. No DNS records have
  been changed. The authoritative name servers are Vercel DNS; they can remain in place during the
  initial runtime migration, with only the necessary A/AAAA records changed after Coolify is
  verified. Replace these with the Coolify host's public ingress only after wildcard routing, HTTPS,
  and existing customer-domain behavior are verified. Never publish the server's Tailscale `100.x`
  address in public DNS.
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

1. Add required reviewers to the GitHub `Production` environment. `Production` and `Coolify Preview`
   now have branch policies restricted to `main`; add required reviewers to the preview environment
   as well if it will contain sensitive staging data.
2. Create a Tailscale workload identity federation client for this repository and `tag:ci-coolify-deploy`.
   Its tag ACL must allow access only to the Coolify host on TCP 8000. The port 8000 management UI
   must remain tailnet-only; public 80/443 should reach only the Coolify proxy. Add repository secrets
   `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`.
3. In each GitHub environment, configure variables `COOLIFY_API_URL` (Coolify base plus `/api/v1`),
   `COOLIFY_APPLICATION_UUID`, `COOLIFY_TAILSCALE_HOST`, and `COOLIFY_REDIS_HOST` (the exact
   environment-specific Redis DNS name); add a freshly rotated
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
- Use the existing PostgreSQL and S3-compatible providers only after confirming ownership, access,
  backups, and migration compatibility. Redis was not configured when this plan was written. A
  separate Coolify Valkey Compose stack with off-host S3 backups is now implemented in the
  support-platform deployment PR, but it still needs Production and Preview resources, credentials,
  backup buckets, and restore verification before either app environment switches to Redis.
  Staging uses separate credentials/database/bucket/Redis and a test mail destination. Never point a
  staging worker at production support queues. A scrubbed snapshot is optional; empty seeded staging
  data is enough.
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
3. **Customer domains:** handled by the `cloudflare-saas` domain provider (Cloudflare for SaaS on the
   `veerify.io` zone), not by Coolify routes or Caddy `on_demand_tls`. See
   [Customer domains with Cloudflare for SaaS](#customer-domains-with-cloudflare-for-saas). The Caddy
   `/api/system/tls-ask` gate belongs to the non-Cloudflare self-hosted path and is unused behind the
   tunnel; leave it as is.
4. **Runtime config:** set Nuxt's `NUXT_PUBLIC_APP_DOMAIN`, `NUXT_PUBLIC_DASHBOARD_DOMAIN`, and
   `NUXT_PUBLIC_CNAME_TARGET` alongside their APP/CNAME counterparts. Some consumers use runtime
   config and others process environment. Verify compiled/browser config has staging hosts, not
   Docker build defaults. Set `NUXT_DOMAIN_PROVIDER` (`static-cname` until the Cloudflare rollout below, then `cloudflare-saas`) as well as `DOMAIN_PROVIDER`.
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

## Customer domains with Cloudflare for SaaS

With `DOMAIN_PROVIDER=cloudflare-saas`, saving a custom domain on a project registers it as a
Cloudflare Custom Hostname on the `veerify.io` zone (`POST /zones/{zone_id}/custom_hostnames`, HTTP
DCV, DV certificate). Cloudflare issues and renews the certificate at its edge; Veerify never holds
customer keys.

- **Customer DNS:** one record, `CNAME feedback.acme.com -> cname.veerify.io` (`CNAME_TARGET`). That
  name is the zone's **fallback origin**, which must already be set in the zone's Cloudflare for SaaS
  settings, proxied, and pointing at the tunnel. HTTP DCV completes on its own once the CNAME
  resolves. If Cloudflare returns ownership or certificate TXT records they are shown in the domain
  settings so the customer can pre-validate.
- **Status:** a domain is `active` only when the Cloudflare hostname status and its certificate status
  are both `active`. The app serves a custom domain only while its stored status is `active`. The
  status is refreshed when the owner presses verify in project settings, and by the
  `domains:status-refresh` task every 10 minutes: domains that are not active yet are re-checked after
  10 minutes, active ones after 6 hours, 25 per run. The task only reads from Cloudflare (it never
  registers, re-validates or deletes), emails the team admins once when a domain goes live, and marks a
  hostname Cloudflare no longer has as `error`. It does nothing unless `DOMAIN_PROVIDER=cloudflare-saas`.
  The stored Cloudflare id is kept in `domain.provider_domain_id` (lookup falls back to the hostname).
- **Removal:** detaching a domain deletes the custom hostname (already gone counts as success).
- **Token:** `CLOUDFLARE_API_TOKEN` needs exactly **Zone > SSL and Certificates > Edit**, restricted
  to the `veerify.io` zone (Zone Resources: Include > Specific zone > veerify.io). Nothing else.
  `CLOUDFLARE_ZONE_ID` is that zone's id (zone Overview page). Set both as Coolify secrets, plus the
  runtime overrides `NUXT_CLOUDFLARE_API_TOKEN` and `NUXT_CLOUDFLARE_ZONE_ID`, with
  `NUXT_DOMAIN_PROVIDER=cloudflare-saas` and `NUXT_PUBLIC_CNAME_TARGET=cname.veerify.io`. The server
  logs a warning at startup if the provider is selected and either value is missing.

### Operator check: arbitrary Host headers must reach the app

This is a configuration check, not a code change. Cloudflare forwards customer traffic to the
fallback origin with the customer's hostname still in the `Host` header (for example
`feedback.acme.com`). The Cloudflare Tunnel public hostname rule for the app, and Coolify's Traefik
router behind it, must therefore accept and route **any** Host to the Veerify container instead of
only the known Veerify hostnames. Verify before rollout:

1. In the tunnel config, the rule that serves `cname.veerify.io` forwards to Traefik (or the app
   service) with no restriction that drops unknown hostnames, and the origin does not rewrite `Host`.
2. In Coolify, the Veerify application has a catch-all route (or the tunnel targets the app port
   directly), so a request with `Host: feedback.dotmatrixlabs.com` reaches the app and is not answered
   with Traefik's 404.
3. Test it: `curl -sI --resolve feedback.dotmatrixlabs.com:443:<edge-ip> https://feedback.dotmatrixlabs.com/`
   returns the board, not a 404 from Traefik or a Cloudflare error 1014/1016.

Unknown hostnames are still refused by Cloudflare itself (no custom hostname, no certificate) and by
the app (no active `domain` row), so a catch-all origin route does not open an issuance relay.

### Rollout

1. Create the API token (permissions above) and note the zone id. Confirm in the Cloudflare dashboard
   that Cloudflare for SaaS is enabled and the fallback origin is `cname.veerify.io` and **Active**.
2. Run the Host-header operator check above against the existing working hostname.
3. With the old provider still selected, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` and run a
   dry run from a host that can reach the production database:
   `yarn domains:sync-cloudflare`. Review the report: every row should be `would_adopt` (for example
   `feedback.dotmatrixlabs.com`, already in Cloudflare) or `would_register`. Hostnames inside the zone
   itself, such as `feedback.veerify.io`, show as `skipped_zone`: they are ordinary DNS records there,
   and the provider reports them as active without ever registering or deleting them. Cloudflare hostnames with
   no Veerify row are listed as orphans for manual review; the script never deletes anything.
4. Run `yarn domains:sync-cloudflare --apply --i-know-this-is-production`. It records provider
   `cloudflare-saas` and the Cloudflare id on each row, and marks active domains as already notified so
   no "domain connected/verified" email is sent. Re-running changes nothing unless a status changed.
5. Switch the provider: `DOMAIN_PROVIDER=cloudflare-saas` and `NUXT_DOMAIN_PROVIDER=cloudflare-saas`,
   then redeploy (or restart) the app.
6. Check `feedback.dotmatrixlabs.com` still loads and its domain settings show Active. Add a new test
   domain, point its CNAME at `cname.veerify.io`, press verify, and confirm it reaches Active.
7. Rollback: set both provider variables back to `static-cname` and redeploy. Hostnames stay in
   Cloudflare and keep serving; no data needs reverting. An active row keeps working because the app
   only reads the stored status.

An existing row that was not synced is adopted by Cloudflare hostname the first time its owner presses
verify while `cloudflare-saas` is selected (or registered there if missing), also without sending an
email for an already active domain.

## Environment inventory

Secrets belong in Coolify environment settings, never the repository or deployment logs.

| Area     | Required settings and checks                                                                                                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime  | APP_DEPLOYMENT_MODE=self-hosted, NODE_ENV=production, HOST=0.0.0.0, PORT=3000; build must use Node server preset, not a Vercel preset                                                                                                                                                                                                                                 |
| Database | DATABASE_URL for isolated managed staging DB; same target for app/migrator; SSL trust configured and tested                                                                                                                                                                                                                                                           |
| Auth     | BETTER_AUTH_URL, BETTER_AUTH_SECRET; optional previous secret; optional MARKETING_EMAIL_HASH_KEY (set once, never rotate); staging-specific GitHub OAuth callback/credentials                                                                                                                                                                                         |
| Domains  | APP_DOMAIN, APP_DASHBOARD_DOMAIN, CNAME_TARGET, DOMAIN_PROVIDER (`static-cname`, then `cloudflare-saas`; with `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ZONE_ID`); matching NUXT runtime overrides above                                                                                                                                                          |
| Links    | APP_URL as an absolute reachable HTTPS origin for CSAT links                                                                                                                                                                                                                                                                                                          |
| Redis    | Self-hosted Valkey stack is implemented in `ops/coolify/redis/` but not provisioned. Configure unique Production/Preview names and credentials, set runtime `REDIS_URL` and both Redis drivers, and verify the daily off-server backup/restore path before production. See the [Redis stack design](../superpowers/specs/2026-09-28-coolify-redis-compose-design.md). |
| Storage  | `NUXT_STORAGE_DRIVER=s3`, `NUXT_STORAGE_BUCKET`, `NUXT_STORAGE_REGION`, `NUXT_STORAGE_ENDPOINT`, `NUXT_STORAGE_ACCESS_KEY_ID`, `NUXT_STORAGE_SECRET_ACCESS_KEY`, `NUXT_STORAGE_FORCE_PATH_STYLE`, `NUXT_STORAGE_PUBLIC_BASE_URL`, `NUXT_UPLOAD_TOKEN_SECRET`                                                                                                          |
| Mail     | Runtime `NUXT_NODEMAILER_HOST`, `_PORT`, `_SECURE`, `_FROM`; authenticated SMTP also needs `_AUTH_USER` and `_AUTH_PASS` when the built config contains `auth`; set direct `MAIL_FROM` for support fallbacks and use a staging sink or allowlisted recipients                                                                                                         |
| Support  | `SUPPORT_CHANNEL_PROVIDER` and selected provider's `SUPPORT_POSTMARK_*` or `SUPPORT_MAILGUN_*` credentials, with staging webhook URL                                                                                                                                                                                                                                  |

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
The optional `SYSTEM_SMTP_*` transport for sign-in, verification, reset and other system mail is
read directly from the runtime environment (no `NUXT_` mapping or build-time placeholder needed).
Moving support mail to Frogmail while keeping account mail on Resend is described in
[Using Frogmail](../deployment-mail.md#using-frogmail).

The in-process Nitro scheduler runs regardless of APP_DEPLOYMENT_MODE; do not
use it to disable scheduling in a replica. A dedicated scheduler switch does not exist yet. External cron HTTP calls additionally need `CRON_SECRET`; Nitro itself does not.

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
- [ ] Verify a customer hostname registered through `cloudflare-saas` (CNAME to `cname.veerify.io`, Cloudflare certificate, board served) and that an unregistered hostname is refused by Cloudflare.
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

## Marketing module deployment

Applies to the Marketing hub (`docs/plans/2026-10-09-marketing-hub/`), migrations `0044`-`0053` on
this branch. The Marketing code reads its settings from `process.env` on each access (not from Nuxt
runtime config), so the plain variable names below work as Coolify runtime environment variables. No
`NUXT_` mapping is needed and none has to exist at image build time. Mark them "runtime only" in
Coolify, not as build variables.

### Marketing environment variables

Every variable the Marketing code reads is in `.env.example` (documented), passed through in the
`docker-compose.yml` app environment, and listed below. Audit result: no variable is read by
Marketing code without being in all three places.

| Variable                                                                        | Required?          | Cloud (veerify.io)                                                                                                                                                 | Self-host                                                                                        |
| ------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `SECRETS_ENCRYPTION_KEY`                                                        | Yes, to save keys  | Required. `openssl rand -base64 32`. Keep a copy in a secret store; losing it makes every saved team key unusable                                                  | Required before teams can save their own API keys. Back it up separately from the database       |
| `SECRETS_ENCRYPTION_KEY_PREVIOUS`                                               | Only when rotating | Empty except during a rotation (see runbook). Comma-separated list accepted                                                                                        | Same                                                                                             |
| `BETTER_AUTH_URL`                                                               | Yes (existing)     | `https://app.veerify.io`. Also used for the Google redirect URI, digest and review links, and the `VeerifyBot` user agent                                          | Public dashboard origin over HTTPS, reachable by Google when Search Console is used              |
| `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`                                        | No                 | **Do not set `FIRECRAWL_API_KEY` until billing exists.** An instance key gives every team free full crawls (billing design, stage B2)                              | Optional instance-wide crawler; `FIRECRAWL_API_URL` can point at a self-hosted Firecrawl         |
| `PAGESPEED_API_KEY`                                                             | No                 | **Do not set until billing exists.** It is a shared instance fallback that every team consumes                                                                     | Optional; without it PageSpeed uses the team's key or is skipped                                 |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`                 | No                 | Instance-wide: one Reddit app serves all teams and shares one API quota. Decide on Reddit API terms and capacity before enabling                                   | Register your own Reddit app; all three are needed for Reddit mentions                           |
| `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`                                    | No                 | Instance-wide shared account; use a dedicated account and an app password                                                                                          | Handle (for example `you.bsky.social`) and an app password, never the login password             |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                      | No                 | Needs an external OAuth consent screen; `webmasters.readonly` is a sensitive scope and requires Google verification before general use                             | Web-application OAuth client with the Search Console API enabled; needs `SECRETS_ENCRYPTION_KEY` |
| `MARKETING_ALLOW_INSTANCE_KEYS`                                                 | No                 | Leave unset. On cloud (`APP_DEPLOYMENT_MODE=cloud`) the instance `FIRECRAWL_API_KEY` / `PAGESPEED_API_KEY` are ignored unless this is `true`                       | Ignored: instance keys always apply when self-hosting                                            |
| `MARKETING_VISIBILITY_CONCURRENCY`, `MARKETING_VISIBILITY_PROVIDER_CONCURRENCY` | No                 | Defaults 24 answers in flight and 8 per LLM provider (caps 50 and 20). Raise only with higher provider rate limits                                                 | Same defaults                                                                                    |
| `MARKETING_VISIBILITY_BACKLOG_LIMIT`                                            | No                 | Default 5000. Weekly runs stop being scheduled while this many answers are pending, and the batch shrinks from half the limit                                      | Same default                                                                                     |
| `MARKETING_MENTIONS_CONCURRENCY`                                                | No                 | Default 16 sites polled at once (cap 32); each site polls its sources in parallel. Use 32 around 5,000 products, subject to the Reddit and Bluesky quotas          | Same default                                                                                     |
| `PG_POOL_MAX`                                                                   | No                 | Default 20 connections in the app pool (max 200). Web requests and every Marketing task share it; keep it below Postgres `max_connections` divided by app replicas | Same default                                                                                     |
| `MARKETING_MAX_AUDIT_PAGES`, `MARKETING_MANUAL_AUDITS_PER_DAY`                  | No                 | Defaults (50 pages, 3 manual audits per product per day) are the cost guardrails; lower rather than raise them                                                     | Defaults 50 (hard cap 500) and 3                                                                 |

Format notes:

- The Google redirect URI must be exactly `<BETTER_AUTH_URL>/api/marketing/google/callback`, for
  example `https://app.veerify.io/api/marketing/google/callback`, registered as an authorized
  redirect URI. Changing `BETTER_AUTH_URL` requires updating Google too.
- `REDDIT_USER_AGENT` should follow Reddit's format `<platform>:<app id>:<version> (by /u/<reddit username>)`,
  for example `web:io.veerify.marketing:1.0 (by /u/your_username)`. If unset, the code sends
  `veerify:marketing-mentions:1.0 (self-hosted)`, which Reddit may throttle; always set it on cloud.
- `SECRETS_ENCRYPTION_KEY` is 32 bytes as base64, base64url or 64 hex characters. An invalid value
  makes saving keys fail and the integration panel report encryption as unconfigured. It is never
  logged.
- LLM provider keys (Anthropic, OpenAI, Perplexity, Gemini) are not instance variables. Teams save
  their own in Marketing settings; there is no instance LLM fallback in this code.
- Cloud guard: when `APP_DEPLOYMENT_MODE=cloud` (or Vercel is detected with the mode unset), the
  instance `FIRECRAWL_API_KEY` and `PAGESPEED_API_KEY` fallbacks are ignored, so no team gets free
  crawling or PageSpeed at the operator's expense. Integration status shows "Bring your own key"
  and teams without their own key get the basic audit. Setting `MARKETING_ALLOW_INSTANCE_KEYS=true`
  re-enables the fallbacks (only do that deliberately, until the billing entitlements in
  `docs/plans/2026-10-11-billing/design.md`, stage B2, exist). Self-hosted installs are unaffected.

### Scheduled tasks

Nitro registers these in `nuxt.config.ts` `nitro.scheduledTasks` and runs them in-process on Coolify.
Do not add Coolify scheduled commands on top. The same tasks exist as `/api/cron/*` handlers for
Vercel Cron, which need `CRON_SECRET`; Nitro does not.

| Task                            | Cadence                | Needs                                                                                                                                                                      |
| ------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `marketing:audit-advance`       | every minute           | Outbound HTTPS to verified user sites; Firecrawl (team key, or instance key off-cloud) for full crawls; PageSpeed host if a key exists                                     |
| `marketing:visibility-advance`  | every minute           | LLM provider egress and a team LLM key; 24 answers in flight (8 per provider); claims stop 20 s before the 45 s budget and provider calls abort at 55 s                    |
| `marketing:review-requests`     | every 5 min            | Working SMTP (`SMTP_*`, `MAIL_FROM`)                                                                                                                                       |
| `marketing:competitors-check`   | every 10 min           | Outbound HTTPS to competitor sites (robots.txt honoured, one page per host per 10 s, at most daily per page)                                                               |
| `marketing:mentions-poll`       | every 5 min            | HN Algolia (no key); Reddit and Bluesky only with their credentials; 16 sites at a time (sources of a site in parallel) within 45 s; each source is re-polled after 30 min |
| `marketing:visibility-schedule` | hourly, :00            | Database only (queues weekly runs, at most 150 sites per tick; pauses while 5,000 answers are pending)                                                                     |
| `marketing:audit-schedule`      | hourly, :05            | Database only (queues first and weekly audits, never-audited sites first)                                                                                                  |
| `marketing:search-sync`         | hourly, :20            | Google OAuth and Search Console egress, `GOOGLE_*`, `SECRETS_ENCRYPTION_KEY`; 100 sites per run, 5 at a time                                                               |
| `marketing:mentions-digest`     | hourly 07:00-11:00 UTC | Working SMTP; emails team admins who have not opted out, 10 sends at a time; one send per team and day, resumes if a run ran out of time                                   |
| `marketing:retention`           | daily 03:30 UTC        | Database only (anonymises old review requests and testimonial emails, prunes competitor changes and usage/ledger rows)                                                     |

All ten are registered in both `nuxt.config.ts` and `vercel.json`.

Vercel only: Hobby plans allow cron jobs at most once per day, so `vercel.json` with per-minute
crons does not work there; the Marketing advance tasks need minute cadence, so a Vercel deployment
requires Pro. Coolify and compose are unaffected. Vercel also needs `CRON_SECRET` (fail-closed:
unset means every task returns 401) and uses `nitro.vercel.functions.maxDuration: 60`.

#### Capacity at 5,000 products

Assumptions: one app replica, defaults above, upstream APIs not rate limiting. Per-call timings are
estimates to be replaced with measured values (log lines of each task carry the counts).

| Task                                                                            | Capacity per run and per day                                                                                                                   | Demand at 5,000 products                                                                        | Verdict                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mentions-poll` (5 min, 45 s, 16 sites, sources parallel)                       | About 1.5 s per site gives roughly 480 sites per run, 2,880 per 30 min (before: about 160)                                                     | 5,000 sites every 30 min                                                                        | Full cycle in about 52 min at 16; about 27 min at `MARKETING_MENTIONS_CONCURRENCY=32`. Reddit (about 100 requests per minute per app) is the real ceiling, not the poller |
| `visibility-advance` (1 min, 24 in flight, 8 per provider, claims stop at 25 s) | About 1.7 answers per slot per minute: about 14, 27 and 41 answers per minute with 1, 2 and 3+ configured providers (before: about 30 at best) | 5,000 sites per week, 30 to 60 answers per run: 15 to 30 answers per minute                     | Fits with 2+ providers; with one provider raise `MARKETING_VISIBILITY_PROVIDER_CONCURRENCY`                                                                               |
| `mentions-digest` (hourly 07:00-11:00, 10 sends at once)                        | About 900 to 1,500 emails per run at 0.3 to 0.5 s each, 4,500 to 7,500 per day                                                                 | At most one email per admin per product with new mentions, up to about 10,000 in the worst case | Fits typical load (not every product has new mentions daily); worst case needs a larger SMTP rate or a longer window                                                      |
| `competitors-check` (10 min, 120 watches, 8 hosts at once)                      | 17,280 watch checks per day; a URL several teams watch is fetched once; at most 5 distinct pages per host per run                              | About 25,000 daily rechecks at 5 watches per product, less with shared URLs                     | Slightly short without URL sharing; raise `MAX_WATCHES_PER_RUN` or the cadence if backlog shows                                                                           |
| `audit-advance` (1 min, 4 lanes)                                                | About 4 basic audits every 5 to 10 s: dozens per minute                                                                                        | About 30 weekly audits per hour                                                                 | Ample; full crawls are limited by Firecrawl polling, not lanes                                                                                                            |

Database connections: all of the above share one pool (`PG_POOL_MAX`, default 20). No task holds a
connection while waiting on a provider, site or SMTP (statements and the two budget transactions are
short), so 24 + 16 + 4 workers do not need 44 connections: they queue briefly at checkout when
statements coincide. If `pg` pool wait times show up in the logs, raise `PG_POOL_MAX` before raising
concurrency, staying below Postgres `max_connections`.

#### Replicas and scheduler safety

Run exactly one app replica with stop-before-start deploys, as required above: there is still no
scheduler-disable flag or leader election, and Nitro starts every task in every process. The
Marketing tasks themselves are now safe against a second process (a rolling-deploy overlap or a
deliberate second replica); the only cost is some duplicated, idempotent work. Per task:

- `audit-advance`: row lease in `site_facts._runtime` with `FOR UPDATE SKIP LOCKED` (3-minute lease).
  Finishing an audit re-takes the lease (6 minutes) before the site-file fetch, before PageSpeed and
  before writing results, and stops if it no longer holds it, so a slow PageSpeed call cannot cause a
  double finish. `audit-schedule`: the partial unique index from `0045` turns a duplicate start into
  a handled `already_running`.
- `visibility-advance`: answer claims with `SKIP LOCKED` and a 3-minute lease, per-provider claims.
  Finalizing runs is one set-based statement guarded by the run's status. `visibility-schedule`:
  duplicate starts hit the `0045` unique index.
- `review-requests`: `SKIP LOCKED` claim plus a stale-claim sweep. Delivery stays at-least-once (a
  worker that dies after sending but before recording can send one duplicate after the sweep).
- `competitors-check`: atomic per-watch claim on `last_checked_at`. The per-host 10 s spacing is
  per process, so two replicas can each fetch one page from a host in the same window.
- `mentions-poll`: each (site, source) cursor is claimed before polling (`last_attempt_at` stamped
  only if unset or older than 15 minutes), so overlapping processes poll different pairs. The
  Reddit/Bluesky rate-limit state is per process.
- `search-sync`: each site is claimed (`last_sync_at` stamped when still older than the 23 h due
  threshold) before syncing. A crash after the claim leaves the site marked synced for that day.
- `retention`: idempotent deletes and updates, so running it twice is safe.
- Secrets-rotation sweep (inside `marketing:visibility-schedule`): compare-and-swap updates, so it is
  safe under multiple replicas.
- `mentions-digest`: one `marketing_usage` row per team and day (`digest:<YYYY-MM-DD>`, inserted
  `ON CONFLICT DO NOTHING RETURNING`) is the claim, so only one process emails a team. It is
  at-most-once: a process that dies after claiming loses that team's digest for the day; if every
  email of a team fails the claim is released and the next hourly run (up to 10:00 UTC) retries.

### Migrations 0044-0053

The `migrate` service (compose) or the Coolify one-off `migrate` operation applies them in order
before traffic starts. All are forward-only. Only `0045` can reject existing data: it creates two
partial unique indexes (one active AI visibility run per site, one active audit per site). On a
fresh database `0044` creates those tables in the same run, so no conflicting rows can exist. The
risk is a database that already applied `0044` from an earlier build (staging, a preview) and holds
duplicate in-flight rows, or one where the Marketing tables were created by `db:push`, which makes
`0044`'s `CREATE TABLE` collide. Also read the `0019` journal-ordering warning at the top of this plan.

Later migrations in the range: `0050` creates the feedback attachments table (support/feedback, not
Marketing). `0051` adds Marketing indexes using non-concurrent `CREATE INDEX` on `mention` and
`ai_visibility_answer`; this takes brief locks and runs in the `migrate` step before traffic starts.
`0052` adds email-hash columns for privacy-preserving retention (review requests, testimonials and
suppressions). `0053` adds the mention poller's query offset and cycle start, records when a testimonial was withdrawn, and rebuilds the pending
AI visibility answer index with `provider` first (non-concurrent, brief lock).

Run this read-only check against the target database before migrating. The first query must return
`null`, or the other queries must return no rows:

```sql
-- Marketing tables already present? (null on a clean pre-0044 database)
select to_regclass('public.marketing_site');

-- Only if the tables exist: duplicate active audits per site (blocks 0045)
select site_id, count(*) from seo_audit
 where status in ('queued', 'crawling', 'analyzing') group by site_id having count(*) > 1;

-- Only if the tables exist: duplicate active visibility runs per site (blocks 0045)
select site_id, count(*) from ai_visibility_run
 where status in ('queued', 'running') group by site_id having count(*) > 1;

-- Which migrations are recorded (Drizzle applies by timestamp)
select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 8;
```

On a database before `0044` the second and third queries fail with "relation does not exist", which
is the expected clean state. To clear duplicates, take a backup, then mark all but the newest row as
failed (for example `update seo_audit set status = 'failed' where id = '<older id>'`).

### Outbound network and egress

The app needs outbound HTTPS (443) to the hosts below. If the Coolify host or network has an egress
firewall, allow them by hostname (IPs change); a deny-by-default firewall silently stops the matching
task.

| Purpose                                                               | Hosts                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| LLM providers (AI visibility, key validation)                         | `api.anthropic.com`, `api.openai.com`, `api.perplexity.ai`, `generativelanguage.googleapis.com`                                   |
| Crawl                                                                 | `api.firecrawl.dev`, or the host in `FIRECRAWL_API_URL` if self-hosted (may be an internal address)                               |
| PageSpeed Insights                                                    | `www.googleapis.com`                                                                                                              |
| Google OAuth and Search Console                                       | `accounts.google.com`, `oauth2.googleapis.com`, `openidconnect.googleapis.com`, `www.googleapis.com`                              |
| Hacker News mentions                                                  | `hn.algolia.com`                                                                                                                  |
| Reddit mentions                                                       | `www.reddit.com`, `oauth.reddit.com`                                                                                              |
| Bluesky mentions                                                      | `bsky.social`                                                                                                                     |
| User sites (verification, audit, competitors, launch kit directories) | Arbitrary public hostnames on 80/443, redirects followed. Allow general outbound web access; a hostname allowlist is not workable |
| Email                                                                 | The SMTP relay host and port (digest, review requests)                                                                            |

User-supplied URLs are checked by the app before fetching, but as defense in depth keep the
container unable to reach the Coolify host, the tailnet and admin interfaces.

### SECRETS_ENCRYPTION_KEY rotation runbook

Behaviour (`server/utils/secrets.ts`): new secrets are encrypted with `SECRETS_ENCRYPTION_KEY`; each
payload records an 8-character key id; decryption picks the key by that id from the current key and
the comma-separated `SECRETS_ENCRYPTION_KEY_PREVIOUS`. A re-encryption sweep
(`server/services/marketing/secrets-rotation.ts`) runs hourly from `marketing:visibility-schedule` and
rewrites team API keys and Search Console tokens still on a previous key. Marketing settings →
Integration status shows how many remain; remove the previous key only when that reaches 0.

1. Generate a new key: `openssl rand -base64 32`.
2. Set `SECRETS_ENCRYPTION_KEY_PREVIOUS` to the old key and `SECRETS_ENCRYPTION_KEY` to the new key in
   Coolify, then redeploy (one replica). Old payloads still decrypt; new saves use the new key.
3. Verify with Marketing settings, Integration status, **Test all**.
4. Wait until Marketing settings → Integration status shows 0 keys on the previous key (the sweep
   runs hourly), then remove `SECRETS_ENCRYPTION_KEY_PREVIOUS` and redeploy. Removing it earlier
   leaves the remaining credentials undecryptable (teams must re-enter keys and reconnect Google).
5. If the key was leaked, rotate as above and also have teams revoke and re-enter provider keys;
   assume the old key stays needed until they have.
6. Store current and previous keys outside the app host. Restoring a database without the matching
   key loses all saved team keys.

### Marketing go-live checklist

- [ ] Backup taken.
- [ ] Pre-deploy SQL (the `0045` pre-check above) checked; no duplicate active rows.
- [ ] `migrate` succeeded (`0044`-`0053` recorded).
- [ ] Config and env: `SECRETS_ENCRYPTION_KEY` set and recorded in the secret store; `..._PREVIOUS` empty.
- [ ] Config and env: cloud: `FIRECRAWL_API_KEY` and `PAGESPEED_API_KEY` are unset, and `MARKETING_ALLOW_INSTANCE_KEYS` is unset (or not `true`) until billing exists; `REDDIT_USER_AGENT` set if Reddit is enabled.
- [ ] Config and env: optional sources configured: Reddit (id, secret, user agent), Bluesky, Google (redirect URI registered).
- [ ] Deploy with one app replica (stop-before-start).
- [ ] Scheduler startup log shows `Scheduler backend: Nitro scheduled tasks`, and `marketing:*` tasks run after a few minutes, including `marketing:retention` after its next 03:30 UTC run.
- [ ] Egress to the hosts above works from the app container.
- [ ] As team admin: enable the Marketing module, then Marketing settings, Integration status, **Test all**: every configured integration passes.
- [ ] Verify a site (meta tag, file or DNS method) and confirm it shows as verified.
- [ ] Start the first audit; it moves from queued to complete within a few ticks and issues appear.
- [ ] Save a team LLM key, add a prompt, start the first visibility run; answers complete and usage is recorded.
- [ ] Complete the Google Search Console connect round trip back to the dashboard.
- [ ] Digest email: with a mention present, confirm one digest arrives after 07:00 UTC (SMTP works, no duplicates).
