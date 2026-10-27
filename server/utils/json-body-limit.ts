/**
 * Bounded JSON body reader. Refuses anything above `maxBytes` with a 413: up front from `Content-Length`, and while
 * streaming for chunked bodies (it stops buffering at the cap). In-process calls (`$fetch` from the MCP bridge) hand
 * the route a pre-buffered body instead of a stream; that body is read through h3 and measured.
 */
import { createError, readRawBody, type H3Event } from 'h3'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

function payloadTooLarge(maxBytes: number) {
  return createError({
    statusCode: 413,
    statusMessage: 'Payload Too Large',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `Request body exceeds ${maxBytes} bytes`),
  })
}

function invalidJson() {
  return createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request body must be valid JSON'),
  })
}

type RequestWithBody = H3Event['node']['req'] & { body?: unknown; rawBody?: unknown }

function hasBufferedBody(event: H3Event): boolean {
  const req = event.node.req as RequestWithBody
  return Boolean(
    (event as { _requestBody?: unknown })._requestBody || event.web?.request?.body || req.rawBody || req.body
  )
}

function streamWithCap(event: H3Event, maxBytes: number): Promise<Buffer> {
  const req = event.node.req
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > maxBytes) {
        cleanup()
        // Discard the rest without buffering so the 413 can still be written.
        req.resume()
        reject(payloadTooLarge(maxBytes))
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
}

/** Reads and parses a JSON request body of at most `maxBytes`. An empty or malformed body is a 400. */
export async function readJsonBodyWithLimit(event: H3Event, maxBytes: number): Promise<unknown> {
  const declared = Number(event.node.req.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge(maxBytes)

  let raw: Buffer
  if (hasBufferedBody(event)) {
    raw = (await readRawBody(event, false)) ?? Buffer.alloc(0)
    if (raw.length > maxBytes) throw payloadTooLarge(maxBytes)
  } else {
    raw = await streamWithCap(event, maxBytes)
  }

  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw invalidJson()
  }
}
