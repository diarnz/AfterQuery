import { ZodError } from 'zod'
import { catalogFromOpenApi, type RunCatalog } from '../contracts/catalog'
import { ApiRequestError, getJson } from './http'

export async function fetchRunCatalog(signal?: AbortSignal): Promise<RunCatalog> {
  const document = await getJson('/openapi.json', signal)
  try {
    return catalogFromOpenApi(document)
  } catch (error) {
    const detail = error instanceof ZodError ? error.issues[0]?.message ?? '' : error instanceof Error ? error.message : ''
    throw new ApiRequestError(
      `The API's OpenAPI document does not describe the run request this terminal expects. ${detail}`.trim(),
      'contract_mismatch',
      null,
    )
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<boolean> {
  const body = await getJson('/api/health', signal)
  return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok'
}
