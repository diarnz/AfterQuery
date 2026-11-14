/** Transport errors with plain-language messages. The code is shown next to the sentence. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

interface ValidationDetail {
  loc?: unknown
  msg?: unknown
}

/** FastAPI returns {detail: string} or {detail: [{loc, msg}]} for errors. */
export async function describeHttpError(response: Response): Promise<ApiRequestError> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const value = (body as { detail: unknown }).detail
      if (typeof value === 'string') detail = value
      else if (Array.isArray(value)) {
        detail = value
          .map((item: ValidationDetail) => {
            const where = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : ''
            const message = typeof item.msg === 'string' ? item.msg : 'invalid value'
            return where ? `${where}: ${message}` : message
          })
          .join('; ')
      }
    }
  } catch {
    // Non-JSON error bodies fall through to the status line.
  }
  const code = response.status === 422 ? 'invalid_request' : `http_${response.status}`
  const summary =
    response.status === 422
      ? 'The API rejected the run request.'
      : response.status === 404
        ? 'The API does not provide this endpoint.'
        : response.status >= 500
          ? 'The API failed while handling the request.'
          : `The API answered with HTTP ${response.status}.`
  return new ApiRequestError(detail ? `${summary} ${detail}` : summary, code, response.status)
}

export function networkError(cause: unknown): ApiRequestError {
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new ApiRequestError(
    `Could not reach the Runbook API. Start it with \`make api\` and retry. (${reason})`,
    'network_unreachable',
    null,
  )
}

export async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw networkError(cause)
  }
  if (!response.ok) throw await describeHttpError(response)
  try {
    return await response.json()
  } catch {
    throw new ApiRequestError(`The API returned invalid JSON for ${path}.`, 'invalid_response', response.status)
  }
}
