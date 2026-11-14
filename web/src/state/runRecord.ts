import { z } from 'zod'
import { apiErrorSchema } from '../contracts/harbor'
import { decisionFrameSchema, openingFrameSchema, runResultSchema, type DecisionFrame, type OpeningFrame, type RunFrame } from '../contracts/frames'
import type { RunRequest } from '../contracts/catalog'

/**
 * A run as this browser received it from POST /api/runs. The API keeps no run
 * history, so the record is the only copy; it is never presented as server-held.
 */
export const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete'), result: runResultSchema }),
  z.object({ kind: z.literal('failed'), error: apiErrorSchema }),
  z.object({ kind: z.literal('error'), error: apiErrorSchema }),
  z.object({ kind: z.literal('stopped') }),
  z.object({ kind: z.literal('interrupted') }),
])

export const runRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9-]{4,64}$/),
  createdAt: z.iso.datetime(),
  request: z.object({
    scenario: z.string(),
    policy: z.string(),
    seed: z.number().int().nonnegative().nullable(),
  }),
  opening: openingFrameSchema.nullable(),
  decisions: z.array(decisionFrameSchema),
  outcome: outcomeSchema.nullable(),
})

export type RunOutcome = z.infer<typeof outcomeSchema>

export interface RunRecord {
  schemaVersion: 1
  id: string
  createdAt: string
  request: RunRequest
  opening: OpeningFrame | null
  decisions: DecisionFrame[]
  /** null while the stream is open. */
  outcome: RunOutcome | null
}

export type RunStatus = 'live' | RunOutcome['kind']

export function runStatus(record: RunRecord): RunStatus {
  return record.outcome?.kind ?? 'live'
}

export function newRunRecord(id: string, request: RunRequest, createdAt: Date): RunRecord {
  return {
    schemaVersion: 1,
    id,
    createdAt: createdAt.toISOString(),
    request,
    opening: null,
    decisions: [],
    outcome: null,
  }
}

export function applyFrame(record: RunRecord, frame: RunFrame): RunRecord {
  switch (frame.type) {
    case 'opening':
      return { ...record, opening: frame }
    case 'decision':
      return { ...record, decisions: [...record.decisions, frame] }
    case 'complete':
      return { ...record, outcome: { kind: 'complete', result: frame.result } }
    case 'failed':
      return { ...record, outcome: { kind: 'failed', error: frame.error } }
  }
}

/** Latest public observation the run has delivered. */
export function latestObservation(record: RunRecord) {
  const last = record.decisions.at(-1)
  return last ? last.response.observation : record.opening?.observation ?? null
}

/** Short, stable display form of a run ID. */
export function shortRunId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}
