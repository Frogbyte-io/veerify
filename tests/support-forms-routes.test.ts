import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Admin routes for website forms (`/api/support/projects/{projectId}/forms`):
 * project-admin authorization on every route, the inbox must belong to the
 * project, and slug conflicts surface as 409. Submissions are covered against
 * a real database in tests/integration/support-forms.test.ts.
 */

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  body: {} as unknown,
  status: undefined as number | undefined,
  /** Rows returned by successive `select ... limit()` calls. */
  selects: [] as unknown[][],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deleted: 0,
  writeError: null as unknown,
}))

const requireProjectAdmin = vi.hoisted(() => vi.fn(async (_projectId: string, _userId: string) => undefined))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('setResponseStatus', (_event: unknown, code: number) => {
  state.status = code
})

vi.mock('h3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('h3')>()),
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))
vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('~/server/utils/project-access', () => ({ requireProjectAdmin }))

function chain(rows: () => unknown[]) {
  const node: Record<string, unknown> = {}
  for (const name of ['from', 'where', 'orderBy', 'groupBy', 'leftJoin', 'innerJoin']) node[name] = () => node
  node.limit = async () => rows()
  node.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(rows()).then(resolve, reject)
  return node
}

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => chain(() => state.selects.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (state.writeError) throw state.writeError
          state.inserted.push(values)
          return [{ ...values }]
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (state.writeError) throw state.writeError
            state.updated.push(values)
            return [{ id: 'form-1', projectId: 'project-1', publicId: 'frm_x', ...values }]
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deleted++
      },
    }),
  },
}))

const list = (await import('~/server/api/support/projects/[projectId]/forms/index.get')).default as unknown as (
  event: unknown
) => Promise<any>
const create = (await import('~/server/api/support/projects/[projectId]/forms/index.post')).default as unknown as (
  event: unknown
) => Promise<any>
const update = (await import('~/server/api/support/projects/[projectId]/forms/[formId].put')).default as unknown as (
  event: unknown
) => Promise<any>
const remove = (await import('~/server/api/support/projects/[projectId]/forms/[formId].delete')).default as unknown as (
  event: unknown
) => Promise<any>

const validBody = {
  name: 'Contact',
  slug: 'contact',
  inboxId: 'inbox-1',
  fields: [
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'message', label: 'Message', type: 'textarea', required: true },
  ],
  fieldMapping: { email: 'email' },
}

const formRow = { id: 'form-1', projectId: 'project-1', inboxId: 'inbox-1', name: 'Contact', fields: [] }

beforeEach(() => {
  state.params = { projectId: 'project-1', formId: 'form-1' }
  state.body = validBody
  state.status = undefined
  state.selects = []
  state.inserted = []
  state.updated = []
  state.deleted = 0
  state.writeError = null
  requireProjectAdmin.mockClear()
})

describe('form admin routes: authorization', () => {
  const routes = [
    ['list', list],
    ['create', create],
    ['update', update],
    ['delete', remove],
  ] as const

  it.each(routes)('%s requires a project admin of the route project, before touching data', async (_name, handler) => {
    requireProjectAdmin.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    })
    await expect(handler({})).rejects.toMatchObject({ statusCode: 403 })
    expect(requireProjectAdmin).toHaveBeenCalledWith('project-1', 'user-1')
    expect(state.inserted).toEqual([])
    expect(state.updated).toEqual([])
    expect(state.deleted).toBe(0)
  })

  it('update and delete 404 a form outside the project', async () => {
    state.selects = [[]]
    await expect(update({})).rejects.toMatchObject({ statusCode: 404 })
    state.selects = [[]]
    await expect(remove({})).rejects.toMatchObject({ statusCode: 404 })
    expect(state.updated).toEqual([])
    expect(state.deleted).toBe(0)
  })
})

describe('form admin routes: writes', () => {
  it('creates a form with a fresh public id once the inbox is in the project', async () => {
    state.selects = [[{ id: 'inbox-1' }]]
    const response = await create({})
    expect(state.status).toBe(201)
    expect(state.inserted[0]).toMatchObject({
      projectId: 'project-1',
      inboxId: 'inbox-1',
      slug: 'contact',
      createdByUserId: 'user-1',
      fieldMapping: { email: 'email', name: null, subject: null },
    })
    expect(String(state.inserted[0].publicId)).toMatch(/^frm_[A-Za-z0-9_-]{16}$/)
    expect(response.data.form.publicId).toBe(state.inserted[0].publicId)
  })

  it("refuses another project's inbox", async () => {
    state.selects = [[]]
    await expect(create({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toEqual([])
  })

  it('400s an invalid definition without writing', async () => {
    state.body = { ...validBody, fieldMapping: { email: 'message' } }
    await expect(create({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toEqual([])
  })

  it('turns a duplicate slug into 409', async () => {
    state.selects = [[{ id: 'inbox-1' }]]
    state.writeError = Object.assign(new Error('duplicate'), { code: '23505' })
    await expect(create({})).rejects.toMatchObject({ statusCode: 409 })

    state.selects = [[formRow], [{ id: 'inbox-1' }]]
    await expect(update({})).rejects.toMatchObject({ statusCode: 409 })
  })

  it('updates the definition but never the public id', async () => {
    state.selects = [[formRow], [{ id: 'inbox-1' }]]
    await update({})
    expect(state.updated[0]).not.toHaveProperty('publicId')
    expect(state.updated[0]).toMatchObject({ slug: 'contact', updatedAt: expect.any(Date) })
  })

  it('deletes a form of the project', async () => {
    state.selects = [[formRow]]
    await expect(remove({})).resolves.toMatchObject({ data: { deleted: true } })
    expect(state.deleted).toBe(1)
  })
})
