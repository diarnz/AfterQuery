import { canonicalJson } from '../../lib/format'
import type { Step } from '../../state/timeline'

export interface AlignedRound {
  round: number
  a: Step[]
  b: Step[]
  /** True when the accepted decisions taken at this round differ between the runs. */
  differs: boolean
}

export interface Alignment {
  rounds: AlignedRound[]
  /** First round whose decisions differ, or null when both runs decided identically. */
  firstDivergence: number | null
}

function decisionKey(steps: readonly Step[]): string {
  return canonicalJson(
    steps.map((step) => ({
      tool: step.decision?.tool,
      operations: step.decision?.request.operations ?? [],
      accepted: step.decision?.response.accepted,
    })),
  )
}

/**
 * Aligns two runs by simulation round, not by step, so differing numbers of
 * steps do not shift the comparison. Payloads are compared in canonical form.
 * This is a client-side comparison of the decisions the API recorded.
 */
export function alignRuns(a: readonly Step[], b: readonly Step[]): Alignment {
  const byRound = (steps: readonly Step[]) => {
    const map = new Map<number, Step[]>()
    for (const step of steps) {
      if (!step.decision) continue
      map.set(step.roundBefore, [...(map.get(step.roundBefore) ?? []), step])
    }
    return map
  }
  const mapA = byRound(a)
  const mapB = byRound(b)
  const lastRound = Math.max(-1, ...mapA.keys(), ...mapB.keys())
  const rounds: AlignedRound[] = []
  let firstDivergence: number | null = null
  for (let round = 0; round <= lastRound; round += 1) {
    const stepsA = mapA.get(round) ?? []
    const stepsB = mapB.get(round) ?? []
    if (stepsA.length === 0 && stepsB.length === 0) continue
    const differs = decisionKey(stepsA) !== decisionKey(stepsB)
    if (differs && firstDivergence === null) firstDivergence = round
    rounds.push({ round, a: stepsA, b: stepsB, differs })
  }
  return { rounds, firstDivergence }
}
