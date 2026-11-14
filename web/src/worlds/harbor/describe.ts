import type { Observation } from '../../contracts/harbor'
import { roundTag } from '../../lib/format'
import { loadsText, noticeText } from './format'

/** Plain-text description of the public snapshot, for screen readers and the text view. */
export function describeHarbor(observation: Observation): string[] {
  const lines: string[] = []
  lines.push(`Round ${observation.round} of ${observation.horizon}. Episode ${observation.episode_state}. Spend ${observation.spent} of cap ${observation.cost_cap}.`)
  for (const route of observation.routes) {
    lines.push(
      `Route ${route.id} from ${route.source} to ${route.destination}: ${route.open ? 'open' : 'closed'}, ${route.duration} round${route.duration === 1 ? '' : 's'}, cost ${route.cost}, maximum draft ${route.max_draft}.`,
    )
  }
  for (const vessel of observation.vessels) {
    const voyage = vessel.voyage_id ? observation.voyages.find((item) => item.id === vessel.voyage_id) : undefined
    const where = voyage
      ? `in transit to ${voyage.destination}, arriving ${roundTag(voyage.arrival)}, carrying ${loadsText(voyage.loads)}`
      : vessel.dock
        ? `idle at ${vessel.dock}`
        : 'location not reported'
    lines.push(`Vessel ${vessel.id}, capacity ${vessel.capacity}, draft ${vessel.draft}: ${where}.`)
  }
  for (const lot of observation.lots) {
    const release = lot.release_round > observation.round ? `, loadable from ${roundTag(lot.release_round)}` : ''
    lines.push(`Lot ${lot.id}: ${lot.units} units at ${lot.dock}${release}.`)
  }
  for (const notice of observation.notices) {
    const state = notice.effective_round <= observation.round ? 'in effect' : 'scheduled'
    lines.push(`Notice ${notice.id} (${state}): ${noticeText(notice, observation.round)}.`)
  }
  return lines
}
