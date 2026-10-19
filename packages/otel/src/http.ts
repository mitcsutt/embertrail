// OTLP/HTTP framing: the body (JSON only, optionally gzip, at most 5 MB decoded) and the
// responses, `partialSuccess` on 200 and `google.rpc.Status` JSON on errors.

/** Largest decoded body accepted: 5 MiB. */
export const maxBodyBytes = 5 * 1024 * 1024

/** `google.rpc.Code` INVALID_ARGUMENT: not retryable, which is what 400, 413 and 415 mean. */
const invalidArgument = 3

/** A request OTLP/HTTP says to refuse, with its status. */
export class OtlpError extends Error {
  override readonly name = 'OtlpError'

  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message)
  }
}

/** An error response as OTLP/HTTP requires: `google.rpc.Status` in JSON. */
export function statusResponse(error: OtlpError): Response {
  return Response.json({ code: invalidArgument, message: error.message }, { status: error.status })
}

/** A 200, with `partialSuccess` only when something was refused. */
export function exportResponse(
  rejectedKey: 'rejectedLogRecords' | 'rejectedDataPoints' | 'rejectedSpans',
  rejected: number,
  messages: readonly string[],
): Response {
  if (rejected === 0) return Response.json({})
  return Response.json({
    partialSuccess: { [rejectedKey]: String(rejected), errorMessage: messages.join(' ') },
  })
}

function mediaType(request: Request) {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
}

/** Reads a stream to bytes, failing as soon as it passes the limit. */
async function readLimited(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new OtlpError(
        413,
        `Body is over ${String(limit)} bytes decoded; lower the exporter's batch size.`,
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * The request's OTLP/JSON body, parsed. Throws `OtlpError`: 415 for anything but
 * `application/json` or an encoding other than gzip, 413 over 5 MB decoded, 400 for a body
 * that isn't gzip or a JSON object.
 */
export async function readOtlpJson(request: Request): Promise<Record<string, unknown>> {
  if (mediaType(request) !== 'application/json') {
    throw new OtlpError(
      415,
      'Embertrail accepts OTLP/HTTP JSON only: send Content-Type application/json (OTEL_EXPORTER_OTLP_PROTOCOL=http/json).',
    )
  }
  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase()
  if (encoding !== 'identity' && encoding !== 'gzip') {
    throw new OtlpError(415, `Content-Encoding "${encoding}" is not supported; use gzip or none.`)
  }
  if (request.body === null) throw new OtlpError(400, 'Body is empty.')
  const stream =
    encoding === 'gzip' ? request.body.pipeThrough(new DecompressionStream('gzip')) : request.body
  let bytes: Uint8Array
  try {
    bytes = await readLimited(stream, maxBodyBytes)
  } catch (error) {
    if (error instanceof OtlpError) throw error
    throw new OtlpError(400, 'Body is not valid gzip.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new OtlpError(400, 'Body is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OtlpError(400, 'Body must be a JSON object, an OTLP export request.')
  }
  return parsed as Record<string, unknown>
}
