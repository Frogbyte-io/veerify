import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { transformImageForKind, validateImageUploadInput } from '../server/utils/storage/media'

function installNuxtServerStubs() {
  vi.stubGlobal('createError', (input: any) => {
    const message = input?.data?.error?.message || input?.statusMessage || 'Request failed'
    const err = new Error(message) as any
    Object.assign(err, input)
    return err
  })
}

async function createInputPng(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 52, g: 101, b: 164, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
}

describe('storage media utilities', () => {
  beforeEach(() => {
    installNuxtServerStubs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('transforms logo images to webp within max bounds', async () => {
    const source = await createInputPng(1800, 1200)
    const transformed = await transformImageForKind(source, 'logo')
    const metadata = await sharp(transformed.buffer).metadata()

    expect(transformed.contentType).toBe('image/webp')
    expect(metadata.format).toBe('webp')
    expect((metadata.width || 0) <= 512).toBe(true)
    expect((metadata.height || 0) <= 512).toBe(true)
  })

  it('transforms banner images to exact 1600x400 webp', async () => {
    const source = await createInputPng(2000, 1200)
    const transformed = await transformImageForKind(source, 'banner')
    const metadata = await sharp(transformed.buffer).metadata()

    expect(transformed.contentType).toBe('image/webp')
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(1600)
    expect(metadata.height).toBe(400)
  })

  it('rejects unsupported formats during validation', () => {
    expect(() => validateImageUploadInput('logo', 'image/gif', 1024)).toThrow(/Unsupported image type/)
  })

  it('rejects too-large files based on upload kind limits', () => {
    expect(() => validateImageUploadInput('logo', 'image/png', 3 * 1024 * 1024)).toThrow(/too large/i)
    expect(() => validateImageUploadInput('banner', 'image/png', 9 * 1024 * 1024)).toThrow(/too large/i)
  })
})
