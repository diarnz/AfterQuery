import { useId, useMemo, type KeyboardEvent } from 'react'
import type { Observation, Notice } from '../../contracts/harbor'
import { hasEntity, sameEntity, type EntityRef } from '../../lib/entities'
import { roundTag, vesselLetter } from '../../lib/format'
import { DOCK_RADIUS, VIEW_HEIGHT, VIEW_WIDTH, dockPositions, edgeGeometry, voyagePoint, type EdgeGeometry, type Point } from './layout'
import { loadsText, noticeChange } from './format'

export interface HarborMapProps {
  observation: Observation
  /** Entities to emphasise (hover in another pane). */
  highlighted: readonly EntityRef[]
  pinned: EntityRef | null
  onHover(entity: EntityRef | null): void
  onToggle(entity: EntityRef): void
  label: string
}

function activate(event: KeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

/** Notices published but not yet in effect, keyed by their target. */
function pendingNotices(observation: Observation): Map<string, Notice[]> {
  const pending = new Map<string, Notice[]>()
  for (const notice of observation.notices) {
    if (notice.effective_round <= observation.round) continue
    pending.set(notice.target, [...(pending.get(notice.target) ?? []), notice])
  }
  return pending
}

function Hull({ deep }: { deep: boolean }) {
  return deep ? (
    <path className="hull" d="M -15 -4 L 15 -4 L 10 9 L -10 9 Z" />
  ) : (
    <path className="hull" d="M -15 -4 L 15 -4 L 11 5 L -11 5 Z" />
  )
}

export function HarborMap({ observation, highlighted, pinned, onHover, onToggle, label }: HarborMapProps) {
  const markerId = useId().replace(/:/g, '')
  const titleId = `${markerId}-title`
  const positions = useMemo(() => dockPositions(observation.docks), [observation.docks])
  const edges = useMemo(() => edgeGeometry(observation.routes, positions), [observation.routes, positions])
  const edgeById = useMemo(() => new Map(edges.map((edge) => [edge.route.id, edge] as const)), [edges])
  const pending = pendingNotices(observation)

  const isLit = (entity: EntityRef) => hasEntity(highlighted, entity) || sameEntity(pinned, entity)
  const interactive = (entity: EntityRef, name: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': name,
    'aria-pressed': sameEntity(pinned, entity),
    onMouseEnter: () => onHover(entity),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(entity),
    onBlur: () => onHover(null),
    onClick: () => onToggle(entity),
    onKeyDown: (event: KeyboardEvent) => activate(event, () => onToggle(entity)),
  })

  const idleByDock = new Map<string, typeof observation.vessels>()
  for (const vessel of observation.vessels) {
    if (vessel.voyage_id || !vessel.dock) continue
    idleByDock.set(vessel.dock, [...(idleByDock.get(vessel.dock) ?? []), vessel])
  }
  const lotsByDock = new Map<string, typeof observation.lots>()
  for (const lot of observation.lots) {
    if (lot.units === 0) continue
    lotsByDock.set(lot.dock, [...(lotsByDock.get(lot.dock) ?? []), lot])
  }
  const receivedByDock = new Map<string, number>()
  for (const receipt of observation.receipts) {
    receivedByDock.set(receipt.destination, (receivedByDock.get(receipt.destination) ?? 0) + receipt.units)
  }

  return (
    <svg
      className="harbor-map"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="group"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{label}</title>
      <defs>
        <marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrowhead" />
        </marker>
        <marker id={`${markerId}-arrow-closed`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrowhead arrowhead-closed" />
        </marker>
      </defs>

      <g className="compass" aria-hidden="true" transform={`translate(${VIEW_WIDTH - 52} 50)`}>
        <circle r="22" />
        <path d="M 0 -20 L 5 0 L 0 20 L -5 0 Z" />
        <text y="-27" textAnchor="middle">N</text>
      </g>

      {edges.map((edge) => (
        <EdgeView
          key={edge.route.id}
          edge={edge}
          markerId={markerId}
          lit={isLit({ kind: 'route', id: edge.route.id })}
          notices={pending.get(edge.route.id) ?? []}
          interactive={interactive(
            { kind: 'route', id: edge.route.id },
            `Route ${edge.route.id}, ${edge.route.source} to ${edge.route.destination}, ${edge.route.open ? 'open' : 'closed'}, ${edge.route.duration} rounds, cost ${edge.route.cost}, maximum draft ${edge.route.max_draft}`,
          )}
        />
      ))}

      {observation.docks.map((dock) => {
        const point = positions.get(dock)
        if (!point) return null
        const idle = idleByDock.get(dock) ?? []
        const lots = lotsByDock.get(dock) ?? []
        const received = receivedByDock.get(dock) ?? 0
        const notices = pending.get(dock) ?? []
        const lit = isLit({ kind: 'dock', id: dock })
        const lotChips = lots.map((lot) =>
          lot.release_round > observation.round ? `${lot.id} ${lot.units} · from ${roundTag(lot.release_round)}` : `${lot.id} ${lot.units}`,
        )
        return (
          <g key={dock} className={`dock${lit ? ' is-lit' : ''}`} transform={`translate(${point.x} ${point.y})`}>
            <g className="dock-button" {...interactive({ kind: 'dock', id: dock }, `${dock} dock${received ? `, ${received} units received` : ''}${lots.length ? `, stock ${lotChips.join(', ')}` : ''}`)}>
              <circle className="dock-seal" r={DOCK_RADIUS} />
              <circle className="dock-seal-inner" r={DOCK_RADIUS - 6} />
              <text className="dock-name" y="5" textAnchor="middle">{dock.toUpperCase()}</text>
            </g>
            {lotChips.map((chip, index) => (
              <text key={chip} className="chip chip-lot" y={-DOCK_RADIUS - 12 - index * 16} textAnchor="middle">{chip}</text>
            ))}
            {received > 0 && (
              <text className="chip chip-ok" y={DOCK_RADIUS + 20} textAnchor="middle">✓ {received} received</text>
            )}
            {notices.map((notice, index) => (
              <text key={notice.id} className="chip chip-notice" y={DOCK_RADIUS + (received ? 38 : 20) + index * 16} textAnchor="middle">
                ◆ {noticeChange(notice)} {roundTag(notice.effective_round)}
              </text>
            ))}
            {idle.map((vessel, index) => {
              const offset = (index - (idle.length - 1) / 2) * 40
              return (
                <VesselGlyph
                  key={vessel.id}
                  point={{ x: offset, y: DOCK_RADIUS + (received ? 40 : 22) + notices.length * 16 + 14 }}
                  letter={vesselLetter(vessel.id)}
                  deep={vessel.draft >= 2}
                  caption={`cap ${vessel.capacity} · d${vessel.draft}`}
                  lit={isLit({ kind: 'vessel', id: vessel.id })}
                  interactive={interactive(
                    { kind: 'vessel', id: vessel.id },
                    `Vessel ${vessel.id}, idle at ${dock}, capacity ${vessel.capacity}, draft ${vessel.draft}`,
                  )}
                />
              )
            })}
          </g>
        )
      })}

      {observation.vessels.map((vessel) => {
        if (!vessel.voyage_id) return null
        const voyage = observation.voyages.find((item) => item.id === vessel.voyage_id)
        if (!voyage) return null
        const placed = voyagePoint(voyage.route, voyage.departed, voyage.arrival, observation.round, edgeById)
        if (!placed) return null
        const { point, leg } = placed
        return (
          <g key={vessel.id} className="vessel-moving" style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
            <VesselGlyph
              point={{ x: 0, y: 0 }}
              captionAbove={leg.outward.y > 0}
              letter={vesselLetter(vessel.id)}
              deep={vessel.draft >= 2}
              caption={`→ ${voyage.destination} ETA ${roundTag(voyage.arrival)} · ${loadsText(voyage.loads)}`}
              lit={isLit({ kind: 'vessel', id: vessel.id })}
              interactive={interactive(
                { kind: 'vessel', id: vessel.id },
                `Vessel ${vessel.id}, in transit to ${voyage.destination}, arriving ${roundTag(voyage.arrival)}, carrying ${loadsText(voyage.loads)}`,
              )}
            />
          </g>
        )
      })}
    </svg>
  )
}

interface InteractiveProps {
  role: 'button'
  tabIndex: number
  'aria-label': string
  'aria-pressed': boolean
  onMouseEnter(): void
  onMouseLeave(): void
  onFocus(): void
  onBlur(): void
  onClick(): void
  onKeyDown(event: KeyboardEvent): void
}

function EdgeView({ edge, markerId, lit, notices, interactive }: {
  edge: EdgeGeometry
  markerId: string
  lit: boolean
  notices: Notice[]
  interactive: InteractiveProps
}) {
  const { route } = edge
  const labelPoint = { x: edge.mid.x + edge.outward.x * 16, y: edge.mid.y + edge.outward.y * 16 }
  const anchor = Math.abs(edge.outward.x) > 0.6 ? (edge.outward.x > 0 ? 'start' : 'end') : 'middle'
  const facts = route.open
    ? `${route.duration}r · cost ${route.cost} · ≤d${route.max_draft}`
    : 'closed'
  // The interactive group holds only shapes; its accessible name carries every fact. The visible
  // label sits outside it (aria-hidden) so the name never contradicts the text on screen.
  return (
    <g className={`route${route.open ? '' : ' is-closed'}${lit ? ' is-lit' : ''}`}>
      <g className="route-button" {...interactive}>
        <path className="route-hit" d={edge.path} />
        <path className="route-line" d={edge.path} markerEnd={`url(#${markerId}-arrow${route.open ? '' : '-closed'})`} />
        {!route.open && (
          <g className="route-lock" transform={`translate(${edge.mid.x} ${edge.mid.y})`}>
            <circle r="10" />
            <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" />
          </g>
        )}
      </g>
      <text className="route-label" x={labelPoint.x} y={labelPoint.y} textAnchor={anchor} aria-hidden="true">
        <tspan className="route-name">{route.id}</tspan>
        <tspan x={labelPoint.x} dy="14">{facts}</tspan>
        {notices.map((notice) => (
          <tspan key={notice.id} x={labelPoint.x} dy="14" className="route-notice">
            ◆ {notice.kind === 'close_route' ? 'closes' : notice.kind === 'open_route' ? 'opens' : noticeChange(notice)} {roundTag(notice.effective_round)}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function VesselGlyph({ point, letter, deep, caption, lit, interactive, captionAbove = false }: {
  point: Point
  /** Keeps a moving vessel's caption clear of its route label, which sits on the other side. */
  captionAbove?: boolean
  letter: string
  deep: boolean
  caption: string
  lit: boolean
  interactive: InteractiveProps
}) {
  return (
    <g className={`vessel${lit ? ' is-lit' : ''}`} transform={`translate(${point.x} ${point.y})`}>
      <g className="vessel-button" {...interactive}>
        <rect className="vessel-hit" x="-18" y="-14" width="36" height="28" />
        <Hull deep={deep} />
      </g>
      <text className="vessel-letter" y="4" textAnchor="middle" aria-hidden="true">{letter}</text>
      <text className="vessel-caption" y={captionAbove ? -11 : deep ? 23 : 19} textAnchor="middle" aria-hidden="true">{caption}</text>
    </g>
  )
}
