import { describe, expect, it } from 'vitest'
import { MAX_LINES, SESSION_KEY, TerminalSession } from './terminalSession'
import type { KeyValueStorage } from './storage'

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

const at = () => new Date('2026-11-14T09:08:07')

describe('TerminalSession', () => {
  it('timestamps lines, logs keyed lines once, and caps the transcript', () => {
    const session = new TerminalSession(null, at)
    session.log('input', 'model selected: idle')
    session.logOnce('catalog', 'system', 'catalog loaded')
    session.logOnce('catalog', 'system', 'catalog loaded')
    expect(session.getSnapshot().lines.map((line) => [line.at, line.tone, line.text])).toEqual([
      ['09:08:07', 'input', 'model selected: idle'],
      ['09:08:07', 'system', 'catalog loaded'],
    ])
    for (let index = 0; index < MAX_LINES + 5; index += 1) session.log('muted', `line ${index}`)
    expect(session.getSnapshot().lines).toHaveLength(MAX_LINES)
  })

  it('restores the transcript and choices after a reload and notes it', () => {
    const storage = new MemoryStorage()
    const first = new TerminalSession(storage, at)
    first.logOnce('catalog', 'system', 'catalog loaded')
    first.choose({ policy: 'stop-early', seedText: '42' })
    first.log('input', 'model selected: stop-early')
    const second = new TerminalSession(storage, at)
    second.logOnce('catalog', 'system', 'catalog loaded')
    const { lines, choices } = second.getSnapshot()
    expect(choices).toEqual({ policy: 'stop-early', scenario: '', seedText: '42' })
    expect(lines.map((line) => line.text)).toEqual(['catalog loaded', 'model selected: stop-early', 'page reloaded: session restored'])
    expect(new Set(lines.map((line) => line.id)).size).toBe(3)
  })

  it('ignores a corrupt stored session', () => {
    const storage = new MemoryStorage()
    storage.setItem(SESSION_KEY, '{not json')
    expect(new TerminalSession(storage, at).getSnapshot().lines).toEqual([])
    storage.setItem(SESSION_KEY, JSON.stringify({ lines: [{ id: 1, at: 'x', tone: 'evil', text: 'x' }], choices: {} }))
    expect(new TerminalSession(storage, at).getSnapshot().lines).toEqual([])
  })
})
