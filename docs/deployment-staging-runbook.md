# Staging setup runbook: manual steps

These are the operator steps for standing up Veerify staging on Coolify. They can't be done with a
Coolify API token, because they need other accounts (Vercel DNS, S3, Frogmail, Resend, GitHub,
Tailscale) or a human decision. The Coolify side (project, environment, Postgres, Valkey, app,
environment variables, migration run) is done through the Coolify API and recorded in
[Coolify staging and cutover plan](plans/2026-09-21-coolify-deployment.md#staging-execution-and-evidence).

Work through the steps in order. Each step lists what to hand back so the automated setup can
continue. Never paste secrets into chats, issues or commits. Put them straight into Coolify, GitHub
or the secret store.

Staging host names used below (change them if you prefer):

| Purpose               | Host                      |
| --------------------- | ------------------------- |
| Root / public boards  | `staging.veerify.io`      |
| Dashboard             | `app.staging.veerify.io`  |
| Team subdomains       | `*.staging.veerify.io`    |
| Customer CNAME target | `cname.staging.veerify.io` |

---

## 0. Coolify API token

1. In Coolify (`http://bergen:8000`, tailnet only), go to **Keys & Tokens → API tokens**. Revoke the
   token that was shared during the earlier setup, which counts as exposed.
2. Create a new token with read and write permissions.
3. On the `dev` machine, save it where only you can read it:

   ```bash
   mkdir -p ~/.config/veerify && chmod 700 ~/.config/veerify
   read -rsp "Coolify token: " T && printf %s "$T" > ~/.config/veerify/coolify.token && unset T && chmod 600 ~/.config/veerify/coolify.token
   ```

4. Delete the file once staging is set up. Create a **separate** token later for the GitHub deploy
   workflow (step 7).

**Hand back:** "token saved", and confirm that `bergen` is the Coolify server that should run
staging.

## 1. Public ingress

1. Find the public IPv4 (and IPv6, if any) that reaches the Coolify proxy on ports 80/443. The
   Coolify management UI on port 8000 must stay tailnet-only.
2. Check from outside the tailnet that `http://<public-ip>` reaches Coolify's proxy (a 404 from
   Traefik is fine).

**Hand back:** the public IP(s). Never use the Tailscale `100.x` address in public DNS.

## 2. DNS for staging (Vercel DNS)

`veerify.io` uses Vercel DNS. Production records stay as they are.

1. In Vercel → Domains → `veerify.io` → DNS records, add:

   | Name          | Type | Value       | TTL |
   | ------------- | ---- | ----------- | --- |
   | `staging`     | A    | `<public-ip>` | 300 |
   | `app.staging` | A    | `<public-ip>` | 300 |
   | `*.staging`   | A    | `<public-ip>` | 300 |
   | `cname.staging` | A  | `<public-ip>` | 300 |

   Add matching AAAA records if the server has public IPv6.
2. Wildcard TLS needs a DNS-01 challenge. Choose one:
   - **Wildcard certificate (recommended):** create a Vercel API token limited to the `veerify.io`
     team. In Coolify → Servers → `bergen` → Proxy, add a Traefik certificate resolver using the
     `vercel` DNS provider (`VERCEL_API_TOKEN` in the proxy environment). The guide is at
     https://coolify.io/docs/knowledge-base/proxy/traefik/wildcard-certs. Hand the resolver name
     back; the app's domain settings will reference it.
   - **No wildcard for now:** skip the token. Staging then tests one fixed team subdomain (for
     example `demo.staging.veerify.io`) with a normal HTTP-01 certificate.

**Hand back:** which TLS option you chose, and the resolver name if any.

## 3. Object storage (S3-compatible)

1. Create a **staging-only** bucket, for example `veerify-staging`, with your current S3 provider.
   Never reuse the production bucket.
2. Access policy:
   - Everything under `support/` (support attachments and raw inbound mail) and
     `feedback-attachments/` must be private, even if someone knows the object key.
   - Branding images (logos, banners) live under `projects/`. The app can also serve them itself
     through `/api/uploads/object/projects/...`, so the bucket may not need public read at all.
     The Coolify setup step confirms which way `NUXT_STORAGE_PUBLIC_BASE_URL` should point before
     the policy is final.
   - Never grant public access to the whole bucket. The local MinIO bootstrap does this, so don't
     copy it.
3. Turn on versioning, and a lifecycle rule that removes expired temporary uploads.
4. Create an access key limited to this bucket.

