# Domain Platform Adapter Plan

**Goal:** Support both Veerify tenant subdomains (`tenant.veerify.io`) and customer-owned custom domains (`feedback.customer.com`, later optional apex/root domains) through a provider adapter that works with Vercel first and can be extended to self-hosted infrastructure later.

**Current status on March 8, 2026:**

- The app already derives public board URLs from `teamSlug + APP_DOMAIN`.
- Host-based tenant detection already exists in app middleware.
- Custom domain persistence and a basic DNS verification check exist.
- Production wildcard DNS for `*.veerify.io` is not yet configured, so tenant subdomains do not currently resolve.

**Architecture direction:**

- Keep app routing provider-agnostic and driven by the incoming `Host` header.
- Introduce a provider adapter only for domain management and verification operations.
- Ship the first provider as `vercel`.
- Add `self-hosted` later without changing product/domain data models or UI contracts.

**Primary sources informing this plan:**

- Vercel multi-tenant concepts: `https://vercel.com/platforms/docs/multi-tenant-platforms/concepts`
- Vercel custom domain block/actions: `https://vercel.com/platforms/docs/platform-elements/blocks/custom-domain`
- Vercel domain setup guide: `https://vercel.com/docs/domains/set-up-custom-domain`
- Vercel add project domain API: `https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project`
- Vercel verify project domain API: `https://vercel.com/docs/rest-api/reference/endpoints/projects/verify-project-domain`
- Vercel domain config API: `https://vercel.com/docs/rest-api/reference/endpoints/domains/get-a-domains-configuration`

---

## Product decisions

### Scope to ship first

1. Support platform-managed wildcard subdomains under `*.veerify.io`.
2. Support customer-managed custom subdomains like `feedback.customer.com`.
3. Defer customer apex/root domains like `customer.com` until the subdomain flow is stable.

### Customer DNS UX

For customer-owned domains, the customer should **not** receive a unique CNAME target in the common case.

- For subdomains like `feedback.customer.com`, they usually add a `CNAME` to a stable provider target.
- If ownership verification is required, they may also need a provider-generated `TXT` record with a unique verification token.
- For apex/root domains like `customer.com`, the flow may require `A`/`ALIAS` records instead of `CNAME`, plus optional verification records.

For Vercel specifically:

- subdomain pointing is typically `CNAME -> cname.vercel-dns.com` or the exact provider-returned target
- ownership verification may require a TXT record such as `_vercel.customer.com = vc-domain-verify=...`

### Internal ownership model

Domains belong to a Veerify project. The host lookup path should be:

1. Check whether the request matches a configured public custom domain.
2. If not, check whether it matches `tenant.veerify.io`.
3. Resolve the project and tenant.
4. Enforce `isPublic`.

---

## Target architecture

### Split responsibilities

**1. Request-time host resolution**

Pure app logic. No Vercel-specific code.

- parse incoming host
- classify host: dashboard host, platform wildcard host, custom domain, unknown host
- resolve to tenant/project
- inject tenant context into the request

**2. Domain management adapter**

Provider-specific logic. This is where Vercel lives.

- attach domain to hosting provider
- fetch required DNS records
- verify ownership/configuration
- detach domain
- report status

**3. Persistence**

Store provider-neutral domain state in the application database.

---

## Proposed data model

Add a dedicated `domain` table instead of overloading `project.customDomain`.

Suggested columns:

- `id`
- `projectId`
- `hostname`
- `kind` (`platform_subdomain`, `custom_subdomain`, `custom_apex`)
- `provider` (`vercel`, `self_hosted`)
- `status` (`pending`, `dns_required`, `ownership_verification_required`, `verifying`, `active`, `error`, `detached`)
- `isPrimary`
- `providerDomainId` or external reference
- `verificationPayload` JSON
- `dnsRecords` JSON
- `lastCheckedAt`
- `activatedAt`
- `errorMessage`
- timestamps

Migration strategy:

