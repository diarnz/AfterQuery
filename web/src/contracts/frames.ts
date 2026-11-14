/**
 * NDJSON frames streamed by POST /api/runs (runbook/api/app.py, run_events).
 * Order: one opening, zero or more decisions, then exactly one complete or failed.
 */
import { z } from 'zod'
import { apiErrorSchema, observationSchema, toolRequestSchema, toolResponseSchema, worldEventSchema } from './harbor'

export const openingFrameSchema = z.object({
  type: z.literal('opening'),
  scenario: z.string(),
  scenario_hash: z.string().regex(/^[0-9a-f]{64}$/, 'Expected a sha256 hex fingerprint.'),
  seed: z.number().int().nonnegative().nullable(),
  observation: observationSchema,
  events: z.array(worldEventSchema),
})

export const decisionFrameSchema = z.object({
  type: z.literal('decision'),
  tool: z.enum(['commit', 'wait', 'finish']),
  request: toolRequestSchema,
  response: toolResponseSchema,
})

export const runResultSchema = z.object({
  planner_score: z.number().finite(),
  complete: z.boolean(),
  reason: z.string(),
})

export const completeFrameSchema = z.object({
  type: z.literal('complete'),
  result: runResultSchema,
})

export const failedFrameSchema = z.object({
  type: z.literal('failed'),
  error: apiErrorSchema,
})

export const runFrameSchema = z.discriminatedUnion('type', [
  openingFrameSchema,
  decisionFrameSchema,
  completeFrameSchema,
  failedFrameSchema,
])

export type OpeningFrame = z.infer<typeof openingFrameSchema>
export type DecisionFrame = z.infer<typeof decisionFrameSchema>
export type CompleteFrame = z.infer<typeof completeFrameSchema>
export type FailedFrame = z.infer<typeof failedFrameSchema>
export type RunFrame = z.infer<typeof runFrameSchema>
export type RunResult = z.infer<typeof runResultSchema>