**Hand back** (put the secrets into Coolify yourself, or tell me which secret store they're in):
endpoint, region, bucket name, whether path-style addressing is needed, the public base URL for
branding objects, and the access key ID and secret.

## 4. Frogmail staging project

Use the staging Frogmail, or a separate `veerify-staging` project in production Frogmail. The
staging acceptance plan is `frogmail/docs/acceptance/staging-acceptance-plan.md`.

1. Create the project `veerify-staging` with an SES source. SES sandbox is fine for staging, but
   then only verified recipient addresses receive mail.
2. Add and verify the staging sending domain, for example `staging.veerify.io`, in the Frogmail
   dashboard. Publish the DNS records it shows in Vercel DNS (DKIM, MAIL FROM, DMARC). Don't touch
   existing records.
3. Create **two** API keys:
   - **Sending key**, `emails:send` only. This becomes `SMTP_PASS`.
   - **Management key**, `domains:read`, `domains:manage`, `routes:manage`. This becomes
     `SUPPORT_MAILGUN_API_KEY`. Keeping it separate means domain polling never uses up the sending
     key's rate limit.
4. Delivery webhooks, created with the management key:
   `POST /v3/domains/<staging domain>/webhooks` for `delivered`, `permanent_fail` and
   `temporary_fail` → `https://app.staging.veerify.io/api/support/delivery/mailgun`. Store the
   `mailgun_signing_key` it returns **once**; this becomes `SUPPORT_MAILGUN_SIGNING_KEY`.
5. Platform forwarding domain. Customers forward their support mail to an address on this domain.
   - Frogmail can only receive at the **apex** of a Cloudflare zone, so a subdomain such as
     `in.veerify.io` won't work today (see `frogmail/docs/dns-onboarding.md`, "Apex and subdomain
     receiving").
   - Register a dedicated domain (for example `veerifymail.com`, or `veerifymail-staging.com` for
     staging), add it to Cloudflare, and connect it to the Frogmail project.
   - Enable receiving for it in the Frogmail dashboard. Add one catch-all route:
     `match_recipient(".*@<platform domain>")` → `forward("https://app.staging.veerify.io/api/support/inbound/mailgun")`, `stop()`.
   - Also verify it for sending, so replies can come from the forwarding address.

**Hand back:** the Frogmail origin URL, the SMTP gateway host and port, the sending domain, the
platform domain, and where the two keys and the signing key are stored.

## 5. System mail (sign-in, verification, password reset)

Recommended: keep account mail on Resend so a Frogmail problem never blocks logins (see
[Using Frogmail](deployment-mail.md#keep-sign-in-mail-on-resend)).

1. In Resend, verify the staging sender domain, or reuse the production domain with a separate API
   key labelled `veerify-staging`.
2. Create an API key with sending access only.

**Hand back:** where the key is stored, and the From address, for example
`Veerify Staging <noreply@staging.veerify.io>`.

## 6. Optional: GitHub OAuth for staging

Only if staging should test GitHub login or issue sync. Create a separate GitHub OAuth app with the
callback `https://app.staging.veerify.io/api/auth/callback/github` (and the repo-integration
callback used by the product settings). Never reuse the production app.

## 7. GitHub deploy workflow (`.github/workflows/coolify-deploy.yml`)

1. Repository → Settings → Environments:
   - Add **required reviewers** to `Production`, and to `Coolify Preview` if staging will hold
     sensitive data. Both are already limited to the `main` branch.
2. Tailscale admin console:
   - Create a workload identity federation client for this repository, tagged
     `tag:ci-coolify-deploy`.
   - Add an ACL rule that lets that tag reach only `bergen:8000`.
   - Add repository secrets `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`.
3. In each environment add:
   - variables `COOLIFY_API_URL` (`http://bergen:8000/api/v1`, or the MagicDNS name),
     `COOLIFY_APPLICATION_UUID`, `COOLIFY_TAILSCALE_HOST` and `COOLIFY_REDIS_HOST`. I'll report the
     UUID and Redis host after the Coolify setup.
   - the secret `COOLIFY_API_TOKEN`: a **new** token, not the one from step 0.

## 8. End-to-end mail check (MVP-DEP-3)

After the app is deployed, run
[the provider checklist](plans/2026-08-11-support-platform/stage-01-04-provider-checklist.md) with
real mailboxes you control, and record the results in `TODO.md` under MVP-DEP-3:

1. Send mail to a support address. A ticket appears.
2. Reply from Veerify with an attachment. It arrives, threaded, with DKIM passing.
3. Reply from the mailbox. It lands on the same ticket.
4. Send to a suppressed or non-existent address. The bounce shows on the message.
5. Download a support attachment while signed in (works), signed out (denied), and straight from S3
   (denied).
6. Custom sending domain (after that feature merges): add a test domain in `/support/settings`,
   publish the records, wait for Verified, and send a reply from it. Check that a second team can't
   claim the same domain or a subdomain of it.

## 9. Before production cutover (not part of staging)

- **Migration history.** Check whether the production database ever applied the old `main`
  migration `0019_supreme_groot`. If it did, resolve the journal ordering issue described at the top
  of the [Coolify plan](plans/2026-09-21-coolify-deployment.md) before running `migrate` against it.
- **Customer domains.** List every customer board domain currently served by Vercel and provision a
  Coolify route and certificate for each. Coolify doesn't do Caddy's on-demand TLS.
- **Backups.** Take a production backup and test a restore into a disposable database. Back up the
  bucket separately (a database dump doesn't include S3 objects).
- **Frogmail cutover.** Follow the staged plan in `frogmail/docs/acceptance/production-cutover.md`:
  outbound first, then inbound, each with its own observation window. Keep the Resend and current
  inbound provider settings under rollback names until decommission.
