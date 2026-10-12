import { expect, test, type Page } from '@playwright/test'
import { and, eq } from 'drizzle-orm'
import { teamMember } from '../../server/database/schema/auth'
import { db } from './helpers/db'
import { loginViaProgrammaticPage } from './helpers/auth'
import { getActiveTeamViaApi } from './helpers/teams'

/**
 * Marketing Hub smoke coverage. Everything is seeded through the API and no
 * test reaches an external network (no audits, provider calls or polling).
 * The tests share one product and run serially: the first enables the modules.
 */
const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const TEAM_SLUG = process.env.E2E_TEAM_SLUG || 'preview-org'
const PORT = process.env.PLAYWRIGHT_PORT || 4173

const RUN = Date.now()
const PRODUCT_SLUG = `e2e-marketing-${RUN}`

type ModuleSettings = Record<string, boolean>

let teamId = ''
let projectId = ''
let originalModules: ModuleSettings | null = null
let promotedMembershipId: string | null = null

test.describe.configure({ mode: 'serial' })

async function login(page: Page) {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  if (!teamId) teamId = (await getActiveTeamViaApi(page.request)).id
}

// The module toggle needs a team admin and the seed user is a `member`: promote
// for the duration of this file and restore in afterAll (as the support specs do).
async function promoteSeedUserToAdmin(page: Page) {
  const sessionResponse = await page.request.get('/api/auth/session')
  const userId = (await sessionResponse.json()).data.user.id as string
  const [membership] = await db
    .select({ id: teamMember.id, role: teamMember.role })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1)
  expect(membership).toBeTruthy()
  if (membership.role !== 'admin') {
    await db.update(teamMember).set({ role: 'admin' }).where(eq(teamMember.id, membership.id))
    promotedMembershipId = membership.id
  }
}

async function putTeamModules(page: Page, modules: ModuleSettings) {
  const response = await page.request.put(`/api/teams/${teamId}/modules`, { data: modules })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test.afterAll(async ({ browser }) => {
  // Restore the team's module switches so later specs see the seeded state.
  if (!originalModules || !teamId) {
    if (promotedMembershipId)
      await db.update(teamMember).set({ role: 'member' }).where(eq(teamMember.id, promotedMembershipId))
    return
  }
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await putTeamModules(page, originalModules)
  } finally {
    await context.close()
    if (promotedMembershipId) {
      await db.update(teamMember).set({ role: 'member' }).where(eq(teamMember.id, promotedMembershipId))
    }
  }
})

test('marketing is gated by the team module and the product toggle', async ({ page }) => {
  await login(page)
  await promoteSeedUserToAdmin(page)

  const modulesResponse = await page.request.get(`/api/teams/${teamId}/modules`)
  expect(modulesResponse.ok()).toBeTruthy()
  originalModules = (await modulesResponse.json()).data.modules as ModuleSettings

  const createResponse = await page.request.post(`/api/teams/${teamId}/projects`, {
    data: { name: `E2E Marketing ${RUN}`, slug: PRODUCT_SLUG, description: null, customDomain: null },
  })
  expect(createResponse.status()).toBe(201)
  projectId = (await createResponse.json()).data.id as string
  expect(projectId).toBeTruthy()

  await putTeamModules(page, { marketingEnabled: false, changelogEnabled: true })

  await page.goto(`/marketing?product=${PRODUCT_SLUG}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('marketing-disabled')).toBeVisible({ timeout: 30_000 })
  // The sidebar is client-only: wait for it to mount before asserting the group is absent.
  await expect(page.getByTestId('app-sidebar')).toBeVisible()
  await expect(page.getByTestId('sidebar-marketing-group')).toHaveCount(0)

  await putTeamModules(page, { marketingEnabled: true })
  const productResponse = await page.request.put(`/api/projects/${PRODUCT_SLUG}`, {
    data: { settings: { marketingEnabled: true, changelogEnabled: true } },
  })
  expect(productResponse.ok()).toBeTruthy()

  await page.goto(`/marketing?product=${PRODUCT_SLUG}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('marketing-setup')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('sidebar-marketing-group')).toBeVisible()
  await expect(page.getByTestId('marketing-disabled')).toHaveCount(0)
})

