import { describe, expect, it } from 'vitest'
import { recordFrom } from '../../test/fixtures'
import { buildTimeline } from '../../state/timeline'
import { describeHarbor } from './describe'
import { eventEntities, operationsEntities } from './entities'
import { classifyEvent } from './events'
import { eventText, noticeText, operationText } from './format'
import { dockPositions, edgeGeometry, voyagePoint } from './layout'
import { obligations } from './obligations'

const reference = buildTimeline(recordFrom('fixture-reference'))
const stopEarly = buildTimeline(recordFrom('fixture-stop-early'))

describe('obligations', () => {
  it('shows cloth in transit after the round-2 dispatch and grain already met', () => {
    const step = reference[3]
    if (!step) throw new Error('missing step')
    const rows = obligations(step.observation)
    expect(rows.map((row) => [row.job.id, row.onTime, row.inTransit, row.status])).toEqual([
      ['cloth-east', 0, 4, 'in_transit'],
      ['grain-north', 3, 0, 'met'],
    ])
  })

  it('meets both obligations at the end of the reference run', () => {
    const last = reference.at(-1)
    if (!last) throw new Error('missing step')
    expect(obligations(last.observation).map((row) => row.status)).toEqual(['met', 'met'])
  })

  it('marks cloth missed when the stop-early baseline closes the run', () => {
    const last = stopEarly.at(-1)
    if (!last) throw new Error('missing step')
    expect(obligations(last.observation).map((row) => [row.job.id, row.status])).toEqual([
      ['cloth-east', 'missed'],
      ['grain-north', 'met'],
    ])
  })
})

describe('event classification and text', () => {
  it('classifies every event in the recorded streams without falling back to unknown', () => {
    for (const name of ['fixture-reference', 'reactive-closure-42-reference', 'open-canal-7-reference'] as const) {
      for (const step of buildTimeline(recordFrom(name))) {
        for (const event of step.events) expect(classifyEvent(event).type, event.type).not.toBe('unknown')
      }
    }
  })

  it('describes a receipt as on time against its due round', () => {
    const arrival = reference[4]?.events.find((event) => event.type === 'delivery_receipted')
    const step = reference[4]
    if (!arrival || !step) throw new Error('missing receipt')
    expect(eventText(classifyEvent(arrival), step.observation.jobs)).toMatchObject({
      title: 'Delivered',
      tone: 'ok',
      detail: 'cloth-east ×4 at east · r4 · on time, due r4',
    })
  })

  it('keeps unknown event types visible with their raw data', () => {
    const text = eventText(classifyEvent({ type: 'tide_turned', round: 3, data: { level: 2 } }), [])
    expect(text.title).toBe('Unrecognized event · tide_turned')
    expect(text.detail).toBe('{"level":2}')
  })

  it('tenses notices by the round they are read at', () => {
    const notice = reference[0]?.observation.notices[0]
    if (!notice) throw new Error('missing notice')
    expect(noticeText(notice, 0)).toBe('short-canal closes at r2')
    expect(noticeText(notice, 3)).toBe('short-canal closed since r2')
  })

  it('formats operations and lists the entities they touch', () => {
    const operations = reference[1]?.decision?.request.operations ?? []
    expect(operations.map(operationText)).toEqual([
      'Reserve north berth at r1 for barge-b',
      'Dispatch barge-b via north-out · grain-north ×3',
    ])
    expect(operationsEntities(operations)).toEqual([
      { kind: 'vessel', id: 'barge-b' },
      { kind: 'dock', id: 'north' },
      { kind: 'route', id: 'north-out' },
      { kind: 'job', id: 'grain-north' },
    ])
  })

  it('resolves notice targets to routes', () => {
    const step = reference[0]
    const event = step?.events[0]
    if (!step || !event) throw new Error('missing event')
    expect(eventEntities(classifyEvent(event), step.observation)).toEqual([{ kind: 'route', id: 'short-canal' }])
  })
})

describe('map layout', () => {
  const observation = reference[3]?.observation
  if (!observation) throw new Error('missing observation')
  const positions = dockPositions(observation.docks)
  const edges = edgeGeometry(observation.routes, positions)

  it('lays out every route with finite coordinates', () => {
    expect(edges).toHaveLength(observation.routes.length)
    for (const edge of edges) {
      for (const point of [edge.start, edge.control, edge.end, edge.mid]) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      }
    }
  })

  it('separates parallel and opposite edges between the same docks', () => {
    const byId = new Map(edges.map((edge) => [edge.route.id, edge]))
    expect(byId.get('short-canal')?.control).not.toEqual(byId.get('outer-canal')?.control)
    expect(byId.get('north-out')?.control).not.toEqual(byId.get('north-return')?.control)
  })

  it('places unknown docks on a circle without collisions', () => {
    const generic = dockPositions(['alpha', 'beta', 'gamma', 'delta'])
    const keys = new Set([...generic.values()].map((point) => `${Math.round(point.x)},${Math.round(point.y)}`))
    expect(keys.size).toBe(4)
  })

  it('places an in-transit vessel along its route by elapsed rounds', () => {
    const byId = new Map(edges.map((edge) => [edge.route.id, edge]))
    const outer = byId.get('outer-canal')
    if (!outer) throw new Error('missing edge')
    expect(voyagePoint(['outer-canal'], 2, 4, 2, byId)?.point).toEqual(outer.start)
    expect(voyagePoint(['outer-canal'], 2, 4, 4, byId)?.point).toEqual(outer.end)
    expect(voyagePoint(['missing'], 2, 4, 3, byId)).toBeNull()
  })

  it('describes the map in text', () => {
    const lines = describeHarbor(observation)
    expect(lines[0]).toBe('Round 3 of 6. Episode active. Spend 9 of cap 20.')
    expect(lines).toContain('Route short-canal from west to east: closed, 1 round, cost 2, maximum draft 2.')
    expect(lines).toContain('Vessel barge-a, capacity 4, draft 1: in transit to east, arriving r4, carrying cloth-east ×4.')
  })
})