1. Create the new table.
2. Backfill existing `project.customDomain` rows into `domain`.
3. Keep `project.customDomain` temporarily as derived compatibility state.
4. Remove direct reliance on `project.customDomain` once reads are migrated.

---

## Adapter contract

Create a provider-neutral interface under a new domain service layer, for example:

`server/services/domains/provider.ts`

```ts
export interface DomainProvider {
  registerProjectDomain(input: { hostname: string }): Promise<DomainProviderRegistration>
  getDomainStatus(input: { hostname: string }): Promise<DomainProviderStatus>
  verifyProjectDomain(input: { hostname: string }): Promise<DomainProviderStatus>
  removeProjectDomain(input: { hostname: string }): Promise<void>
}
```

Suggested response shapes:

```ts
type RequiredDnsRecord = {
  type: 'A' | 'AAAA' | 'ALIAS' | 'CNAME' | 'TXT'
  name: string
  value: string
}

type DomainProviderRegistration = {
  hostname: string
  status: 'dns_required' | 'ownership_verification_required' | 'active'
  dnsRecords: RequiredDnsRecord[]
  raw: unknown
}

type DomainProviderStatus = {
  hostname: string
  verified: boolean
  status: 'dns_required' | 'ownership_verification_required' | 'active' | 'error'
  dnsRecords: RequiredDnsRecord[]
  raw: unknown
}
```

Initial implementations:

- `server/services/domains/providers/vercel.ts`
- later `server/services/domains/providers/self-hosted.ts`

Selection:

- choose provider via runtime config, e.g. `DOMAIN_PROVIDER=vercel`
- avoid hard-coding Vercel branching in route handlers

---

## Vercel implementation plan

### Platform wildcard domain

Production DNS requirements:

1. Move `veerify.io` to Vercel nameservers or follow Vercel's documented wildcard workaround if nameservers cannot move.
2. Add both `veerify.io` and `*.veerify.io` to the Vercel project.
3. Keep `app.veerify.io` as the dashboard host.
4. Keep `APP_DOMAIN=veerify.io` and `APP_DASHBOARD_DOMAIN=app.veerify.io`.

Acceptance criteria:

- any `tenant.veerify.io` resolves
- HTTPS works automatically
- app middleware resolves tenant from host

### Custom customer domains

Desired flow:

1. User enters a hostname in project settings.
2. App calls the Vercel provider adapter to register the domain on the current project.
3. App persists the provider response and required DNS records.
4. UI shows exact DNS records to create.
5. User clicks `Check DNS` or background polling refreshes status.
6. App calls provider status/verify endpoints.
7. When active, the domain is marked primary or available for public board access.

Expected DNS patterns in the UI:

- subdomain setup: usually one `CNAME`
- ownership verification setup: one `TXT` plus one `CNAME`
- apex setup later: one or more `A`/`ALIAS` records, optional `TXT`

### Vercel-specific operational notes

- Vercel may require TXT verification when the domain is already known to Vercel or when ownership must be proven.
- SSL provisioning is automatic after verification succeeds.
- The app should treat provider-returned DNS records as source of truth, not assume a fixed CNAME forever.

---

## Self-hosted implementation plan

The self-hosted provider must match the same adapter contract but use infrastructure-controlled primitives.

Likely responsibilities:

- validate DNS externally
- write host mappings into the proxy or service registry
- ensure certificates are issued and renewed
- detach host mappings cleanly

Likely infrastructure:

- DNS via Cloudflare or Route 53
- edge via Caddy, Traefik, or Nginx
- wildcard TLS for `*.veerify.io`
- per-domain cert issuance for custom domains

Important constraint:

- wildcard certs require DNS-based validation
- custom customer domains need certificate automation at the edge

The self-hosted provider should not require the app to know proxy-specific details beyond the adapter.

---

## API and service changes

### New service layer

Add:

- `server/services/domains/domain-service.ts`
- `server/services/domains/provider.ts`
- `server/services/domains/providers/vercel.ts`

Responsibilities:

- normalize hostnames
- enforce uniqueness
- call provider adapter
- persist status and DNS records
- expose project-level domain operations

