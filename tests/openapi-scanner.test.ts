import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractOpenAPIDocument, scanOpenAPIRoutes } from '~/scripts/openapi-scanner'
import { openapiPaths } from '~/server/generated/openapi-routes'

describe('OpenAPI route scanner', () => {
  it('parses a standard swagger-jsdoc YAML comment block', () => {
    const source = `/**
     * @openapi
     * /api/example/{id}:
     *   get:
     *     summary: Get an example
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200: { description: Example returned }
     */`

    expect(extractOpenAPIDocument(source, 'example.get.ts')).toEqual({
      '/api/example/{id}': {
        get: {
          summary: 'Get an example',
          parameters: [
            {
              in: 'path',
              name: 'id',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: { description: 'Example returned' },
          },
        },
      },
    })
  })

  it('merges route documents deterministically and rejects conflicting operations', async () => {
    const fixtureDir = await mkdtemp(path.join(tmpdir(), 'veerify-openapi-scanner-'))

    try {
      await writeFile(
        path.join(fixtureDir, 'b.get.ts'),
        `/**\n * @openapi\n * /api/shared:\n *   get:\n *     summary: Shared route\n *     responses: { 200: { description: ok } }\n */`
      )
      await writeFile(
        path.join(fixtureDir, 'a.post.ts'),
        `/**\n * @openapi\n * /api/shared:\n *   post:\n *     summary: Shared route creation\n *     responses: { 201: { description: created } }\n */`
      )

      await expect(scanOpenAPIRoutes(fixtureDir)).resolves.toEqual({
        '/api/shared': {
          get: {
            summary: 'Shared route',
            responses: { 200: { description: 'ok' } },
          },
          post: {
            summary: 'Shared route creation',
            responses: { 201: { description: 'created' } },
          },
        },
      })

      await writeFile(
        path.join(fixtureDir, 'conflict.ts'),
        `/**\n * @openapi\n * /api/shared:\n *   get:\n *     summary: Conflicting route\n */`
      )

      await expect(scanOpenAPIRoutes(fixtureDir)).rejects.toThrow(/conflicting OpenAPI operation/i)
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  })

  it('covers every current annotated route and keeps the endpoint source-free at runtime', async () => {
    const routeDir = path.resolve('server/api')
    const paths = await scanOpenAPIRoutes(routeDir)
    const endpointSource = await readFile(path.join(routeDir, 'openapi.json.get.ts'), 'utf8')

    expect(Object.keys(paths).length).toBeGreaterThanOrEqual(40)
    expect(paths['/api/auth/session']?.get).toBeDefined()
    expect(paths['/api/github/issues']?.get).toBeDefined()
    expect(paths['/api/support/conversations']?.get).toBeDefined()
    expect(paths['/api/support/conversations']?.post).toBeDefined()
    expect(paths['/api/system/tls-ask']?.get).toBeDefined()
    expect((paths['/api/auth/session']?.get as { responses?: unknown } | undefined)?.responses).toHaveProperty('200')
    expect((openapiPaths['/api/auth/session']?.get as { responses?: unknown } | undefined)?.responses).toHaveProperty(
      '200'
    )
    expect(openapiPaths).toEqual(paths)
    expect(endpointSource).not.toMatch(/readFile|readdir|glob\(|server\/api/)
  })
})
