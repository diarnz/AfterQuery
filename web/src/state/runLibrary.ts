import type { RunRequest } from '../contracts/catalog'
import type { RunFrame } from '../contracts/frames'
import { ApiRequestError } from '../api/http'
import { streamRun } from '../api/runs'
import { applyFrame, newRunRecord, runRecordSchema, type RunOutcome, type RunRecord } from './runRecord'
import { readItem, removeItem, writeItem, type KeyValueStorage } from './storage'

export const STORAGE_KEY = 'runbook.runs.v1'
export const MAX_STORED_RUNS = 30
export const EXPORT_FORMAT = 'runbook-runs'

export type RunStreamer = (request: RunRequest, signal: AbortSignal) => AsyncIterable<RunFrame>

export interface LibrarySnapshot {
  /** Newest first. */
  records: readonly RunRecord[]
  live: ReadonlySet<string>
  persistence: 'browser' | 'memory'
  /** Records found in storage that failed validation and were dropped on load. */
  droppedOnLoad: number
}

export interface ImportResult {
  added: number
  skipped: number
}

function errorOutcome(error: unknown): RunOutcome {
  if (error instanceof ApiRequestError) return { kind: 'error', error: { code: error.code, message: error.message } }
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'error', error: { code: 'client_error', message } }
}

export function newRunId(): string {
  return crypto.randomUUID()
}

/**
 * Holds every run this browser has started or imported, and owns the open
 * streams. React reads it through useSyncExternalStore.
 */
export class RunLibrary {
  private snapshot: LibrarySnapshot
  private readonly controllers = new Map<string, AbortController>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly streamer: RunStreamer = streamRun,
    private readonly now: () => Date = () => new Date(),
    private readonly makeId: () => string = newRunId,
  ) {
    const { records, dropped } = this.load()
    this.snapshot = {
      records,
      live: new Set(),
      persistence: storage ? 'browser' : 'memory',
      droppedOnLoad: dropped,
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): LibrarySnapshot => this.snapshot

  get(id: string): RunRecord | undefined {
    return this.snapshot.records.find((record) => record.id === id)
  }

  start(request: RunRequest): string {
    const id = this.makeId()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const record = newRunRecord(id, request, this.now())
    this.commit([record, ...this.snapshot.records])
    void this.pump(id, request, controller)
    return id
  }

  /** Closes the stream. The API does not score a run whose stream was closed early. */
  stop(id: string): void {
    this.controllers.get(id)?.abort()
  }

  remove(id: string): void {
    this.stop(id)
    this.commit(this.snapshot.records.filter((record) => record.id !== id))
  }

  clear(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.commit([])
  }

  exportJson(ids?: readonly string[]): string {
    const runs = this.snapshot.records.filter((record) => record.outcome && (!ids || ids.includes(record.id)))
    return JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs }, null, 2)
  }

  importJson(text: string): ImportResult {
    let document: unknown
    try {
      document = JSON.parse(text)
    } catch {
      throw new Error('The file is not valid JSON.')
    }
    if (
      typeof document !== 'object' || document === null ||
      (document as { format?: unknown }).format !== EXPORT_FORMAT ||
      !Array.isArray((document as { runs?: unknown }).runs)
    ) {
      throw new Error(`The file is not a "${EXPORT_FORMAT}" export from this terminal.`)
    }
    const known = new Set(this.snapshot.records.map((record) => record.id))
    const incoming: RunRecord[] = []
    let skipped = 0
    for (const candidate of (document as { runs: unknown[] }).runs) {
      const parsed = runRecordSchema.safeParse(candidate)
      if (!parsed.success || parsed.data.outcome === null || known.has(parsed.data.id)) {
        skipped += 1
        continue
      }
      known.add(parsed.data.id)
      incoming.push(parsed.data)
    }
    if (incoming.length) {
      const merged = [...incoming, ...this.snapshot.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      this.commit(merged)
    }
    return { added: incoming.length, skipped }
  }

  private async pump(id: string, request: RunRequest, controller: AbortController): Promise<void> {
    let outcome: RunOutcome | null = null
    try {
      for await (const frame of this.streamer(request, controller.signal)) {
        this.update(id, (record) => applyFrame(record, frame))
      }
    } catch (error) {
      outcome = controller.signal.aborted ? { kind: 'stopped' } : errorOutcome(error)
    } finally {
      this.controllers.delete(id)
      // A record removed mid-stream stays removed.
      this.update(id, (record) => (record.outcome ? record : { ...record, outcome: outcome ?? { kind: 'interrupted' } }))
    }
  }

  private update(id: string, change: (record: RunRecord) => RunRecord): void {
    let found = false
    const records = this.snapshot.records.map((record) => {
      if (record.id !== id) return record
      found = true
      return change(record)
    })
    if (found) this.commit(records)
    else this.emit()
  }

  private commit(records: RunRecord[]): void {
    const live = new Set(this.controllers.keys())
    const persistence = this.persist(records)
    this.snapshot = { ...this.snapshot, records, live, persistence }
    this.emit()
  }

  private emit(): void {
    const live = new Set(this.controllers.keys())
    const changed = live.size !== this.snapshot.live.size || [...live].some((id) => !this.snapshot.live.has(id))
    if (changed) this.snapshot = { ...this.snapshot, live }
    for (const listener of this.listeners) listener()
  }

  /** Writes up to MAX_STORED_RUNS records, dropping the oldest finished runs if the quota is exceeded. */
  private persist(records: RunRecord[]): 'browser' | 'memory' {
    if (!this.storage) return 'memory'
    let kept = records.slice(0, MAX_STORED_RUNS)
    while (true) {
      if (writeItem(this.storage, STORAGE_KEY, JSON.stringify(kept))) return 'browser'
      if (kept.length <= 1) {
        removeItem(this.storage, STORAGE_KEY)
        return 'memory'
      }
      kept = kept.slice(0, -1)
    }
  }

  private load(): { records: RunRecord[]; dropped: number } {
    const text = readItem(this.storage, STORAGE_KEY)
    if (!text) return { records: [], dropped: 0 }
    let stored: unknown
    try {
      stored = JSON.parse(text)
    } catch {
      return { records: [], dropped: 1 }
    }
    if (!Array.isArray(stored)) return { records: [], dropped: 1 }
    const records: RunRecord[] = []
    let dropped = 0
    for (const candidate of stored) {
      const parsed = runRecordSchema.safeParse(candidate)
      if (!parsed.success) {
        dropped += 1
        continue
      }
      // A stream that was open when the page closed cannot be resumed: the API has no run IDs.
      records.push(parsed.data.outcome ? parsed.data : { ...parsed.data, outcome: { kind: 'interrupted' } })
    }
    return { records, dropped }
  }
}
