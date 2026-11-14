import type { Job, Load, Notice, Operation, Voyage } from '../../contracts/harbor'
import { humanize, roundTag } from '../../lib/format'
import type { HarborEvent } from './events'

export type Tone = 'ok' | 'error' | 'notice' | 'pending' | 'muted'

export interface EventText {
  glyph: string
  tone: Tone
  title: string
  detail: string
}

export function loadsText(loads: readonly Load[]): string {
  if (loads.length === 0) return 'empty (repositioning)'
  return loads.map((load) => `${load.job_id} ×${load.units}`).join(', ')
}

/** Describes a notice's change. "future" for announced changes, "past" once in effect. */
export function noticeChange(notice: Notice, tense: 'future' | 'past' = 'future'): string {
  const past = tense === 'past'
  switch (notice.kind) {
    case 'close_route':
      return `${notice.target} ${past ? 'closed' : 'closes'}`
    case 'open_route':
      return `${notice.target} ${past ? 'reopened' : 'opens'}`
    case 'set_draft':
      return `${notice.target} max draft ${past ? 'is' : 'becomes'} ${notice.value}`
    case 'set_berth_capacity':
      return `${notice.target} berth at ${roundTag(notice.arrival_round)} capacity ${past ? 'is' : 'becomes'} ${notice.value}`
    default:
      return `${humanize(notice.kind)} · ${notice.target}`
  }
}

/** Full sentence, tensed against the round it is read at. */
export function noticeText(notice: Notice, round = -1): string {
  return notice.effective_round <= round
    ? `${noticeChange(notice, 'past')} since ${roundTag(notice.effective_round)}`
    : `${noticeChange(notice)} at ${roundTag(notice.effective_round)}`
}

export function operationText(operation: Operation): string {
  switch (operation.type) {
    case 'reserve_berth':
      return `Reserve ${operation.dock_id} berth at ${roundTag(operation.arrival_round)} for ${operation.vessel_id}`
    case 'release_berth':
      return `Release the berth hold of ${operation.vessel_id}`
    case 'dispatch':
      return `Dispatch ${operation.vessel_id} via ${operation.route.join(' → ')} · ${loadsText(operation.loads)}`
  }
}

function voyageText(voyage: Voyage): string {
  return `${voyage.vessel_id} via ${voyage.route.join(' → ')} to ${voyage.destination} · ETA ${roundTag(voyage.arrival)} · ${loadsText(voyage.loads)} · cost ${voyage.cost}`
}

export function eventText(event: HarborEvent, jobs: readonly Job[]): EventText {
  switch (event.type) {
    case 'berth_reserved':
      return { glyph: '◧', tone: 'muted', title: 'Berth held', detail: `${event.hold.dock} at ${roundTag(event.hold.round)} for ${event.hold.vessel_id}` }
    case 'berth_released':
      return { glyph: '□', tone: 'muted', title: 'Berth released', detail: `${event.hold.dock} at ${roundTag(event.hold.round)} from ${event.hold.vessel_id}` }
    case 'berth_expired':
      return { glyph: '□', tone: 'muted', title: 'Unused hold expired', detail: `${event.hold.dock} at ${roundTag(event.hold.round)} for ${event.hold.vessel_id}` }
    case 'voyage_dispatched':
      return { glyph: '⛵', tone: 'pending', title: 'Voyage dispatched', detail: voyageText(event.voyage) }
    case 'voyage_arrived':
      return { glyph: '⚓', tone: 'muted', title: 'Voyage arrived', detail: event.voyageId }
    case 'delivery_receipted': {
      const { receipt } = event
      const job = jobs.find((item) => item.id === receipt.job_id)
      const late = job !== undefined && receipt.round > job.due_round
      const timing = job ? (late ? `late, due ${roundTag(job.due_round)}` : `on time, due ${roundTag(job.due_round)}`) : 'job not in charter'
      return {
        glyph: late ? '✕' : '■',
        tone: late ? 'error' : 'ok',
        title: late ? 'Late delivery' : 'Delivered',
        detail: `${receipt.job_id} ×${receipt.units} at ${receipt.destination} · ${roundTag(receipt.round)} · ${timing}`,
      }
    }
    case 'notice_published':
      return { glyph: '◆', tone: 'notice', title: 'Notice published', detail: noticeText(event.notice) }
    case 'notice_applied':
      return { glyph: '◆', tone: 'notice', title: 'Notice in effect', detail: noticeChange(event.notice, 'past') }
    case 'run_closed':
      return { glyph: '⏹', tone: 'muted', title: 'Run closed', detail: humanize(event.reason) }
    case 'unknown':
      return { glyph: '?', tone: 'muted', title: `Unrecognized event · ${event.raw.type}`, detail: JSON.stringify(event.raw.data) }
  }
}

export const TERMINAL_REASONS: Record<string, string> = {
  finished: 'Finished by the policy',
  horizon: 'Reached the horizon',
}
