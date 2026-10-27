/**
 * Bounded JSON body reader for `/mcp`. The MCP SDK caps request bodies at 4 MiB when it reads
 * the stream itself; the route hands it a pre-parsed body, so the same cap is enforced here.
 */
import { createError, type H3Event } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

/** Same as the SDK's DEFAULT_MAX_REQUEST_BODY_SIZE. */
export const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024

function payloadTooLarge() {
  return createError({
    statusCode: 413,
    statusMessage: 'Payload Too Large',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `Request body exceeds ${MCP_MAX_BODY_BYTES} bytes`),
  })
}

function invalidJson() {
  return createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request body must be valid JSON'),
  })
}

/**
 * Reads and parses the request body, refusing anything above MCP_MAX_BODY_BYTES: up front from
 * `Content-Length`, and while streaming for chunked bodies (it stops buffering at the cap).
 */
export async function readMcpJsonBody(event: H3Event): Promise<unknown> {
  const req = event.node.req
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) throw payloadTooLarge()

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > MCP_MAX_BODY_BYTES) {
        cleanup()
        // Discard the rest without buffering so the 413 can still be written.
        req.resume()
        reject(payloadTooLarge())
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })

  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw invalidJson()
  }
}
