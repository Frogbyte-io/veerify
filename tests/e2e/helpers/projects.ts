import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { selectors } from './selectors'

export type ActiveProject = {
  id: string
  name: string
  slug: string
  organizationId: string
  role: 'admin' | 'member'
}

export type ProjectSummary = ActiveProject & { productCount?: number }

type ActiveProjectPayload = {
  project: ActiveProject & { settings: Record<string, unknown> }
  organization: { id: string; name: string; slug: string; role: string }
  products: Array<{ id: string; name: string; slug: string }>
}

export async function listProjectsViaApi(request: APIRequestContext): Promise<ProjectSummary[]> {
  const response = await request.get('/api/projects')
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  return (payload?.data ?? []) as ProjectSummary[]
}

/** Makes sure the session has an organization and an active project (picks the first accessible one). */
export async function ensureProjectContext(request: APIRequestContext) {
  const activeResponse = await request.get('/api/projects/active')
  if (activeResponse.ok()) return

  const projects = await listProjectsViaApi(request)
  expect(projects.length).toBeGreaterThan(0)
  const first = projects[0]!
  await setActiveProject(request, first.id)
}

export async function setActiveProject(request: APIRequestContext, projectId: string) {
  const response = await request.post('/api/projects/active', { data: { projectId } })
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  return payload.data as ActiveProjectPayload
}

export async function getActiveProjectViaApi(request: APIRequestContext): Promise<ActiveProject> {
  const response = await request.get('/api/projects/active')
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  expect(payload?.success).toBeTruthy()
  expect(payload?.data?.project?.id).toBeTruthy()

  return payload.data.project as ActiveProject
}

/** Creates a project (and its default product) in the active workspace. Does not switch to it. */
export async function createProjectViaApi(
  request: APIRequestContext,
  input: { name: string; slug?: string; isPublic?: boolean }
): Promise<{ project: ActiveProject; product: { id: string; name: string; slug: string } }> {
  const response = await request.post('/api/projects', { data: input })
  expect(response.status()).toBe(201)
  const payload = await response.json()
  return payload.data
}

export async function deleteProjectViaApi(request: APIRequestContext, slug: string) {
  const response = await request.delete(`/api/projects/${slug}`)
  expect(response.ok()).toBeTruthy()
}

/** Creates a project via the API and makes it the active one. */
export async function createAndActivateProject(request: APIRequestContext, name: string): Promise<ActiveProject> {
  const created = await createProjectViaApi(request, { name })
  await setActiveProject(request, created.project.id)
  return getActiveProjectViaApi(request)
}

type SwitchProjectParams = { projectId: string; expectedName: string } | { projectName: string }

export async function switchProjectFromSidebar(page: Page, params: SwitchProjectParams): Promise<ActiveProject> {
  const trigger = page.locator(selectors.projectSwitcherTrigger)
  await expect(trigger).toBeVisible()
  await expect(trigger).toBeEnabled({ timeout: 20_000 })
  await trigger.click()

  const expectedName = 'expectedName' in params ? params.expectedName : params.projectName
  const item = page.getByRole('menuitem').filter({ hasText: expectedName }).first()
  await expect(item).toBeVisible({ timeout: 20_000 })
  await item.click()

  await expect
    .poll(async () => (await getActiveProjectViaApi(page.request)).name, { timeout: 20_000 })
    .toBe(expectedName)

  await expect(page.locator(selectors.projectSwitcherActiveName)).toHaveText(expectedName)
  return getActiveProjectViaApi(page.request)
}
