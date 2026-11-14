import { useState } from 'react'
import type { Observation } from '../../contracts/harbor'
import { roundTag } from '../../lib/format'
import { useSelection } from '../../state/selection'
import { JsonView, Panel, Tabs } from '../../ui'
import { BerthCalendar, HarborMap, describeHarbor, noticeText } from '../../worlds/harbor'

type View = 'map' | 'berths' | 'snapshot'

const VIEWS = [
  { id: 'map', label: 'Map' },
  { id: 'berths', label: 'Berths & stock' },
  { id: 'snapshot', label: 'Public snapshot' },
] as const

export function WorldPane({ observation, stepIndex, title }: { observation: Observation; stepIndex: number; title: string }) {
  const [view, setView] = useState<View>('map')
  const { hovered, pinned, setHovered, togglePinned } = useSelection()

  return (
    <Panel title={title} className="world-pane" bodyClassName="world-body">
      <Tabs<View>
        items={VIEWS}
        value={view}
        onChange={setView}
        label="World views"
        renderPanel={(current) => {
          if (current === 'map') {
            return (
              <div className="world-map">
                <HarborMap
                  observation={observation}
                  highlighted={hovered}
                  pinned={pinned}
                  onHover={(entity) => setHovered(entity ? [entity] : [])}
                  onToggle={togglePinned}
                  label={`Harbor map at round ${observation.round} of ${observation.horizon}`}
                />
                <details className="map-text">
                  <summary>Map as text</summary>
                  <ul>
                    {describeHarbor(observation).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )
          }
          if (current === 'berths') return <BerthsAndStock observation={observation} />
          return (
            <div className="snapshot-view">
              <p className="muted">
                The public <code>{observation.schema}</code> snapshot the API returned after step {stepIndex}, unmodified. This is the
                projection an agent receives; future notices stay hidden in the simulator.
              </p>
              <JsonView value={observation} label={`Public snapshot after step ${stepIndex}`} />
            </div>
          )
        }}
      />
    </Panel>
  )
}

function BerthsAndStock({ observation }: { observation: Observation }) {
  return (
    <div className="berths-view">
      <BerthCalendar observation={observation} />
      <div className="stock-grid">
        <table>
          <caption>Cargo lots</caption>
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col">Dock</th>
              <th scope="col" className="num">Units</th>
              <th scope="col">Loadable</th>
            </tr>
          </thead>
          <tbody>
            {observation.lots.map((lot) => (
              <tr key={lot.id}>
                <th scope="row">{lot.id}</th>
                <td>{lot.dock}</td>
                <td className="num mono">{lot.units}</td>
                <td>{lot.release_round > observation.round ? `from ${roundTag(lot.release_round)}` : 'now'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <caption>Vessels</caption>
          <thead>
            <tr>
              <th scope="col">Vessel</th>
              <th scope="col" className="num">Capacity</th>
              <th scope="col" className="num">Draft</th>
              <th scope="col">Where</th>
            </tr>
          </thead>
          <tbody>
            {observation.vessels.map((vessel) => {
              const voyage = vessel.voyage_id ? observation.voyages.find((item) => item.id === vessel.voyage_id) : undefined
              return (
                <tr key={vessel.id}>
                  <th scope="row">{vessel.id}</th>
                  <td className="num mono">{vessel.capacity}</td>
                  <td className="num mono">{vessel.draft}</td>
                  <td>{voyage ? `→ ${voyage.destination}, ETA ${roundTag(voyage.arrival)}` : vessel.dock ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <section className="notice-list" aria-label="Notices">
        <h3>Notices</h3>
        {observation.notices.length === 0 ? (
          <p className="muted">No notices have been published yet.</p>
        ) : (
          <ul>
            {observation.notices.map((notice) => (
              <li key={notice.id}>
                <span className="tone-notice" aria-hidden="true">◆ </span>
                <strong className="mono">{notice.id}</strong> · {noticeText(notice, observation.round)} ·{' '}
                {notice.effective_round <= observation.round ? 'in effect' : `published ${roundTag(notice.published_round)}, scheduled`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
