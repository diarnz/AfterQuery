/**
 * Deterministic map geometry. The API sends no coordinates (blueprint gap G-12),
 * so the client places docks: known Harbor docks get fixed positions that read
 * like a chart (north up), anything else is placed on a circle in ID order.
 */
import type { Route } from '../../contracts/harbor'

export interface Point {
  x: number
  y: number
}

export interface EdgeGeometry {
  route: Route
  start: Point
  control: Point
  end: Point
  /** Point on the curve used for the label and notice glyph. */
  mid: Point
  /** Unit normal pointing away from the curve's bulge, for label offset. */
  outward: Point
  path: string
}

export const VIEW_WIDTH = 800
export const VIEW_HEIGHT = 470
export const DOCK_RADIUS = 30

const KNOWN: Record<string, Point> = {
  north: { x: 400, y: 74 },
  west: { x: 140, y: 360 },
  east: { x: 660, y: 360 },
  south: { x: 400, y: 430 },
}

export function dockPositions(docks: readonly string[]): Map<string, Point> {
  const positions = new Map<string, Point>()
  if (docks.length > 0 && docks.every((dock) => dock in KNOWN)) {
    for (const dock of docks) {
      const point = KNOWN[dock]
      if (point) positions.set(dock, point)
    }
    return positions
  }
  const sorted = [...docks].sort()
  const radius = Math.min(VIEW_WIDTH, VIEW_HEIGHT) / 2 - 80
  sorted.forEach((dock, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(sorted.length, 1)
    positions.set(dock, {
      x: VIEW_WIDTH / 2 + radius * Math.cos(angle) * 1.4,
      y: VIEW_HEIGHT / 2 + radius * Math.sin(angle),
    })
  })
  return positions
}

export function bezier(start: Point, control: Point, end: Point, t: number): Point {
  const a = (1 - t) * (1 - t)
  const b = 2 * (1 - t) * t
  const c = t * t
  return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y }
}

function unit(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy)
  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length }
}

const SPREAD = 64

/**
 * Edges between the same pair of docks fan out symmetrically. The normal is
 * taken from the alphabetically ordered pair, so opposite-direction edges
 * land on different sides instead of overlapping.
 */
export function edgeGeometry(routes: readonly Route[], positions: Map<string, Point>): EdgeGeometry[] {
  const groups = new Map<string, Route[]>()
  for (const route of routes) {
    const key = [route.source, route.destination].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), route])
  }
  const result: EdgeGeometry[] = []
  for (const [key, group] of groups) {
    const [first, second] = key.split('|') as [string, string]
    const a = positions.get(first)
    const b = positions.get(second)
    if (!a || !b) continue
    const along = unit(b.x - a.x, b.y - a.y)
    const normal = { x: -along.y, y: along.x }
    const ordered = [...group].sort((left, right) => left.id.localeCompare(right.id))
    ordered.forEach((route, index) => {
      const offset = (index - (ordered.length - 1) / 2) * SPREAD * 2
      const source = positions.get(route.source)
      const target = positions.get(route.destination)
      if (!source || !target) return
      const middle = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 }
      const control = { x: middle.x + normal.x * offset, y: middle.y + normal.y * offset }
      const startDir = unit(control.x - source.x, control.y - source.y)
      const endDir = unit(control.x - target.x, control.y - target.y)
      const start = { x: source.x + startDir.x * DOCK_RADIUS, y: source.y + startDir.y * DOCK_RADIUS }
      const end = { x: target.x + endDir.x * (DOCK_RADIUS + 6), y: target.y + endDir.y * (DOCK_RADIUS + 6) }
      const mid = bezier(start, control, end, 0.5)
      const side = offset === 0 ? 1 : Math.sign(offset)
      result.push({
        route,
        start,
        control,
        end,
        mid,
        outward: { x: normal.x * side, y: normal.y * side },
        path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
      })
    })
  }
  return result
}

/**
 * Where a vessel on a multi-edge voyage sits at the given round. Progress is
 * spread over each edge by its duration; the voyage itself comes from the
 * server snapshot, so this only places a glyph.
 */
export function voyagePoint(
  routeIds: readonly string[],
  departed: number,
  arrival: number,
  round: number,
  edges: ReadonlyMap<string, EdgeGeometry>,
): { point: Point; leg: EdgeGeometry } | null {
  const legs = routeIds.map((id) => edges.get(id))
  if (legs.length === 0 || arrival <= departed || legs.some((leg) => !leg)) return null
  const known = legs as EdgeGeometry[]
  let elapsed = Math.min(Math.max(round - departed, 0), arrival - departed)
  for (const leg of known) {
    const duration = leg.route.duration
    if (elapsed <= duration) {
      return { point: bezier(leg.start, leg.control, leg.end, duration === 0 ? 1 : elapsed / duration), leg }
    }
    elapsed -= duration
  }
  const last = known[known.length - 1] as EdgeGeometry
  return { point: last.end, leg: last }
}