test('marketing settings persist the site, brand term and competitor', async ({ page }) => {
  await login(page)
  const origin = `e2e-${RUN}.example.com`
  const brand = `Brand ${RUN}`
  const competitor = `Rival ${RUN}`
  const competitorDomain = `rival-${RUN}.example.com`

  await page.goto(`/marketing/settings?product=${PRODUCT_SLUG}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('marketing-settings-site')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('marketing-site-origin').fill(origin)
  await page.getByRole('button', { name: 'Add site' }).click()

  const verification = page.getByTestId('marketing-site-verification')
  await expect(verification).toBeVisible()
  await expect(page.getByTestId('marketing-site-unverified')).toBeVisible()
  await expect(verification).toContainText('TXT record')
  await verification.getByRole('button', { name: 'Meta tag' }).click()
  await expect(verification).toContainText('<head>')
  await verification.getByRole('button', { name: 'File' }).click()
  await expect(verification).toContainText('File content')

  await page.getByTestId('marketing-terms-add-brand').click()
  await page.locator('#new-label-brand').fill(brand)
  await page.getByTestId('marketing-terms-brand').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByTestId('marketing-terms-brand')).toContainText(brand)

  await page.getByTestId('marketing-terms-add-competitor').click()
  await page.locator('#new-label-competitor').fill(competitor)
  await page.locator('#new-domain-competitor').fill(competitorDomain)
  await page.getByTestId('marketing-terms-competitor').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByTestId('marketing-terms-competitor')).toContainText(competitor)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('marketing-site-origin')).toHaveValue(new RegExp(origin), { timeout: 30_000 })
  await expect(page.getByTestId('marketing-terms-brand')).toContainText(brand)
  await expect(page.getByTestId('marketing-terms-competitor')).toContainText(competitor)
  await expect(page.getByTestId('marketing-terms-competitor')).toContainText(competitorDomain)
})

test('launch kit status updates progress and the overview card', async ({ page }) => {
  await login(page)

  await page.goto(`/marketing/launch?product=${PRODUCT_SLUG}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('launch-progress-summary')).toContainText(/^\s*0 of \d+ done/, { timeout: 30_000 })

  await page.getByTestId('launch-status-product-hunt').click()
  await page.getByRole('menuitem', { name: 'Live' }).click()

  await expect(page.getByTestId('launch-status-product-hunt')).toContainText('Live')
  await expect(page.getByTestId('launch-progress-summary')).toContainText(/^\s*1 of \d+ done/)
  await expect(page.getByTestId('launch-count-live')).toContainText('1')

  await page.goto(`/marketing?product=${PRODUCT_SLUG}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('marketing-card-launch-kit')).toContainText(/1\s*\/\s*\d+\s*live/, {
    timeout: 30_000,
  })
})

test('published changelog entry appears on the public page and RSS feed', async ({ page }) => {
  await login(page)
  const title = `E2E marketing release ${RUN}`

  const createResponse = await page.request.post(`/api/changelog/projects/${projectId}/entries`, {
    data: { title, summary: 'Shipped for the marketing e2e', body: 'Details of the release.', labels: ['new'] },
  })
  expect(createResponse.ok()).toBeTruthy()
  const entry = (await createResponse.json()).data as { id: string; slug: string }

  const publishResponse = await page.request.post(`/api/changelog/projects/${projectId}/entries/${entry.id}/publish`)
  expect(publishResponse.ok()).toBeTruthy()

  // Public pages are served from the team subdomain: {team}.localhost:{port}/{product}/changelog
  await page.goto(`http://${TEAM_SLUG}.localhost:${PORT}/${PRODUCT_SLUG}/changelog`, {
    waitUntil: 'domcontentloaded',
  })
  const publicEntry = page.getByTestId(`public-changelog-entry-${entry.slug}`)
  await expect(publicEntry).toBeVisible({ timeout: 30_000 })
  await expect(publicEntry).toContainText(title)

  const rss = await page.request.get(`/api/public/t/${TEAM_SLUG}/${PRODUCT_SLUG}/changelog.rss`)
  expect(rss.status()).toBe(200)
  expect(rss.headers()['content-type']).toContain('application/rss+xml')
  expect(await rss.text()).toContain(title)
})
