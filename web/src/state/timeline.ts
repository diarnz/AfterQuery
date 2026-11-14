import type { DecisionFrame } from '../contracts/frames'
import type { Observation, WorldEvent } from '../contracts/harbor'
import type { RunRecord } from './runRecord'

/**
 * One position in a run. Step 0 is the opening; step n is the n-th decision.
 * Every observation is the server's own post-step public snapshot: replay never
 * recomputes world state in the browser.
 */
export interface Step {
  index: number
  kind: 'opening' | 'decision'
  /** Round at which the step was taken (0 for the opening). */
  roundBefore: number
  /** Public snapshot after the step, exactly as the API sent it. */
  observation: Observation
  /** Public snapshot the decision was made from; null for the opening. */
  before: Observation | null
  events: WorldEvent[]
  decision: DecisionFrame | null
}

export function buildTimeline(record: RunRecord): Step[] {
  if (!record.opening) return []
  const steps: Step[] = [
    {
      index: 0,
      kind: 'opening',
      roundBefore: 0,
      observation: record.opening.observation,
      before: null,
      events: record.opening.events,
      decision: null,
    },
  ]
  let previous = record.opening.observation
  record.decisions.forEach((decision, position) => {
    steps.push({
      index: position + 1,
      kind: 'decision',
      roundBefore: previous.round,
      observation: decision.response.observation,
      before: previous,
      events: decision.response.events,
      decision,
    })
    previous = decision.response.observation
  })
  return steps
}

/** Clamp a requested cursor to the timeline; null or invalid means "latest". */
export function resolveCursor(steps: readonly Step[], requested: number | null): number {
  if (steps.length === 0) return 0
  if (requested === null || !Number.isInteger(requested)) return steps.length - 1
  return Math.min(Math.max(requested, 0), steps.length - 1)
}

/** The last step whose resulting observation is at or before the given round. */
export function stepAtRound(steps: readonly Step[], round: number): Step | undefined {
  let found: Step | undefined
  for (const step of steps) {
    if (step.observation.round <= round) found = step
  }
  return found
}
