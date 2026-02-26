import { access, constants, mkdir } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { createSuccessResponse } from '~/server/utils/response'
import { getStorageDriver, getStorageProvider } from '~/server/utils/storage'

type ServiceLevel = 'ok' | 'warn' | 'error'

type ServiceStatus = {
  key: string
  label: string
  level: ServiceLevel
  message: string
}

function pushError(results: ServiceStatus[], key: string, label: string, message: string) {
  results.push({ key, label, level: 'error', message })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'Check failed'
}

export default defineEventHandler(async (event) => {
  await requireAuth(event)

  const config = useRuntimeConfig()
  const statuses: ServiceStatus[] = []

  try {
    await db.execute(sql`select 1`)
    statuses.push({
      key: 'database',
      label: 'Database',
      level: 'ok',
      message: 'Connected',
    })
  } catch (error) {
    pushError(statuses, 'database', 'Database', getErrorMessage(error))
  }

  try {
    const driver = getStorageDriver()
    if (driver === 'local') {
      const rootDir = config.storageLocalDir || '.data/storage'
      await mkdir(rootDir, { recursive: true })
      await access(rootDir, constants.W_OK)
      statuses.push({
        key: 'storage',
        label: 'Storage',
        level: 'ok',
        message: `Local storage writable (${rootDir})`,
      })
    } else {
      getStorageProvider()
      statuses.push({
        key: 'storage',
        label: 'Storage',
        level: 'ok',
        message: 'S3 configuration is valid',
      })
    }
  } catch (error) {
    pushError(statuses, 'storage', 'Storage', getErrorMessage(error))
  }

  const hasSmtpHost = Boolean(config.nodemailer?.host)
  const hasSmtpPort = Boolean(config.nodemailer?.port)
  const hasFrom = Boolean(config.nodemailer?.from)

  if (hasSmtpHost && hasSmtpPort && hasFrom) {
    statuses.push({
      key: 'email',
      label: 'Email',
      level: 'ok',
      message: `SMTP configured (${config.nodemailer.host}:${config.nodemailer.port})`,
    })
  } else {
    const missing: string[] = []
    if (!hasSmtpHost) missing.push('SMTP_HOST')
    if (!hasSmtpPort) missing.push('SMTP_PORT')
    if (!hasFrom) missing.push('MAIL_FROM')

    statuses.push({
      key: 'email',
      label: 'Email',
      level: missing.length === 3 ? 'error' : 'warn',
      message: `Missing: ${missing.join(', ')}`,
    })
  }

  const summary = {
    ok: statuses.filter((item) => item.level === 'ok').length,
    warn: statuses.filter((item) => item.level === 'warn').length,
    error: statuses.filter((item) => item.level === 'error').length,
  }

  return createSuccessResponse({
    statuses,
    summary,
    checkedAt: new Date().toISOString(),
  })
})
