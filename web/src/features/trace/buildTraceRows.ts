import type { ApiError, Operation } from '../../contracts/harbor'
import type { EntityRef } from '../../lib/entities'
import { hasEntity } from '../../lib/entities'
import type { Step } from '../../state/timeline'
import { classifyEvent, eventEntities, eventText, operationsEntities, type EventText } from '../../worlds/harbor'

export type TraceRow =
  | { kind: 'round'; key: string; round: number }
  | {
      kind: 'decision'
      key: string
      step: number
      round: number
      tool: string
      operations: Operation[]
      accepted: boolean
      error: ApiError | null
      actionId: string
      revisionFrom: number
      revisionTo: number
      entities: EntityRef[]
    }
  | { kind: 'event'; key: string; step: number; round: number; text: EventText; entities: EntityRef[] }

/**
 * Rows for every step up to and including the cursor, grouped under a header
 * whenever the round changes. Decisions sit at the round they were taken; the
 * arrivals and notices they cause carry their own (later) round.
 */
export function buildTraceRows(steps: readonly Step[], cursor: number, pinned: EntityRef | null): TraceRow[] {
  const rows: TraceRow[] = []
  let currentRound = -1
  const pushRound = (round: number, key: string) => {
    if (round === currentRound) return
    currentRound = round
    rows.push({ kind: 'round', key: `round-${key}-${round}`, round })
  }

  for (const step of steps) {
    if (step.index > cursor) break
    const jobs = step.observation.jobs
    if (step.decision) {
      const { decision } = step
      const operations = decision.request.operations ?? []
      const entities = operationsEntities(operations)
      if (!pinned || hasEntity(entities, pinned)) {
        pushRound(step.roundBefore, `s${step.index}`)
        rows.push({
          kind: 'decision',
          key: `decision-${step.index}`,
          step: step.index,
          round: step.roundBefore,
          tool: decision.tool,
          operations,
          accepted: decision.response.accepted,
          error: decision.response.error,
          actionId: decision.request.action_id,
          revisionFrom: decision.request.expected_revision,
          revisionTo: decision.response.observation.revision,
          entities,
        })
      }
    }
    step.events.forEach((event, position) => {
      const classified = classifyEvent(event)
      const entities = eventEntities(classified, step.observation)
      if (pinned && !hasEntity(entities, pinned)) return
      pushRound(event.round, `s${step.index}e${position}`)
      rows.push({
        kind: 'event',
        key: `event-${step.index}-${position}`,
        step: step.index,
        round: event.round,
        text: eventText(classified, jobs),
        entities,
      })
    })
  }
  return rows
}
