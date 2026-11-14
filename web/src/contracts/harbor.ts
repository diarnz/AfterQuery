/**
 * Runtime schemas for what the Runbook API sends. Source of truth:
 * runbook/harbor/wire.py (observe, apply_tool) and runbook/api/app.py (run frames).
 *
 * z.object strips unknown keys, so additive server fields never break the UI.
 * A different observation schema version is rejected explicitly.
 */
import { z } from 'zod'

const int = z.number().int()
const count = int.nonnegative()

export const OBSERVATION_SCHEMA = 'harbor.observe.v1'

export const charterSchema = z.object({
  id: z.string(),
  goal: z.string(),
  rules: z.array(z.string()),
  horizon: count,
  cost_cap: count,
  slack_cap: count,
})

export const routeSchema = z.object({
  id: z.string(),
  source: z.string(),
  destination: z.string(),
  duration: int.positive(),
  cost: count,
  max_draft: int,
  entry_capacity: count,
  open: z.boolean(),
})

export const vesselSchema = z.object({
  id: z.string(),
  dock: z.string().nullable(),
  capacity: count,
  draft: int,
  voyage_id: z.string().nullable(),
})

export const lotSchema = z.object({
  id: z.string(),
  dock: z.string(),
  units: count,
  release_round: count,
})

export const jobSchema = z.object({
  id: z.string(),
  lot_id: z.string(),
  destination: z.string(),
  units: int.positive(),
  due_round: count,
  weight: count,
})

export const slotSchema = z.object({
  dock: z.string(),
  round: count,
  capacity: count,
  free: count,
})

export const holdSchema = z.object({
  vessel_id: z.string(),
  dock: z.string(),
  round: count,
})

export const loadSchema = z.object({
  job_id: z.string(),
  units: count,
})

export const voyageSchema = z.object({
  id: z.string(),
  vessel_id: z.string(),
  origin: z.string(),
  destination: z.string(),
  departed: count,
  arrival: count,
  route: z.array(z.string()),
  loads: z.array(loadSchema),
  cost: count,
})

export const receiptSchema = z.object({
  id: z.string(),
  voyage_id: z.string(),
  job_id: z.string(),
  lot_id: z.string(),
  destination: z.string(),
  round: count,
  units: count,
})

/** Kinds are kept open: an unknown kind renders generically instead of failing the run. */
export const noticeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  published_round: count,
  effective_round: count,
  target: z.string(),
  value: int,
  arrival_round: count,
})

export const observationSchema = z.object({
  schema: z.literal(OBSERVATION_SCHEMA),
  charter: charterSchema,
  episode_state: z.enum(['active', 'closed']),
  terminal_reason: z.string().nullable(),
  round: count,
  revision: count,
  horizon: count,
  docks: z.array(z.string()),
  limits: z.object({ max_operations_per_batch: count, max_route_edges: count }),
  cost_cap: count,
  slack_cap: count,
  jobs: z.array(jobSchema),
  vessels: z.array(vesselSchema),
  lots: z.array(lotSchema),
  routes: z.array(routeSchema),
  slots: z.array(slotSchema),
  holds: z.array(holdSchema),
  voyages: z.array(voyageSchema),
  receipts: z.array(receiptSchema),
  notices: z.array(noticeSchema),
  spent: count,
})

export const worldEventSchema = z.object({
  type: z.string(),
  round: count,
  data: z.record(z.string(), z.unknown()),
})

export const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reserve_berth'), vessel_id: z.string(), dock_id: z.string(), arrival_round: count }),
  z.object({ type: z.literal('release_berth'), vessel_id: z.string() }),
  z.object({ type: z.literal('dispatch'), vessel_id: z.string(), route: z.array(z.string()), loads: z.array(loadSchema) }),
])

export const toolRequestSchema = z.object({
  expected_revision: count,
  action_id: z.string(),
  operations: z.array(operationSchema).optional(),
})

export const apiErrorSchema = z.object({ code: z.string(), message: z.string() })

export const toolResponseSchema = z.object({
  action_id: z.string().nullable(),
  accepted: z.boolean(),
  error: apiErrorSchema.nullable(),
  events: z.array(worldEventSchema),
  observation: observationSchema,
})

export type Charter = z.infer<typeof charterSchema>
export type Route = z.infer<typeof routeSchema>
export type Vessel = z.infer<typeof vesselSchema>
export type Lot = z.infer<typeof lotSchema>
export type Job = z.infer<typeof jobSchema>
export type Slot = z.infer<typeof slotSchema>
export type Hold = z.infer<typeof holdSchema>
export type Load = z.infer<typeof loadSchema>
export type Voyage = z.infer<typeof voyageSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type Notice = z.infer<typeof noticeSchema>
export type Observation = z.infer<typeof observationSchema>
export type WorldEvent = z.infer<typeof worldEventSchema>
export type Operation = z.infer<typeof operationSchema>
export type ToolRequest = z.infer<typeof toolRequestSchema>
export type ToolResponse = z.infer<typeof toolResponseSchema>
export type ApiError = z.infer<typeof apiErrorSchema>
