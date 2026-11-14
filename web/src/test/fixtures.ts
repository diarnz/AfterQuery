/**
 * Real run streams recorded from the Runbook API by scripts/record-fixtures.mjs.
 * Tests assert against these, never against hand-written payloads.
 */
import { runFrameSchema, type RunFrame } from '../contracts/frames'
import { applyFrame, newRunRecord, type RunRecord } from '../state/runRecord'
import fixtureReference from './fixtures/fixture-reference.ndjson?raw'
import fixtureIdle from './fixtures/fixture-idle.ndjson?raw'
import fixtureStopEarly from './fixtures/fixture-stop-early.ndjson?raw'
import reactiveClosure from './fixtures/reactive-closure-42-reference.ndjson?raw'
import openCanal from './fixtures/open-canal-7-reference.ndjson?raw'
import openApiText from './fixtures/openapi.json?raw'

export const STREAMS = {
  'fixture-reference': { text: fixtureReference, request: { scenario: 'fixture', policy: 'reference', seed: null } },
  'fixture-idle': { text: fixtureIdle, request: { scenario: 'fixture', policy: 'idle', seed: null } },
  'fixture-stop-early': { text: fixtureStopEarly, request: { scenario: 'fixture', policy: 'stop-early', seed: null } },
  'reactive-closure-42-reference': { text: reactiveClosure, request: { scenario: 'reactive_closure', policy: 'reference', seed: 42 } },
  'open-canal-7-reference': { text: openCanal, request: { scenario: 'open_canal', policy: 'reference', seed: 7 } },
} as const

export type StreamName = keyof typeof STREAMS

export const OPENAPI: unknown = JSON.parse(openApiText)

export function rawLines(name: StreamName): unknown[] {
  return STREAMS[name].text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown)
}

export function frames(name: StreamName): RunFrame[] {
  return rawLines(name).map((line) => runFrameSchema.parse(line))
}

export function recordFrom(name: StreamName, id = `rec-${name}`, createdAt = new Date('2026-11-14T10:00:00Z')): RunRecord {
  const { request } = STREAMS[name]
  return frames(name).reduce(applyFrame, newRunRecord(id, { ...request }, createdAt))
}

/** A Response whose body arrives in small, uneven chunks, like a real network stream. */
export function chunkedResponse(text: string, init: ResponseInit = {}, chunkSize = 37): Response {
  const bytes = new TextEncoder().encode(text)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize))
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' }, ...init })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** fetch stub serving the recorded OpenAPI document, health, and run streams. */
export function stubApi(options: { stream?: StreamName; health?: boolean } = {}) {
  const calls: { url: string; body: unknown }[] = []
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/openapi.json')) return jsonResponse(OPENAPI)
    if (url.endsWith('/api/health')) {
      if (options.health === false) throw new TypeError('Failed to fetch')
      return jsonResponse({ status: 'ok' })
    }
    if (url.endsWith('/api/runs')) return chunkedResponse(STREAMS[options.stream ?? 'fixture-reference'].text)
    return jsonResponse({ detail: 'Not Found' }, 404)
  }
  return { fetchMock, calls }
}
