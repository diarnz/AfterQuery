import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readItem, writeItem, type KeyValueStorage } from './storage'

export type ThemeChoice = 'system' | 'dark' | 'parchment'

export interface Preferences {
  theme: ThemeChoice
  projector: boolean
  resultsCollapsed: boolean
  traceWidth: number
}

const KEY = 'runbook.preferences.v1'
export const TRACE_WIDTH_MIN = 300
export const TRACE_WIDTH_MAX = 640
const DEFAULTS: Preferences = { theme: 'system', projector: false, resultsCollapsed: false, traceWidth: 400 }

function load(storage: KeyValueStorage | null): Preferences {
  const text = readItem(storage, KEY)
  if (!text) return DEFAULTS
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return DEFAULTS
    const raw = value as Partial<Record<keyof Preferences, unknown>>
    const theme = raw.theme === 'dark' || raw.theme === 'parchment' || raw.theme === 'system' ? raw.theme : DEFAULTS.theme
    const width = typeof raw.traceWidth === 'number' && Number.isFinite(raw.traceWidth)
      ? Math.min(Math.max(Math.round(raw.traceWidth), TRACE_WIDTH_MIN), TRACE_WIDTH_MAX)
      : DEFAULTS.traceWidth
    return {
      theme,
      projector: raw.projector === true,
      resultsCollapsed: raw.resultsCollapsed === true,
      traceWidth: width,
    }
  } catch {
    return DEFAULTS
  }
}

interface PreferencesValue extends Preferences {
  set<K extends keyof Preferences>(key: K, value: Preferences[K]): void
  cycleTheme(): void
}

const PreferencesContext = createContext<PreferencesValue | null>(null)

export function PreferencesProvider({ storage, children }: { storage: KeyValueStorage | null; children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => load(storage))

  useEffect(() => {
    writeItem(storage, KEY, JSON.stringify(preferences))
    const root = document.documentElement
    if (preferences.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = preferences.theme
    root.classList.toggle('projector', preferences.projector)
  }, [preferences, storage])

  const set = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  const cycleTheme = useCallback(() => {
    setPreferences((current) => ({
      ...current,
      theme: current.theme === 'system' ? 'dark' : current.theme === 'dark' ? 'parchment' : 'system',
    }))
  }, [])

  const value = useMemo(() => ({ ...preferences, set, cycleTheme }), [preferences, set, cycleTheme])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext)
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider.')
  return value
}
