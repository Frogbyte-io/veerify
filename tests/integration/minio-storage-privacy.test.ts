import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const enabled = process.env.MINIO_POLICY_INTEGRATION === '1'
const bucket = `veerify-policy-${randomUUID().replaceAll('-', '').slice(0, 16)}`
const rootUser = 'policytest'
const rootPassword = 'policy-test-password-123'
const network = `veerify-policy-${randomUUID().slice(0, 8)}`
const minioContainer = `${network}-minio`
const mcImage = 'minio/mc:latest'
const minioImage = 'minio/minio:latest'

function docker(args: string[], input?: Buffer) {
  return execFileSync('docker', args, {
    input,
    encoding: input ? undefined : 'utf8',
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  }) as Buffer | string
}

function mc(...args: string[]) {
  docker([
    'run',
    '--rm',
    '--network',
    network,
    '-e',
    `MC_HOST_local=http://${rootUser}:${rootPassword}@minio:9000`,
    mcImage,
    ...args,
  ])
}

describe.skipIf(!enabled)('production MinIO anonymous policy', () => {
  it('keeps branding public and support objects private', async () => {
    const compose = load(readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')) as {
      services: { 'minio-setup': { entrypoint: string } }
    }
    const setupCommand = compose.services['minio-setup'].entrypoint

    try {
      docker(['network', 'create', network])
      docker([
        'run',
        '-d',
        '--name',
        minioContainer,
        '--network',
        network,
        '--network-alias',
        'minio',
        '-p',
        '127.0.0.1::9000',
        '-e',
        `MINIO_ROOT_USER=${rootUser}`,
        '-e',
        `MINIO_ROOT_PASSWORD=${rootPassword}`,
        minioImage,
        'server',
        '/data',
      ])

      const scriptMatch = setupCommand.trim().match(/^\/bin\/sh -c "([\s\S]*)"$/)
      expect(scriptMatch).toBeTruthy()
      const setupScript = scriptMatch![1]
        .replaceAll('\\"', '"')
        .replaceAll('$$STORAGE_ACCESS_KEY_ID', rootUser)
        .replaceAll('$$STORAGE_SECRET_ACCESS_KEY', rootPassword)
        .replaceAll('$$STORAGE_BUCKET', bucket)
      // Model an existing deployment where the previous Compose bootstrap
      // left anonymous download enabled for the entire persistent bucket.
      mc('mb', '--ignore-existing', `local/${bucket}`)
      mc('anonymous', 'set', 'download', `local/${bucket}`)
      docker([
        'run',
        '--rm',
        '--network',
        network,
        '--entrypoint',
        '/bin/sh',
        '-e',
        `STORAGE_BUCKET=${bucket}`,
        '-e',
        `STORAGE_ACCESS_KEY_ID=${rootUser}`,
        '-e',
        `STORAGE_SECRET_ACCESS_KEY=${rootPassword}`,
        mcImage,
        '-c',
        setupScript,
      ])

      mc('alias', 'set', 'local', 'http://minio:9000', rootUser, rootPassword)
      for (const key of [
        'projects/project-1/logo.webp',
        'support/inbound/postmark/2026-01-01/event.json',
        'support/attachments/event-1/attachment-1/private.pdf',
      ]) {
        docker(
          [
            'run',
            '--rm',
            '-i',
            '--network',
            network,
            '-e',
            `MC_HOST_local=http://${rootUser}:${rootPassword}@minio:9000`,
            mcImage,
            'pipe',
            `local/${bucket}/${key}`,
          ],
          Buffer.from('private test payload')
        )
      }

      const portOutput = String(docker(['port', minioContainer, '9000/tcp']))
      const port = portOutput.trim().split(':').at(-1)
      expect(port).toBeTruthy()
      const baseUrl = `http://127.0.0.1:${port}/${bucket}`
      const branding = await fetch(`${baseUrl}/projects/project-1/logo.webp`)
      const inbound = await fetch(`${baseUrl}/support/inbound/postmark/2026-01-01/event.json`)
      const attachment = await fetch(`${baseUrl}/support/attachments/event-1/attachment-1/private.pdf`)

      expect(branding.status).toBe(200)
      expect(await branding.text()).toBe('private test payload')
      expect(inbound.status).toBe(403)
      expect(attachment.status).toBe(403)
    } finally {
      try {
        docker(['rm', '-f', minioContainer])
      } catch {
        /* already removed */
      }
      try {
        docker(['network', 'rm', network])
      } catch {
        /* already removed */
      }
    }
  })
})
