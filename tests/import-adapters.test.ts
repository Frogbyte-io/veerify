import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeCsvImport } from '../server/services/imports/providers/csv'
import { analyzeSleekplanImport } from '../server/services/imports/providers/sleekplan'

function mockJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    async json() {
      return payload
    },
  }
}

describe('import adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('parses csv imports into the canonical snapshot shape', async () => {
    const csvContent = [
      'record_type,external_id,title,body,category,status,feedback_external_id,email',
      'feedback,fb_1,Need better search,Users cannot filter by label,Feature Request,Open,,',
      'roadmap,rm_1,Q3 search revamp,Improve relevance,Search,Planned,,',
      'changelog,ch_1,Search launch,We shipped search v2,Release,,,',
      'comment,c_1,,Following this thread,,,fb_1,',
      'subscription,sub_1,,,,,,watcher@example.com',
      'subscription,sub_2,,,,,fb_1,notify@example.com',
      'feedback,fb_bad,,Missing title row,Feature Request,Open,,',
    ].join('\n')

    const snapshot = await analyzeCsvImport({
      sourceType: 'csv',
      csvContent,
    })

    expect(snapshot.sourceType).toBe('csv')
    expect(snapshot.feedback).toHaveLength(1)
    expect(snapshot.roadmapEntries).toHaveLength(1)
    expect(snapshot.changelogEntries).toHaveLength(1)
    expect(snapshot.comments).toHaveLength(1)
    expect(snapshot.subscriptions).toHaveLength(1)
    expect(snapshot.categories.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Feature Request', 'Search', 'Release'])
    )
    expect(snapshot.statuses.map((item) => item.value)).toEqual(expect.arrayContaining(['open', 'planned']))
    expect(snapshot.feedback[0]).toMatchObject({
      externalId: 'fb_1',
      title: 'Need better search',
      status: 'open',
      category: 'Feature Request',
    })
    expect(snapshot.roadmapEntries[0]).toMatchObject({
      externalId: 'rm_1',
      sourceKind: 'roadmap',
      status: 'planned',
    })
    expect(snapshot.changelogEntries[0]).toMatchObject({
      externalId: 'ch_1',
      title: 'Search launch',
    })
    expect(snapshot.comments[0]).toMatchObject({
      externalId: 'c_1',
      feedbackExternalId: 'fb_1',
    })
    expect(snapshot.subscriptions[0]).toMatchObject({
      externalId: 'sub_2',
      feedbackExternalId: 'fb_1',
      email: 'notify@example.com',
    })
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'subscription',
        }),
        expect.objectContaining({
          entityType: 'feedback',
        }),
      ])
    )
  })

  it('loads a best-effort sleekplan snapshot and warns when sections are unavailable', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input)

      if (url.endsWith('/api/items')) {
        return mockJsonResponse([
          {
            id: 'item_1',
            title: 'Need changelog filters',
            description: 'Customers want filtering by release type.',
            status: 'open',
            category_name: 'Feature Request',
            votes: 7,
          },
        ])
      }

      if (url.endsWith('/api/changelog')) {
        return mockJsonResponse([
          {
            id: 'change_1',
            title: 'Release 1.2',
            body: 'Added import history.',
            category: 'Release',
          },
        ])
      }

      if (url.endsWith('/api/categories')) {
        return mockJsonResponse([{ id: 'cat_1', name: 'Feature Request', color: '#22c55e' }])
      }

      if (url.endsWith('/api/statuses')) {
        return mockJsonResponse([{ id: 'status_1', name: 'Open', value: 'open', color: '#3b82f6' }])
      }

      if (url.endsWith('/api/roadmap')) {
        return mockJsonResponse([{ id: 'road_1', title: 'Import dashboard', status: 'planned' }])
      }

      return mockJsonResponse([], false)
    })

    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await analyzeSleekplanImport({
      sourceType: 'sleekplan',
      sleekplan: {
        baseUrl: 'https://demo.sleekplan.test',
        apiKey: 'secret',
      },
    })

    expect(snapshot.sourceType).toBe('sleekplan')
    expect(snapshot.feedback).toHaveLength(1)
    expect(snapshot.roadmapEntries).toHaveLength(1)
    expect(snapshot.changelogEntries).toHaveLength(1)
    expect(snapshot.categories[0]).toMatchObject({ name: 'Feature Request', color: '#22c55e' })
    expect(snapshot.statuses[0]).toMatchObject({ name: 'Open', value: 'open' })
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'comment',
        }),
        expect.objectContaining({
          entityType: 'subscription',
        }),
      ])
    )
    expect(fetchMock).toHaveBeenCalled()
  })
})
