import type { Observation, Operation } from '../../contracts/harbor'
import type { EntityRef } from '../../lib/entities'
import type { HarborEvent } from './events'

function dedupe(list: EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  return list.filter((entity) => {
    const key = `${entity.kind}:${entity.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A notice targets a route or a dock; which one is decided by the public observation. */
function noticeTarget(target: string, observation: Observation): EntityRef[] {
  if (observation.routes.some((route) => route.id === target)) return [{ kind: 'route', id: target }]
  if (observation.docks.includes(target)) return [{ kind: 'dock', id: target }]
  return []
}

export function operationEntities(operation: Operation): EntityRef[] {
  switch (operation.type) {
    case 'reserve_berth':
      return [{ kind: 'vessel', id: operation.vessel_id }, { kind: 'dock', id: operation.dock_id }]
    case 'release_berth':
      return [{ kind: 'vessel', id: operation.vessel_id }]
    case 'dispatch':
      return [
        { kind: 'vessel', id: operation.vessel_id },
        ...operation.route.map((id): EntityRef => ({ kind: 'route', id })),
        ...operation.loads.map((load): EntityRef => ({ kind: 'job', id: load.job_id })),
      ]
  }
}

export function eventEntities(event: HarborEvent, observation: Observation): EntityRef[] {
  switch (event.type) {
    case 'berth_reserved':
    case 'berth_released':
    case 'berth_expired':
      return [{ kind: 'vessel', id: event.hold.vessel_id }, { kind: 'dock', id: event.hold.dock }]
    case 'voyage_dispatched':
      return dedupe([
        { kind: 'vessel', id: event.voyage.vessel_id },
        { kind: 'dock', id: event.voyage.origin },
        { kind: 'dock', id: event.voyage.destination },
        ...event.voyage.route.map((id): EntityRef => ({ kind: 'route', id })),
        ...event.voyage.loads.map((load): EntityRef => ({ kind: 'job', id: load.job_id })),
      ])
    case 'voyage_arrived': {
      const voyage = observation.voyages.find((item) => item.id === event.voyageId)
      return voyage ? [{ kind: 'vessel', id: voyage.vessel_id }, { kind: 'dock', id: voyage.destination }] : []
    }
    case 'delivery_receipted':
      return [{ kind: 'job', id: event.receipt.job_id }, { kind: 'dock', id: event.receipt.destination }]
    case 'notice_published':
    case 'notice_applied':
      return noticeTarget(event.notice.target, observation)
    case 'run_closed':
    case 'unknown':
      return []
  }
}

export function operationsEntities(operations: readonly Operation[]): EntityRef[] {
  return dedupe(operations.flatMap(operationEntities))
}
