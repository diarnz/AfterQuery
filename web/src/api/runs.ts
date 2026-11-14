import { ZodError } from 'zod'
import type { RunRequest } from '../contracts/catalog'
import { runFrameSchema, type RunFrame } from '../contracts/frames'
import { readNdjson } from '../stream/ndjson'
import { ApiRequestError, describeHttpError, networkError } from './http'

function contractError(index: number, error: ZodError): ApiRequestError {
  const issue = error.issues[0]
  const where = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
  return new ApiRequestError(
    `Frame ${index + 1} of the run stream does not match the harbor.observe.v1 contract${where}: ${issue?.message ?? 'invalid'}.`,
    'contract_mismatch',
    null,
  )
}

/**
 * Starts one run and yields validated frames in order. The stream must begin
 * with an opening frame and end with complete or failed; anything else is an error.
 */
export async function* streamRun(request: RunRequest, signal: AbortSignal): AsyncGenerator<RunFrame> {
  const body: Record<string, unknown> = { scenario: request.scenario, policy: request.policy }
  if (request.seed !== null) body.seed = request.seed

  let response: Response
  try {
    response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal.aborted) throw cause
    throw networkError(cause)
  }
  if (!response.ok) throw await describeHttpError(response)
  if (!response.body) throw new ApiRequestError('The API returned an empty run stream.', 'invalid_response', response.status)

  let index = 0
  let terminal = false
  for await (const raw of readNdjson(response.body)) {
    if (terminal) {
      throw new ApiRequestError('The run stream continued after its final frame.', 'contract_mismatch', null)
    }
    const parsed = runFrameSchema.safeParse(raw)
    if (!parsed.success) throw contractError(index, parsed.error)
    const frame = parsed.data
    if (index === 0 && frame.type !== 'opening') {
      throw new ApiRequestError('The run stream did not start with an opening frame.', 'contract_mismatch', null)
    }
    if (index > 0 && frame.type === 'opening') {
      throw new ApiRequestError('The run stream sent a second opening frame.', 'contract_mismatch', null)
    }
    terminal = frame.type === 'complete' || frame.type === 'failed'
    index += 1
    yield frame
  }
  if (!terminal) {
    throw new ApiRequestError('The connection closed before the run reported a result.', 'stream_truncated', null)
  }
}
