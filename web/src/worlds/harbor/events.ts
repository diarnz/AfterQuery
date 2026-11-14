/**
 * Typed views of the Harbor events emitted by runbook/harbor/engine.py.
 * Unknown types, or known types with unexpected data, become "unknown" and are
 * rendered with their raw payload rather than guessed at.
 */
import { z } from 'zod'
import { holdSchema, noticeSchema, receiptSchema, voyageSchema, type Hold, type Notice, type Receipt, type Voyage, type WorldEvent } from '../../contracts/harbor'

export type HarborEvent =
  | { type: 'berth_reserved' | 'berth_released' | 'berth_expired'; round: number; hold: Hold }
  | { type: 'voyage_dispatched'; round: number; voyage: Voyage }
  | { type: 'voyage_arrived'; round: number; voyageId: string }
  | { type: 'delivery_receipted'; round: number; receipt: Receipt }
  | { type: 'notice_published' | 'notice_applied'; round: number; notice: Notice }
  | { type: 'run_closed'; round: number; reason: string }
  | { type: 'unknown'; round: number; raw: WorldEvent }

const arrivedSchema = z.object({ voyage_id: z.string() })
const closedSchema = z.object({ reason: z.string() })

export function classifyEvent(event: WorldEvent): HarborEvent {
  const unknown: HarborEvent = { type: 'unknown', round: event.round, raw: event }
  switch (event.type) {
    case 'berth_reserved':
    case 'berth_released':
    case 'berth_expired': {
      const parsed = holdSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, hold: parsed.data } : unknown
    }
    case 'voyage_dispatched': {
      const parsed = voyageSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, voyage: parsed.data } : unknown
    }
    case 'voyage_arrived': {
      const parsed = arrivedSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, voyageId: parsed.data.voyage_id } : unknown
    }
    case 'delivery_receipted': {
      const parsed = receiptSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, receipt: parsed.data } : unknown
    }
    case 'notice_published':
    case 'notice_applied': {
      const parsed = noticeSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, notice: parsed.data } : unknown
    }
    case 'run_closed': {
      const parsed = closedSchema.safeParse(event.data)
      return parsed.success ? { type: event.type, round: event.round, reason: parsed.data.reason } : unknown
    }
    default:
      return unknown
  }
}
