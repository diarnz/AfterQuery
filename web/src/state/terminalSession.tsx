import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { readItem, writeItem, type KeyValueStorage } from './storage'

export type LineTone = 'system' | 'input' | 'ok' | 'error' | 'muted'

export interface ConsoleLine {
  id: number
  /** Local wall-clock time, HH:MM:SS. */
  at: string
  tone: LineTone
  text: string
}

export interface RunChoices {
  policy: string
  scenario: string
  seedText: string
}

export interface SessionSnapshot {
  lines: readonly ConsoleLine[]
  choices: RunChoices
}

export const MAX_LINES = 300
export const SESSION_KEY = 'runbook.session.v1'
const TONES: ReadonlySet<string> = new Set(['system', 'input', 'ok', 'error', 'muted'])

function clock(date: Date): string {
  return date.toTimeString().slice(0, 8)
}

function isLine(value: unknown): value is ConsoleLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown>
  return (
    typeof line.id === 'number' &&
    Number.isInteger(line.id) &&
    typeof line.at === 'string' &&
    typeof line.text === 'string' &&
    typeof line.tone === 'string' &&
    TONES.has(line.tone)
  )
}

function restore(storage: KeyValueStorage | null): (SessionSnapshot & { once: string[] }) | null {
  const text = readItem(storage, SESSION_KEY)
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const { lines, choices, once } = value as { lines?: unknown; choices?: unknown; once?: unknown }
    if (!Array.isArray(lines) || typeof choices !== 'object' || choices === null) return null
    const raw = choices as Record<string, unknown>
    const pick = (key: keyof RunChoices) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
    return {
      lines: lines.filter(isLine).slice(-MAX_LINES),
      choices: { policy: pick('policy'), scenario: pick('scenario'), seedText: pick('seedText') },
      once: Array.isArray(once) ? once.filter((key): key is string => typeof key === 'string') : [],
    }
  } catch {
    return null
  }
}

/**
 * The operator's session in this tab: the console transcript and the current
 * run choices. It lives above the router so both survive moving between the
 * console and a run, and in per-tab storage so a reload keeps them. A new tab starts clean.
 */
export class TerminalSession {
  private snapshot: SessionSnapshot = { lines: [], choices: { policy: '', scenario: '', seedText: '' } }
  private nextId = 1
  private readonly once = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly storage: KeyValueStorage | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {
    const restored = restore(storage)
    if (restored) {
      this.snapshot = { lines: restored.lines, choices: restored.choices }
      for (const key of restored.once) this.once.add(key)
      this.nextId = Math.max(0, ...restored.lines.map((line) => line.id)) + 1
      if (restored.lines.length) this.log('muted', 'page reloaded: session restored')
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): SessionSnapshot => this.snapshot

  log(tone: LineTone, text: string): void {
    const line: ConsoleLine = { id: this.nextId++, at: clock(this.now()), tone, text }
    const lines = [...this.snapshot.lines, line].slice(-MAX_LINES)
    this.snapshot = { ...this.snapshot, lines }
    this.emit()
  }

  /** Logs a line only the first time a key is seen in this session (for example, the catalog loading). */
  logOnce(key: string, tone: LineTone, text: string): void {
    if (this.once.has(key)) return
    this.once.add(key)
    this.log(tone, text)
  }

  choose(changes: Partial<RunChoices>): void {
    this.snapshot = { ...this.snapshot, choices: { ...this.snapshot.choices, ...changes } }
    this.emit()
  }

  clear(): void {
    this.snapshot = { ...this.snapshot, lines: [] }
    this.emit()
  }

  private emit(): void {
    writeItem(this.storage, SESSION_KEY, JSON.stringify({ ...this.snapshot, once: [...this.once] }))
    for (const listener of this.listeners) listener()
  }
}

const SessionContext = createContext<TerminalSession | null>(null)

export function TerminalSessionProvider({ session, children }: { session: TerminalSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useTerminalSession(): TerminalSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useTerminalSession must be used inside TerminalSessionProvider.')
  return session
}

export function useSessionSnapshot(): SessionSnapshot {
  const session = useTerminalSession()
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
}
