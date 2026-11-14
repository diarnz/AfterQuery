export type Scenario = 'fixture' | 'forecast_closure' | 'reactive_closure' | 'open_canal'
export type Policy = 'reference' | 'idle' | 'stop-early'

export interface Observation {
  round: number
  horizon: number
  spent: number
  docks: string[]
  jobs: { id: string; units: number; due_round: number; destination: string }[]
  vessels: { id: string; dock: string | null; voyage_id: string | null }[]
  routes: { id: string; source: string; destination: string; duration: number; open: boolean }[]
  voyages: { id: string; destination: string; arrival: number }[]
  receipts: { job_id: string; units: number; round: number }[]
}

export interface WorldEvent {
  type: string
  round: number
  data: Record<string, unknown>
}

export interface Result {
  planner_score: number
  complete: boolean
  reason: string
}

type RunEvent =
  | { type: 'opening'; observation: Observation; events: WorldEvent[]; scenario_hash: string; seed: number | null }
  | {
      type: 'decision'
      tool: string
      response: { observation: Observation; events: WorldEvent[] }
    }
  | { type: 'complete'; result: Result }
  | { type: 'failed'; error: { code: string; message: string } }

export async function* startRun(
  scenario: Scenario,
  policy: Policy,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, policy }),
    signal,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Could not start run (HTTP ${response.status}).`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let lineEnd = buffer.indexOf('\n')
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd)
        buffer = buffer.slice(lineEnd + 1)
        if (line.trim()) yield JSON.parse(line) as RunEvent
        lineEnd = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) throw new Error('The run stream ended mid-event.')
  } finally {
    await reader.cancel()
  }
}
