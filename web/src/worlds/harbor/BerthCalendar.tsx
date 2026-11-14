import type { Observation } from '../../contracts/harbor'
import { roundTag, vesselLetter } from '../../lib/format'

interface Cell {
  capacity: number
  free: number
  holds: string[]
  arrivals: string[]
}

/**
 * Docks × future rounds. The snapshot lists only future slots (round > current),
 * which is exactly what an agent can still book; an unlisted dock-round has zero capacity.
 */
export function BerthCalendar({ observation }: { observation: Observation }) {
  const rounds: number[] = []
  for (let round = observation.round + 1; round <= observation.horizon; round += 1) rounds.push(round)

  if (rounds.length === 0) {
    return <p className="muted berth-empty">No future rounds remain before the horizon.</p>
  }

  const cell = (dock: string, round: number): Cell | null => {
    const slot = observation.slots.find((item) => item.dock === dock && item.round === round)
    const holds = observation.holds.filter((hold) => hold.dock === dock && hold.round === round).map((hold) => hold.vessel_id)
    const arrivals = observation.voyages
      .filter((voyage) => voyage.destination === dock && voyage.arrival === round && voyage.arrival > observation.round)
      .map((voyage) => voyage.vessel_id)
    if (!slot && holds.length === 0 && arrivals.length === 0) return null
    return { capacity: slot?.capacity ?? 0, free: slot?.free ?? 0, holds, arrivals }
  }

  return (
    <div className="berth-calendar">
      <table>
        <caption>Arrival berths by dock and round</caption>
        <thead>
          <tr>
            <th scope="col">Dock</th>
            {rounds.map((round) => (
              <th key={round} scope="col">{roundTag(round)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {observation.docks.map((dock) => (
            <tr key={dock}>
              <th scope="row">{dock}</th>
              {rounds.map((round) => {
                const value = cell(dock, round)
                if (!value) {
                  return (
                    <td key={round} className="berth-none">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">No berth</span>
                    </td>
                  )
                }
                const description = [
                  `capacity ${value.capacity}`,
                  `${value.free} free`,
                  ...value.arrivals.map((id) => `booked by ${id}`),
                  ...value.holds.map((id) => `held for ${id}`),
                ].join(', ')
                return (
                  <td key={round} title={description}>
                    <span className="sr-only">{description}</span>
                    <span aria-hidden="true" className="berth-glyphs">
                      {value.arrivals.map((id) => (
                        <span key={`a-${id}`} className="berth-booked">■{vesselLetter(id)}</span>
                      ))}
                      {value.holds.map((id) => (
                        <span key={`h-${id}`} className="berth-held">◧{vesselLetter(id)}</span>
                      ))}
                      {Array.from({ length: value.free }, (_, index) => (
                        <span key={`f-${index}`} className="berth-free">□</span>
                      ))}
                      {value.capacity === 0 && value.arrivals.length + value.holds.length === 0 && <span className="berth-zero">0</span>}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="legend" aria-hidden="true">
        <span className="berth-booked">■</span> booked voyage · <span className="berth-held">◧</span> hold · <span className="berth-free">□</span> free · — none
      </p>
    </div>
  )
}
