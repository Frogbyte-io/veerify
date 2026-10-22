import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { eq, inArray } from 'drizzle-orm'
import { db } from './helpers/db'
import {
  cleanupSupportPermissionFixture,
  createSupportPermissionFixture,
  type SupportPermissionFixture,
  type SupportPermissionRole,
} from './helpers/support-permissions'
import { getPlaywrightBaseURL, loginViaProgrammaticPage, withOriginHeaders } from './helpers/auth'
import { account, session, team, teamMember, user, verification } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  supportInbox,
  supportInboxMember,
  supportSendingDomain,
} from '../../server/database/schema/support'

/**
 * Customer sending domains (design §12).
 *
 * Needs the server started with SUPPORT_SENDING_DOMAINS_ENABLED=true and
 * SUPPORT_SENDING_DOMAIN_PROVIDER=fake (playwright.config.ts sets both unless the
 * caller exports them). The fake provider keys behaviour off the domain name:
 *   *.verify-ok.test       active after the first verify()
 *   *.owned-elsewhere.test owned_elsewhere
 *   *.flaky.test           provider_unavailable on the first register, then ok
 *
 * The "stubbed UI states" block uses page.route and only needs the page itself.
 */

test.setTimeout(90_000)

const PASSWORD = 'password123'
const SENDING_DOMAINS_PATH = (teamId: string) => `/api/support/teams/${teamId}/sending-domains`

type Credentials = { email: string; password: string }