### Existing API changes

Replace the current direct DNS-only approach with adapter-backed flow in:

- `server/api/projects/[slug].put.ts`
- `server/api/projects/[slug]/verify-domain.get.ts`

New endpoints likely needed:

- `POST /api/projects/[slug]/domains`
- `GET /api/projects/[slug]/domains`
- `POST /api/projects/[slug]/domains/:domainId/verify`
- `DELETE /api/projects/[slug]/domains/:domainId`
- optional `PATCH /api/projects/[slug]/domains/:domainId/primary`

### Host resolution updates

Request-time resolution should check:

1. exact custom domain match in `domain` table
2. fallback to platform wildcard subdomain logic
3. fallback to dashboard routes

This logic should live in a shared utility used by middleware and public route handlers.

---

## UI flow plan

### Domain settings screen

Replace the single custom-domain string field with a domain-management panel.

States:

- no custom domain
- entering domain
- dns setup required
- ownership verification required
- verifying
- active
- error

For each domain show:

- hostname
- status badge
- exact DNS records to set
- copy buttons
- last checked timestamp
- `Check DNS`
- `Set as primary`
- `Remove domain`

### Customer setup copy

Subdomain flow copy should read roughly:

1. Enter a hostname you control, for example `feedback.customer.com`.
2. Save the domain.
3. Add the DNS records shown below with your DNS provider.
4. Wait for propagation.
5. Click `Check DNS`.

Do not describe the setup as "set this ID as the CNAME".
Instead:

- show exact record rows from the provider
- explain that the CNAME target is usually stable
- explain that a TXT record may be required for ownership verification

### Validation rules

- reject bare dashboard domain and platform-owned hosts as custom domains
- reject duplicates globally
- normalize case and trailing dots
- reject invalid public suffixes and malformed hostnames
- initially reject apex domains if phase 1 ships subdomains only

---

## Testing plan

### Unit tests

- hostname normalization
- host classification
- provider adapter mapping from Vercel responses to internal status
- duplicate/ownership validation rules

### Integration tests

- add custom domain and persist provider-returned DNS requirements
- verify domain and transition status to active
- resolve incoming request by custom domain
- resolve incoming request by tenant wildcard host

### E2E tests

Add or update Playwright coverage for:

1. admin adds `feedback.customer.com`
2. UI displays required DNS records
3. simulated verification path marks the domain active
4. public board loads on custom domain
5. public board loads on `tenant.veerify.io`
6. login redirect still returns to the custom domain board

For local E2E:

- mock provider adapter responses
- do not depend on live Vercel APIs or real DNS propagation

---

## Implementation phases

### Phase 1: Refactor for adapter seam

- add `domain` table
- introduce domain service and provider interface
- move all domain logic behind the service
- keep current behavior working

### Phase 2: Vercel provider

- implement register/status/verify/remove
- store provider-returned DNS records
- update settings UI to display exact records

### Phase 3: Host resolution migration

- resolve custom domains from new table
- keep wildcard tenant path working
- remove direct coupling to `project.customDomain`

### Phase 4: UX and tests

- add richer domain management UI
- add Playwright coverage
- add background re-check or manual refresh UX

### Phase 5: Self-hosted provider

- implement parallel provider under same interface
- connect to proxy/cert automation layer
- validate no product/UI changes are needed

---

## Open questions

1. Should custom domains be scoped to projects or teams?
2. Should a project be allowed multiple active custom domains or only one primary plus aliases?
3. Do we want to support apex/root domains in the first customer-facing release?
4. Should domain verification poll in the background or remain manual?
5. Should self-hosted support ship with Caddy, Traefik, or only an abstract interface at first?

---

## Acceptance criteria

- `tenant.veerify.io` works in production through wildcard DNS and HTTPS
- customer custom subdomains can be added from product settings
- the UI shows provider-returned DNS records exactly
- TXT ownership verification is supported when required
- public board host resolution works for both wildcard and custom domains
- domain management logic is routed through a provider adapter
- adding a self-hosted provider does not require product/UI rewrites
