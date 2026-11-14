import { humanize } from '../../lib/format'
import type { RunStatus } from '../../state/runRecord'
import type { BadgeTone } from '../../ui'

const SCENARIO_LABELS: Record<string, string> = {
  fixture: 'Appendix G fixture',
  forecast_closure: 'Forecast closure',
  reactive_closure: 'Reactive closure',
  open_canal: 'Open canal',
}

const SCENARIO_HINTS: Record<string, string> = {
  fixture: 'Hand-computed manifest. The seed is ignored.',
  forecast_closure: 'Generated. The canal closure is announced at the opening.',
  reactive_closure: 'Generated. The closure is announced only when it takes effect.',
  open_canal: 'Generated control. The short canal stays open.',
}

const POLICY_LABELS: Record<string, string> = {
  reference: 'Reference planner',
  idle: 'Idle baseline (does nothing)',
  'stop-early': 'Stop-early baseline',
}

export function scenarioLabel(id: string): string {
  return SCENARIO_LABELS[id] ?? humanize(id)
}

export function scenarioHint(id: string): string | undefined {
  return SCENARIO_HINTS[id]
}

export function policyLabel(id: string): string {
  return POLICY_LABELS[id] ?? humanize(id)
}

export const STATUS_BADGE: Record<RunStatus, { tone: BadgeTone; glyph: string; label: string }> = {
  live: { tone: 'live', glyph: '●', label: 'Live' },
  complete: { tone: 'muted', glyph: '▣', label: 'Finished' },
  failed: { tone: 'error', glyph: '✕', label: 'Policy action rejected' },
  error: { tone: 'infra', glyph: '⚠', label: 'Stream error' },
  stopped: { tone: 'pending', glyph: '■', label: 'Stopped' },
  interrupted: { tone: 'infra', glyph: '⚠', label: 'Interrupted' },
}