test.describe('support sending domains', () => {
  let fixture: SupportPermissionFixture
  let suffix: string
  const contexts: BrowserContext[] = []

  // Team B: a second team with its own admin and inbox, for the isolation checks.
  const teamB = {
    id: `sd_team_b_${randomUUID().slice(0, 8)}`,
    inboxId: randomUUID(),
    memberId: randomUUID(),
    inboxMemberId: randomUUID(),
    userId: '',
    credentials: null as Credentials | null,
  }

  test.beforeAll(async ({ request }) => {
    suffix = randomUUID().slice(0, 8)
    fixture = await createSupportPermissionFixture(request)

    const [seedTeam] = await db.select().from(team).where(eq(team.id, fixture.teamId)).limit(1)
    if (!seedTeam) throw new Error('Seed team not found')

    teamB.credentials = { email: `sending-domains-team-b-${suffix}@example.com`, password: PASSWORD }
    const signUp = await request.post('/api/auth/sign-up/email', {
      headers: withOriginHeaders('/signup'),
      data: { name: 'Sending Domains Team B', ...teamB.credentials },
    })
    if (!signUp.ok()) throw new Error(`Could not sign up team B admin: ${signUp.status()} ${await signUp.text()}`)
    teamB.userId = (await signUp.json()).user.id as string

    const now = new Date()
    await db.insert(team).values({
      id: teamB.id,
      name: `Sending Domains Team B ${suffix}`,
      slug: `sd-team-b-${suffix}`,
      organizationId: seedTeam.organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(teamMember).values({
      id: teamB.memberId,
      teamId: teamB.id,
      userId: teamB.userId,
      role: 'admin',
      createdAt: now,
    })
    await db.insert(supportInbox).values({
      id: teamB.inboxId,
      teamId: teamB.id,
      name: `Team B Inbox ${suffix}`,
      slug: `team-b-${suffix}`,
      type: 'email',
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(supportInboxMember).values({
      id: teamB.inboxMemberId,
      inboxId: teamB.inboxId,
      userId: teamB.userId,
      role: 'admin',
      createdAt: now,
    })
  })

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    const teamIds = [teamB.id, fixture?.teamId].filter(Boolean) as string[]
    if (teamIds.length) await db.delete(supportSendingDomain).where(inArray(supportSendingDomain.teamId, teamIds))
    await db.delete(supportInboxMember).where(eq(supportInboxMember.id, teamB.inboxMemberId))
    await db.delete(supportInbox).where(eq(supportInbox.id, teamB.inboxId))
    await db.delete(teamMember).where(eq(teamMember.id, teamB.memberId))
    await db.delete(team).where(eq(team.id, teamB.id))
    if (teamB.credentials) await db.delete(verification).where(eq(verification.identifier, teamB.credentials.email))
    if (teamB.userId) {
      await db.delete(session).where(eq(session.userId, teamB.userId))
      await db.delete(account).where(eq(account.userId, teamB.userId))
      await db.delete(user).where(eq(user.id, teamB.userId))
    }
    if (fixture) await cleanupSupportPermissionFixture(fixture)
  })

  async function openPageAs(
    browser: Browser,
    credentials: Credentials,
    teamId: string,
    path: string,
    { clipboard = false }: { clipboard?: boolean } = {}
  ) {
    const baseURL = getPlaywrightBaseURL()
    const context = await browser.newContext({ baseURL })
    contexts.push(context)
    if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
    const page = await context.newPage()
    await loginViaProgrammaticPage(page, credentials)
    const activate = await page.request.post('/api/teams/active', {
      headers: withOriginHeaders('/support'),
      data: { teamId },
    })
    if (!activate.ok()) throw new Error(`Could not activate team ${teamId}: ${await activate.text()}`)
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/login/)
    return page
  }

  const settingsPath = () => `/support/settings?inboxId=${fixture.primaryInboxId}`
  const asRole = (role: SupportPermissionRole) => fixture.users[role]

  async function addDomainViaUi(page: Page, domain: string) {
    await page.getByTestId('support-sending-domain-add').click()
    await page.getByTestId('support-sending-domain-input').fill(domain)
    await page.getByTestId('support-sending-domain-add-submit').click()
  }

  const rowFor = (page: Page, domain: string) =>
    page
      .getByTestId('support-sending-domain-row')
      .filter({ has: page.locator(`[data-testid="support-sending-domain-name"]:text-is("${domain}")`) })

  test.describe.serial('against the fake provider', () => {
    let domainA = ''
    let domainAClaimId = ''

    test('admin adds a domain, copies the ownership record, verifies it and sends from it', async ({ browser }) => {
      domainA = `acme${suffix}.verify-ok.test`
      const page = await openPageAs(browser, asRole('teamAdmin'), fixture.teamId, settingsPath(), { clipboard: true })
      await expect(page.getByTestId('support-sending-domains')).toBeVisible({ timeout: 20_000 })

      await addDomainViaUi(page, domainA)
      const row = rowFor(page, domainA)
      await expect(row).toBeVisible()
      await expect(row.getByTestId('support-sending-domain-status')).toContainText('Waiting for DNS')

      // A freshly added domain opens its DNS table so the records can be published right away.
      // The toggle still collapses and re-opens it.
      const expand = row.getByTestId('support-sending-domain-expand')
      await expect(expand).toHaveAttribute('aria-expanded', 'true')
      await expand.click()
      await expect(expand).toHaveAttribute('aria-expanded', 'false')
      await expect(row.getByTestId('support-dns-record-row')).toHaveCount(0)
      await expand.click()

      // The ownership row comes first in the DNS table.
      const records = row.getByTestId('support-dns-record-row')
      await expect(records.first()).toHaveAttribute('data-purpose', 'ownership')
      const ownershipValue = (await records.first().getByTestId('support-dns-record-value').innerText()).trim()
      expect(ownershipValue).toContain('veerify-mail-verification=')

      await records.first().getByTestId('support-dns-record-copy-value').click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ownershipValue)

      // Verify now flips the status. The poll interval is 30s, so click rather than wait.
      await row.getByTestId('support-sending-domain-verify').click()
      await expect(row.getByTestId('support-sending-domain-status')).toContainText('Verified', { timeout: 20_000 })

      // The picker offers the verified domain; saving yields an authorized verdict.
      const listResponse = await page.request.get(SENDING_DOMAINS_PATH(fixture.teamId))
      const list = (await listResponse.json()).data
      domainAClaimId = list.domains.find((d: { domain: string }) => d.domain === domainA).id
      expect(domainAClaimId).toBeTruthy()

      await page.reload({ waitUntil: 'domcontentloaded' })
      const picker = page.getByTestId('support-from-picker')
      await expect(picker).toHaveAttribute('data-policy', 'team', { timeout: 20_000 })
      await picker.getByTestId('support-from-picker-local').fill('support')
      await picker.getByTestId('support-from-picker-select').selectOption({ value: `domain:${domainA}` })
      await page.getByTestId('support-inbox-settings-save').click()
      await expect(page.getByTestId('support-settings-sending-authorized')).toBeVisible({ timeout: 20_000 })

      const status = await page.request.get(`/api/support/inboxes/${fixture.primaryInboxId}/sending-status`)
      const verdict = (await status.json()).data
      expect(verdict.address).toBe(`support@${domainA}`)
      expect(verdict.authorization.status).toBe('authorized')
    })

    test('provider refusals show inline and a flaky registration recovers on retry', async ({ browser }) => {
      const page = await openPageAs(browser, asRole('teamAdmin'), fixture.teamId, settingsPath())
      await expect(page.getByTestId('support-sending-domains')).toBeVisible({ timeout: 20_000 })

      await addDomainViaUi(page, `x${suffix}.owned-elsewhere.test`)
      const inlineError = page.getByTestId('support-sending-domain-add-error')
      await expect(inlineError).toBeVisible()
      await expect(inlineError).toContainText(/another service|already used/i)
      await page.keyboard.press('Escape')

      const flaky = `y${suffix}.flaky.test`
      await addDomainViaUi(page, flaky)
      const row = rowFor(page, flaky)
      await expect(row.getByTestId('support-sending-domain-status')).toContainText('Failed')
      await row.getByRole('button', { name: 'Retry' }).click()
      await expect(row.getByTestId('support-sending-domain-status')).toContainText('Waiting for DNS', {
        timeout: 20_000,
      })
    })

    test('a team member sees the card read-only and the API refuses their writes', async ({ browser }) => {
      const page = await openPageAs(browser, asRole('agent'), fixture.teamId, settingsPath())
      const card = page.getByTestId('support-sending-domains')
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(rowFor(page, domainA)).toBeVisible()
      await expect(page.getByTestId('support-sending-domain-add')).toHaveCount(0)
      await expect(page.getByTestId('support-sending-domain-verify')).toHaveCount(0)
      await expect(page.getByTestId('support-sending-domain-delete')).toHaveCount(0)

      const headers = withOriginHeaders('/support/settings')
      const create = await page.request.post(SENDING_DOMAINS_PATH(fixture.teamId), {
        headers,
        data: { domain: `member${suffix}.verify-ok.test` },
      })
      expect(create.status()).toBe(403)
      const verify = await page.request.post(`${SENDING_DOMAINS_PATH(fixture.teamId)}/${domainAClaimId}/verify`, {
        headers,
      })
      expect(verify.status()).toBe(403)
      const del = await page.request.delete(`${SENDING_DOMAINS_PATH(fixture.teamId)}/${domainAClaimId}`, { headers })
      expect(del.status()).toBe(403)
    })

    test('another team cannot read, claim under, or send from a team’s domain', async ({ browser }) => {
      const page = await openPageAs(browser, teamB.credentials!, teamB.id, '/support/settings')
      const headers = withOriginHeaders('/support/settings')

      const detail = await page.request.get(`${SENDING_DOMAINS_PATH(teamB.id)}/${domainAClaimId}`, { headers })
      expect(detail.status()).toBe(404)
      const crossTeam = await page.request.get(`${SENDING_DOMAINS_PATH(fixture.teamId)}/${domainAClaimId}`, { headers })
      expect([403, 404]).toContain(crossTeam.status())

      const claim = await page.request.post(SENDING_DOMAINS_PATH(teamB.id), {
        headers,
        data: { domain: `mail.${domainA}` },
      })
      expect(claim.status()).toBe(409)
      const claimBody = await claim.json()
      expect(claimBody.error?.code ?? claimBody.data?.error?.code).toBe('DOMAIN_CLAIMED')

      const save = await page.request.put(`/api/support/inboxes/${teamB.inboxId}`, {
        headers,
        data: { name: `Team B Inbox ${suffix}`, emailAddress: `support@${domainA}` },
      })
      expect(save.status()).toBe(422)

      const own = await page.request.get(SENDING_DOMAINS_PATH(teamB.id), { headers })
      const ownList = (await own.json()).data
      expect(ownList.domains.map((d: { domain: string }) => d.domain)).not.toContain(domainA)
    })

    test('deleting a domain an inbox uses asks first, then blocks that inbox from sending', async ({ browser }) => {
      const page = await openPageAs(browser, asRole('teamAdmin'), fixture.teamId, settingsPath())
      const row = rowFor(page, domainA)
      await expect(row).toBeVisible({ timeout: 20_000 })

      await row.getByTestId('support-sending-domain-delete').click()
      await page.getByTestId('support-sending-domain-delete-confirm').click()

      const inUse = page.getByTestId('support-sending-domain-in-use')
      await expect(inUse).toBeVisible()
      await expect(page.getByTestId('support-sending-domain-in-use-inbox').first()).toContainText(
        fixture.primaryInboxName
      )

      await page.getByTestId('support-sending-domain-delete-confirm').click()
      await expect(rowFor(page, domainA)).toHaveCount(0, { timeout: 20_000 })

      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/support/inboxes/${fixture.primaryInboxId}/sending-status`)
            return (await response.json()).data?.authorization?.status
          },
          { timeout: 20_000 }
        )
        .toBe('unauthorized')
    })
  })

  // UI-only states. Every sending-domain and sending-status response is stubbed, so
  // these need the page and a logged-in team admin but no provider behaviour.
  test.describe('stubbed UI states', () => {
    const LIST_URL = /\/api\/support\/teams\/[^/]+\/sending-domains(\?.*)?$/
    const ITEM_URL = /\/api\/support\/teams\/[^/]+\/sending-domains\/[^/?]+(\?.*)?$/
    const STATUS_URL = /\/api\/support\/inboxes\/[^/]+\/sending-status(\?.*)?$/

    const record = (overrides: Record<string, unknown> = {}) => ({
      purpose: 'ownership',
      type: 'TXT',
      name: '_veerify-mail.stub.example.com',
      value: 'veerify-mail-verification=abc123',
      status: 'unknown',
      ...overrides,
    })

    const domainRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'stub-domain-1',
      domain: 'stub.example.com',
      status: 'pending',
      providerState: 'unverified',
      ownershipVerified: false,
      receivesViaProvider: false,
      records: [record()],
      lastCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      nextCheckAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      verifiedAt: null,
      lastErrorCode: null,
      lastError: null,
      providerOwnership: 'created',
      providerMismatch: false,
      ...overrides,
    })

    const listPayload = (overrides: Record<string, unknown> = {}) => ({
      enabled: true,
      policy: 'team',
      provider: 'mailgun',
      capabilities: { register: true, verifyNow: true, remove: true, inboundRoutes: true, authorizesSubdomains: true },
      canManage: true,
      limits: { maxDomains: 10, maxPending: 3, pendingTtlDays: 7 },
      providerConfigured: true,
      missingEnvVars: [],
      domains: [domainRow()],
      ...overrides,
    })

    const ok = (data: unknown, status = 200) => ({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    })

    async function openStubbed(
      browser: Browser,
      // eslint-disable-next-line no-unused-vars
      handlers: { list?: () => unknown; status?: () => unknown; onItem?: (httpMethod: string) => unknown }
    ) {
      const baseURL = getPlaywrightBaseURL()
      const context = await browser.newContext({ baseURL })
      contexts.push(context)
      const page = await context.newPage()
      await loginViaProgrammaticPage(page, asRole('teamAdmin'))
      const activate = await page.request.post('/api/teams/active', {
        headers: withOriginHeaders('/support'),
        data: { teamId: fixture.teamId },
      })
      if (!activate.ok()) throw new Error(`Could not activate the fixed team: ${await activate.text()}`)

      if (handlers.list) {
        await page.route(LIST_URL, (route) =>
          route.request().method() === 'GET' ? route.fulfill(handlers.list!() as never) : route.fallback()
        )
      }
      if (handlers.onItem) {
        await page.route(ITEM_URL, (route) => {
          const response = handlers.onItem!(route.request().method())
          return response ? route.fulfill(response as never) : route.fallback()
        })
      }
      if (handlers.status) await page.route(STATUS_URL, (route) => route.fulfill(handlers.status!() as never))
      await page.goto(settingsPath(), { waitUntil: 'domcontentloaded' })
      return page
    }

    test('suspended, removing and failed rows render their labels and reasons', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () =>
          ok(
            listPayload({
              domains: [
                domainRow({ id: 'd-s', domain: 'suspended.example.com', status: 'suspended' }),
                domainRow({ id: 'd-r', domain: 'removing.example.com', status: 'deleting' }),
                domainRow({
                  id: 'd-f',
                  domain: 'failed.example.com',
                  status: 'failed',
                  lastError: 'Provider is unavailable',
                }),
              ],
            })
          ),
      })
      const suspended = rowFor(page, 'suspended.example.com')
      await expect(suspended.getByTestId('support-sending-domain-status')).toContainText('Suspended', {
        timeout: 20_000,
      })
      await expect(suspended.getByTestId('support-sending-domain-reason')).toContainText('DNS records no longer found')

      const removing = rowFor(page, 'removing.example.com')
      await expect(removing.getByTestId('support-sending-domain-status')).toContainText('Removing')
      await expect(removing.getByTestId('support-sending-domain-verify')).toBeDisabled()
      await expect(removing.getByTestId('support-sending-domain-delete')).toBeDisabled()

      const failed = rowFor(page, 'failed.example.com')
      await expect(failed.getByTestId('support-sending-domain-status')).toContainText('Failed')
      await expect(failed.getByTestId('support-sending-domain-reason')).toContainText('Provider is unavailable')
      await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible()
    })

    test('receiving_enabled deletion explains the operator step', async ({ browser }) => {
      let deleted = false
      const page = await openStubbed(browser, {
        list: () => ok(listPayload({ domains: deleted ? [] : [domainRow({ status: 'verified' })] })),
        onItem: (method) => {
          if (method !== 'DELETE') return null
          deleted = true
          return ok({ deleted: true, operatorCleanupRequired: true })
        },
      })
      const row = rowFor(page, 'stub.example.com')
      await expect(row).toBeVisible({ timeout: 20_000 })
      await row.getByTestId('support-sending-domain-delete').click()
      await page.getByTestId('support-sending-domain-delete-confirm').click()
      await expect(page.getByText(/Your operator must remove it from the mail provider/)).toBeVisible()
      await expect(rowFor(page, 'stub.example.com')).toHaveCount(0)
    })

    test('the in-use dialog lists inboxes from a 409 DOMAIN_IN_USE', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () => ok(listPayload({ domains: [domainRow({ status: 'verified' })] })),
        onItem: (method) =>
          method === 'DELETE'
            ? {
                status: 409,
                contentType: 'application/json',
                // The H3 error body: our createErrorResponse() envelope sits under `data`.
                body: JSON.stringify({
                  statusCode: 409,
                  statusMessage: 'Conflict',
                  data: {
                    success: false,
                    error: {
                      code: 'DOMAIN_IN_USE',
                      message: 'In use',
                      details: { inboxes: [{ id: 'i1', name: 'Billing', emailAddress: 'billing@stub.example.com' }] },
                    },
                  },
                }),
              }
            : null,
      })
      await rowFor(page, 'stub.example.com').getByTestId('support-sending-domain-delete').click()
      await page.getByTestId('support-sending-domain-delete-confirm').click()
      await expect(page.getByTestId('support-sending-domain-in-use-inbox')).toContainText('Billing')
      await expect(page.getByTestId('support-sending-domain-delete-confirm')).toContainText('Delete anyway')
    })

    test('the card shows an error with retry, and hides itself when the feature is off', async ({ browser }) => {
      let failing = true
      const page = await openStubbed(browser, {
        list: () =>
          failing
            ? {
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({
                  statusCode: 500,
                  statusMessage: 'Internal Server Error',
                  data: { success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } },
                }),
              }
            : ok(listPayload({ enabled: false, policy: 'legacy', domains: [] })),
      })
      await expect(page.getByTestId('support-sending-domains-error')).toBeVisible({ timeout: 20_000 })
      failing = false
      await page.getByTestId('support-sending-domains-error').getByRole('button', { name: 'Retry' }).click()
      await expect(page.getByTestId('support-sending-domains')).toHaveCount(0)
      // Feature off: the From field falls back to the free-text input.
      await expect(page.getByTestId('support-from-picker')).toHaveAttribute('data-policy', 'legacy')
      await expect(page.getByTestId('support-from-picker-input')).toBeVisible()
    })

    test('list-only providers show the operator note instead of provider records', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () =>
          ok(
            listPayload({
              provider: 'postmark',
              capabilities: {
                register: false,
                verifyNow: false,
                remove: false,
                inboundRoutes: false,
                authorizesSubdomains: false,
              },
              domains: [
                domainRow({
                  records: [
                    record(),
                    record({ purpose: 'sending', type: 'CNAME', name: 'dkim._domainkey.stub.example.com', value: 'x' }),
                  ],
                }),
              ],
            })
          ),
      })
      const row = rowFor(page, 'stub.example.com')
      await row.getByTestId('support-sending-domain-expand').click({ timeout: 20_000 })
      await expect(row.getByTestId('support-dns-operator-managed')).toBeVisible()
      await expect(row.getByTestId('support-dns-record-row')).toHaveCount(1)
    })

    for (const scenario of [
      {
        name: 'pending',
        authorization: { status: 'pending', domain: { id: 'd1', domain: 'stub.example.com', status: 'pending' } },
        testId: 'support-settings-sending-pending',
        text: 'Replies are blocked until stub.example.com is verified',
      },
      {
        name: 'unauthorized (suspended)',
        authorization: { status: 'unauthorized', reason: 'suspended', teamDomains: [] },
        testId: 'support-settings-sending-unauthorized',
        text: 'is suspended',
      },
      {
        name: 'unauthorized (not_owned)',
        authorization: { status: 'unauthorized', reason: 'not_owned', teamDomains: ['owned.example.com'] },
        testId: 'support-settings-sending-unauthorized',
        text: 'owned.example.com',
      },
      {
        name: 'unauthorized (provider_mismatch)',
        authorization: { status: 'unauthorized', reason: 'provider_mismatch', teamDomains: [] },
        testId: 'support-settings-sending-unauthorized',
        text: 'Register the domain again',
      },
    ] as const) {
      test(`team policy renders the ${scenario.name} sending verdict`, async ({ browser }) => {
        const page = await openStubbed(browser, {
          list: () => ok(listPayload()),
          status: () =>
            ok({ address: 'support@stub.example.com', policy: 'team', authorization: scenario.authorization }),
        })
        await expect(page.getByTestId(scenario.testId)).toContainText(scenario.text, { timeout: 20_000 })
      })
    }

    test('the picker composes local part, verified domain and subdomain into the saved From address', async ({
      browser,
    }) => {
      const page = await openStubbed(browser, {
        list: () =>
          ok(
            listPayload({
              domains: [
                domainRow({ id: 'd-v', domain: 'verified.example.com', status: 'verified' }),
                domainRow({ id: 'd-p', domain: 'pending.example.com', status: 'pending' }),
              ],
            })
          ),
      })
      const picker = page.getByTestId('support-from-picker')
      await expect(picker).toHaveAttribute('data-policy', 'team', { timeout: 20_000 })
      const options = picker.getByTestId('support-from-picker-select').locator('option')
      await expect(options.filter({ hasText: 'pending.example.com (waiting for DNS)' })).toHaveCount(1)

      let saved: Record<string, unknown> | null = null
      await page.route(/\/api\/support\/inboxes\/[^/]+(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback()
        saved = route.request().postDataJSON()
        return route.fallback()
      })

      await picker.getByTestId('support-from-picker-local').fill('help')
      await picker.getByTestId('support-from-picker-select').selectOption({ value: 'domain:verified.example.com' })
      await picker.getByTestId('support-from-picker-use-subdomain').click()
      await picker.getByTestId('support-from-picker-subdomain').fill('mail')
      await page.getByTestId('support-inbox-settings-save').click()
      await expect.poll(() => saved?.emailAddress).toBe('help@mail.verified.example.com')
    })

    test('legacy policy keeps the free-text From input and provider wording', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () => ok(listPayload({ enabled: false, policy: 'legacy', domains: [] })),
        status: () =>
          ok({
            address: 'support@other.example.com',
            policy: 'legacy',
            authorization: { status: 'unauthorized', reason: 'not_owned', teamDomains: [] },
          }),
      })
      await expect(page.getByTestId('support-from-picker-input')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('support-settings-sending-unauthorized')).toContainText(
        'is not on a domain your provider is verified to send from'
      )
    })

    test('the channel card shows the platform forwarding address with a copy button', async ({ browser }) => {
      const baseURL = getPlaywrightBaseURL()
      const page = await openStubbed(browser, { list: () => ok(listPayload()) })
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
      await page.route(/\/api\/support\/channel-status(\?.*)?$/, async (route) => {
        const response = await route.fetch()
        const payload = await response.json()
        payload.data = { ...payload.data, platformAddress: 'acme-support-k3m9qz@veerifymail.test' }
        await route.fulfill({ response, json: payload })
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      const input = page.getByTestId('support-settings-channel-platform-forward')
      await expect(input).toHaveValue('acme-support-k3m9qz@veerifymail.test', { timeout: 20_000 })
      await page.getByTestId('support-settings-platform-copy').click()
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe('acme-support-k3m9qz@veerifymail.test')
    })

    const stubChannelStatus = async (page: Page, patch: Record<string, unknown>) => {
      await page.route(/\/api\/support\/channel-status(\?.*)?$/, async (route) => {
        const response = await route.fetch()
        const payload = await response.json()
        payload.data = { ...payload.data, ...patch }
        await route.fulfill({ response, json: payload })
      })
    }

    test('a subdomain claim shows hosts relative to the registrable domain and the full name', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () =>
          ok(
            listPayload({
              domains: [
                domainRow({
                  id: 'd-sub',
                  domain: 'mail.stub.example.com',
                  registrableDomain: 'stub.example.com',
                  records: [record({ name: '_veerify-mail.mail.stub.example.com' })],
                }),
              ],
            })
          ),
      })
      const row = rowFor(page, 'mail.stub.example.com')
      await row.getByTestId('support-sending-domain-expand').click({ timeout: 20_000 })
      await expect(row.getByTestId('support-dns-zone-note')).toContainText('stub.example.com')
      await expect(row.getByTestId('support-dns-record-host')).toHaveText('_veerify-mail.mail')
      await expect(row.getByTestId('support-dns-record-fqdn')).toHaveText('_veerify-mail.mail.stub.example.com')
    })

    test('a response without registrableDomain falls back to the claimed domain as the zone', async ({ browser }) => {
      const page = await openStubbed(browser, { list: () => ok(listPayload()) })
      const row = rowFor(page, 'stub.example.com')
      await row.getByTestId('support-sending-domain-expand').click({ timeout: 20_000 })
      await expect(row.getByTestId('support-dns-record-host')).toHaveText('_veerify-mail')
    })

    test('a 202 delete answer says the removal is in progress', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () => ok(listPayload({ domains: [domainRow({ status: 'verified' })] })),
        onItem: (method) => (method === 'DELETE' ? ok({ deleted: false }, 202) : null),
      })
      await rowFor(page, 'stub.example.com').getByTestId('support-sending-domain-delete').click({ timeout: 20_000 })
      await page.getByTestId('support-sending-domain-delete-confirm').click()
      await expect(page.getByText('Removal in progress')).toBeVisible()
    })

    test('team policy with the feature off still renders the picker and the forwarding button', async ({ browser }) => {
      const page = await openStubbed(browser, {
        list: () => ok(listPayload({ enabled: false, policy: 'team', domains: [] })),
      })
      await stubChannelStatus(page, { platformForwardingEnabled: true, platformAddress: null })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('support-sending-domains')).toHaveCount(0)
      await expect(page.getByTestId('support-from-picker')).toHaveAttribute('data-policy', 'team', {
        timeout: 20_000,
      })
      await expect(page.getByTestId('support-settings-platform-create')).toBeVisible()
    })

    test('the forwarding button follows platformForwardingEnabled, not the sending-domains flag', async ({
      browser,
    }) => {
      const page = await openStubbed(browser, { list: () => ok(listPayload()) })
      await stubChannelStatus(page, { platformForwardingEnabled: false, platformAddress: null })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('support-sending-domains')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('support-settings-channel-webhook')).toBeVisible()
      await expect(page.getByTestId('support-settings-platform-create')).toHaveCount(0)
    })

    test('platform rows cannot be removed and regenerating asks first', async ({ browser }) => {
      const page = await openStubbed(browser, { list: () => ok(listPayload()) })
      await stubChannelStatus(page, {
        platformForwardingEnabled: true,
        platformAddress: 'acme-support-k3m9qz@veerifymail.test',
      })
      await page.route(/\/api\/support\/inboxes\/[^/]+\/addresses(\?.*)?$/, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill(
              ok({
                addresses: [
                  {
                    id: 'addr-platform',
                    address: 'acme-support-k3m9qz@veerifymail.test',
                    kind: 'platform',
                    isPrimary: false,
                    projectId: null,
                  },
                  {
                    id: 'addr-own',
                    address: 'help@stub.example.com',
                    kind: 'custom',
                    isPrimary: true,
                    projectId: null,
                  },
                ],
              }) as never
            )
          : route.fallback()
      )
      let body: unknown = null
      await page.route(/\/api\/support\/inboxes\/[^/]+\/addresses\/platform(\?.*)?$/, (route) => {
        body = route.request().postDataJSON()
        return route.fulfill(
          ok({
            address: { id: 'addr-platform-2', address: 'acme-support-n3w0aa@veerifymail.test' },
            created: true,
          }) as never
        )
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Remove receiving address help@stub.example.com' })).toBeVisible({
        timeout: 20_000,
      })
      await expect(
        page.getByRole('button', { name: 'Remove receiving address acme-support-k3m9qz@veerifymail.test' })
      ).toHaveCount(0)

      await page.getByTestId('support-settings-platform-regenerate').click()
      await expect(page.getByRole('dialog', { name: 'Regenerate forwarding address' })).toContainText(
        'old address stops working'
      )
      expect(body).toBeNull()
      await page.getByTestId('support-regenerate-platform-confirm').click()
      await expect.poll(() => body).toEqual({ regenerate: true })
    })

    test('the picker never emits a partial address and Save stays disabled while it is incomplete', async ({
      browser,
    }) => {
      const page = await openStubbed(browser, {
        list: () =>
          ok(listPayload({ domains: [domainRow({ id: 'd-v', domain: 'verified.example.com', status: 'verified' })] })),
      })
      await stubChannelStatus(page, {
        platformForwardingEnabled: true,
        platformAddress: 'acme-support-k3m9qz@veerifymail.test',
      })
      await page.reload({ waitUntil: 'domcontentloaded' })
      const picker = page.getByTestId('support-from-picker')
      const select = picker.getByTestId('support-from-picker-select')
      await expect(picker).toHaveAttribute('data-policy', 'team', { timeout: 20_000 })

      let saved: Record<string, unknown> | null = null
      await page.route(/\/api\/support\/inboxes\/[^/]+(\?.*)?$/, async (route) => {
        if (route.request().method() === 'PUT') saved = route.request().postDataJSON()
        return route.fallback()
      })

      // Start with an empty local part so the state does not depend on the inbox's saved address.
      await picker.getByTestId('support-from-picker-local').fill('')
      // Platform option, then a domain with no local part: the platform address is kept and Save is blocked.
      await select.selectOption({ value: 'platform:acme-support-k3m9qz@veerifymail.test' })
      const save = page.getByTestId('support-inbox-settings-save')
      await expect(save).toBeEnabled()
      await select.selectOption({ value: 'domain:verified.example.com' })
      await expect(picker.getByTestId('support-from-picker-error')).toBeVisible()
      await expect(save).toBeDisabled()

      await picker.getByTestId('support-from-picker-local').fill('help')
      await expect(picker.getByTestId('support-from-picker-error')).toHaveCount(0)
      await expect(save).toBeEnabled()
      await save.click()
      await expect.poll(() => saved?.emailAddress).toBe('help@verified.example.com')
    })

    test('an outbox message blocked by the sender check explains itself and skips the duplicate prompt', async ({
      browser,
    }) => {
      const page = await openStubbed(browser, { list: () => ok(listPayload()) })
      const customerEmail = `blocked-sender-${suffix}@example.com`
      let conversationId = ''
      try {
        const post = (url: string, data: unknown) =>
          page.request.post(url, { headers: withOriginHeaders('/support'), data })
        const contactResponse = await post('/api/support/contacts', {
          teamId: fixture.teamId,
          name: 'Blocked Sender Customer',
          email: customerEmail,
        })
        expect(contactResponse.ok()).toBeTruthy()
        const contactId = (await contactResponse.json()).data.contact.id as string
        const conversationResponse = await post('/api/support/conversations', {
          inboxId: fixture.primaryInboxId,
          contactId,
          subject: 'Blocked sender',
        })
        expect(conversationResponse.ok()).toBeTruthy()
        conversationId = (await conversationResponse.json()).data.conversation.id as string

        const blocked = (extra: Record<string, unknown>) => ({
          id: 'blocked-msg',
          conversationId,
          kind: 'outgoing',
          body: 'Hello',
          bodyHtml: null,
          senderKind: 'agent',
          senderUserId: null,
          senderContactId: null,
          isPrivate: false,
          deliveryStatus: 'failed',
          attachments: [],
          createdAt: new Date().toISOString(),
          ...extra,
        })
        let messages = [blocked({ lastError: 'SENDER_DOMAIN_NOT_AUTHORIZED' })]
        let retries = 0
        await page.route(`**/api/support/conversations/${conversationId}/messages`, (route) =>
          route.request().method() === 'GET'
            ? route.fulfill(ok({ messages, hasMore: false }) as never)
            : route.fallback()
        )
        await page.route(`**/api/support/conversations/${conversationId}/messages/blocked-msg/retry`, (route) => {
          retries += 1
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 409,
              statusMessage: 'Conflict',
              data: { success: false, error: { code: 'SENDER_NOT_VERIFIED', message: 'Sender not verified' } },
            }),
          })
        })
        let dialogs = 0
        page.on('dialog', async (dialog) => {
          dialogs += 1
          await dialog.dismiss()
        })

        await page.goto(`/support?inboxId=${fixture.primaryInboxId}&conversationId=${conversationId}`, {
          waitUntil: 'domcontentloaded',
        })
        const notice = page.getByTestId('support-message-sender-blocked')
        await expect(notice).toContainText("this inbox's From address isn't verified for your team", {
          timeout: 30_000,
        })
        await expect(page.getByTestId('support-message-sender-link')).toHaveAttribute('href', '/support/settings')
        await page.getByTestId('support-message-retry').click()
        await expect.poll(() => retries).toBe(1)
        expect(dialogs).toBe(0)

        // retryable:false hides Retry, and a plain failure keeps the generic label.
        messages = [blocked({ lastError: null, retryable: false })]
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.getByTestId('support-message-delivery-failed')).toContainText('Failed to send', {
          timeout: 30_000,
        })
        await expect(page.getByTestId('support-message-retry')).toHaveCount(0)
      } finally {
        if (conversationId) await db.delete(conversation).where(eq(conversation.id, conversationId))
        await db.delete(contact).where(eq(contact.email, customerEmail))
      }
    })
  })
})
