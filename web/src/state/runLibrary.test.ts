import { describe, expect, it } from 'vitest'
import type { RunRequest } from '../contracts/catalog'
import type { RunFrame } from '../contracts/frames'
import { ApiRequestError } from '../api/http'
import { frames, recordFrom, type StreamName } from '../test/fixtures'
import { EXPORT_FORMAT, MAX_STORED_RUNS, RunLibrary, STORAGE_KEY, type RunStreamer } from './runLibrary'
import type { KeyValueStorage } from './storage'

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>()
  quota = Infinity
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (value.length > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

function replay(name: StreamName): RunStreamer {
  return async function* () {
    for (const frame of frames(name)) yield frame
  }
}

let counter = 0
const ids = () => `run-${++counter}`
const request: RunRequest = { scenario: 'fixture', policy: 'reference', seed: null }

async function settle(library: RunLibrary, id: string) {
  for (let i = 0; i < 100 && library.getSnapshot().live.has(id); i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('RunLibrary', () => {
  it('records a streamed run frame by frame and finishes it', async () => {
    const library = new RunLibrary(new MemoryStorage(), replay('fixture-reference'), () => new Date('2026-11-14T10:00:00Z'), ids)
    const seen: number[] = []
    library.subscribe(() => seen.push(library.getSnapshot().records[0]?.decisions.length ?? -1))
    const id = library.start(request)
    expect(library.getSnapshot().live.has(id)).toBe(true)
    await settle(library, id)
    const record = library.get(id)
    expect(record?.decisions).toHaveLength(5)
    expect(record?.outcome).toMatchObject({ kind: 'complete', result: { complete: true } })
    expect(library.getSnapshot().live.size).toBe(0)
    expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3, 4, 5]))
  })

  it('marks a stopped stream as stopped', async () => {
    const streamer: RunStreamer = async function* (_request, signal) {
      yield (frames('fixture-reference')[0] as RunFrame)
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    }
    const library = new RunLibrary(null, streamer, undefined, ids)
    const id = library.start(request)
    await new Promise((resolve) => setTimeout(resolve, 0))
    library.stop(id)
    await settle(library, id)
    expect(library.get(id)?.outcome).toEqual({ kind: 'stopped' })
    expect(library.get(id)?.opening).not.toBeNull()
  })

  it('records transport errors with their code', async () => {
    const streamer: RunStreamer = async function* () {
      yield* []
      throw new ApiRequestError('Could not reach the Runbook API.', 'network_unreachable', null)
    }
    const library = new RunLibrary(null, streamer, undefined, ids)
    const id = library.start(request)
    await settle(library, id)
    expect(library.get(id)?.outcome).toEqual({ kind: 'error', error: { code: 'network_unreachable', message: 'Could not reach the Runbook API.' } })
  })

  it('persists runs and marks a run that was streaming at reload as interrupted', () => {
    const storage = new MemoryStorage()
    const finished = recordFrom('fixture-reference', 'done-run')
    const streaming = { ...recordFrom('fixture-reference', 'open-run'), outcome: null, decisions: [] }
    storage.setItem(STORAGE_KEY, JSON.stringify([streaming, finished]))
    const library = new RunLibrary(storage)
    expect(library.get('done-run')?.outcome?.kind).toBe('complete')
    expect(library.get('open-run')?.outcome).toEqual({ kind: 'interrupted' })
    expect(library.getSnapshot().persistence).toBe('browser')
  })

  it('drops stored records that fail validation', () => {
    const storage = new MemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify([recordFrom('fixture-idle', 'good-run'), { id: 'x' }]))
    const library = new RunLibrary(storage)
    expect(library.getSnapshot().records.map((record) => record.id)).toEqual(['good-run'])
    expect(library.getSnapshot().droppedOnLoad).toBe(1)
  })

  it('keeps at most MAX_STORED_RUNS and evicts the oldest when the quota is exceeded', async () => {
    const storage = new MemoryStorage()
    const library = new RunLibrary(storage, replay('fixture-idle'), undefined, ids)
    for (let index = 0; index < MAX_STORED_RUNS + 2; index += 1) await settle(library, library.start(request))
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')).toHaveLength(MAX_STORED_RUNS)

    const stored = storage.getItem(STORAGE_KEY) ?? ''
    storage.quota = Math.floor(stored.length / 2)
    await settle(library, library.start(request))
    const kept = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as { id: string }[]
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(MAX_STORED_RUNS)
    expect(kept[0]?.id).toBe(library.getSnapshot().records[0]?.id)
    expect(library.getSnapshot().persistence).toBe('browser')
  })

  it('falls back to memory when nothing can be stored', async () => {
    const storage = new MemoryStorage()
    storage.quota = 10
    const library = new RunLibrary(storage, replay('fixture-idle'), undefined, ids)
    await settle(library, library.start(request))
    expect(library.getSnapshot().persistence).toBe('memory')
    expect(library.getSnapshot().records).toHaveLength(1)
  })

  it('round-trips finished runs through export and import, skipping duplicates and invalid rows', () => {
    const source = new RunLibrary(null)
    source.importJson(JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs: [recordFrom('fixture-reference', 'a-run'), recordFrom('fixture-stop-early', 'b-run')] }))
    const exported = source.exportJson()
    const target = new RunLibrary(null)
    expect(target.importJson(exported)).toEqual({ added: 2, skipped: 0 })
    expect(target.importJson(exported)).toEqual({ added: 0, skipped: 2 })
    const withJunk = JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs: [{ nope: true }] })
    expect(target.importJson(withJunk)).toEqual({ added: 0, skipped: 1 })
    expect(() => target.importJson('{"format":"other","runs":[]}')).toThrow(/runbook-runs/)
    expect(() => target.importJson('not json')).toThrow(/not valid JSON/)
  })

  it('removes and clears runs', () => {
    const library = new RunLibrary(new MemoryStorage())
    library.importJson(JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs: [recordFrom('fixture-idle', 'one-run'), recordFrom('fixture-idle', 'two-run')] }))
    library.remove('one-run')
    expect(library.getSnapshot().records.map((record) => record.id)).toEqual(['two-run'])
    library.clear()
    expect(library.getSnapshot().records).toEqual([])
  })
})
