import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { startRun, type Observation, type Policy, type Result, type Scenario, type WorldEvent } from './api'
import './styles.css'

const scenarios: Record<Scenario, string> = {
  fixture: 'Harbor Master',
  forecast_closure: 'Forecast closure',
  reactive_closure: 'Reactive closure',
  open_canal: 'Open canal',
}

const policies: Record<Policy, string> = {
  reference: 'Reference planner',
  idle: 'Do nothing',
  'stop-early': 'Stop-early baseline',
}

function label(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/^./, (character) => character.toUpperCase())
}

function eventDetail(event: WorldEvent) {
  const { data } = event
  if (event.type === 'voyage_dispatched') {
    return `${label(String(data.vessel_id))} to ${label(String(data.destination))} · ETA ${data.arrival}`
  }
  if (event.type === 'delivery_receipted') {
    return `${data.units} units · ${label(String(data.job_id))}`
  }
  if (event.type.startsWith('notice_')) {
    return `${label(String(data.kind))} · ${label(String(data.target))} · round ${data.effective_round}`
  }
  return ''
}

function App() {
  const [scenario, setScenario] = useState<Scenario>('fixture')
  const [policy, setPolicy] = useState<Policy>('reference')
  const [observation, setObservation] = useState<Observation>()
  const [events, setEvents] = useState<WorldEvent[]>([])
  const [result, setResult] = useState<Result>()
  const [fingerprint, setFingerprint] = useState<string>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  async function run() {
    if (controller.current) return
    const request = new AbortController()
    controller.current = request
    setRunning(true)
    setError(undefined)
    setResult(undefined)
    setObservation(undefined)
    setFingerprint(undefined)
    setEvents([])
    try {
      for await (const event of startRun(scenario, policy, request.signal)) {
        if (event.type === 'opening') {
          setObservation(event.observation)
          setEvents(event.events)
          setFingerprint(event.scenario_hash.slice(0, 8))
        } else if (event.type === 'decision') {
          setObservation(event.response.observation)
          setEvents((previous) => [...previous, ...event.response.events])
        } else if (event.type === 'failed') {
          throw new Error(event.error.message)
        } else {
          setResult(event.result)
          return
        }
      }
      throw new Error('The connection closed before the run returned a result.')
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Run failed.')
      }
    } finally {
      controller.current = null
      setRunning(false)
    }
  }

  return (
    <main className="terminal">
      <header className="masthead">
        <div className="brand"><span aria-hidden="true">&gt;_</span><h1>Renaissance Runbook</h1></div>
        <p role="status" className={running ? 'live' : ''}>
          {running ? 'Running' : result ? 'Run ended' : 'Local sandbox'}
        </p>
      </header>

      <section className="workspace" aria-label="Harbor simulation">
        <div className="world panel">
          <header className="panel-heading">
            <h2>Harbor Master</h2>
            {observation && <span>Round {observation.round} / {observation.horizon}</span>}
          </header>
          <div className="board">
            {observation ? (
              <>
                <section aria-label="Docks" className="docks">
                  {observation.docks.map((dock) => (
                    <div className="dock" key={dock}>
                      <h3>{label(dock)} Dock</h3>
                      {observation.vessels.filter((vessel) => vessel.dock === dock).map((vessel) => (
                        <span key={vessel.id}>{label(vessel.id)}</span>
                      ))}
                    </div>
                  ))}
                </section>
                <section aria-label="Routes" className="routes">
                  {observation.routes.map((route) => (
                    <div className="route" key={route.id}>
                      <span>{label(route.id)}</span>
                      <span>{label(route.source)} → {label(route.destination)}</span>
                      <span className={route.open ? '' : 'closed'}>
                        {route.open ? `${route.duration}r` : 'Closed'}
                      </span>
                    </div>
                  ))}
                </section>
                {observation.vessels.filter((vessel) => vessel.voyage_id).map((vessel) => {
                  const voyage = observation.voyages.find((item) => item.id === vessel.voyage_id)
                  return voyage && <p className="in-transit" key={vessel.id}>{label(vessel.id)} → {label(voyage.destination)} · ETA {voyage.arrival}</p>
                })}
              </>
            ) : <p className="empty">Start a run to inspect docks, routes, and vessels.</p>}
          </div>
        </div>

        <section className="trace panel" aria-labelledby="trace-heading">
          <header className="panel-heading">
            <h2 id="trace-heading">Action Trace</h2>
            {fingerprint && <span>{fingerprint}</span>}
          </header>
          {events.length ? (
            <ol className="event-list">
              {events.map((event, index) => (
                <li key={index}>
                  <span className="event-round">{String(event.round).padStart(2, '0')}</span>
                  <div>
                    <strong>{label(event.type)}</strong>
                    {eventDetail(event) && <p>{eventDetail(event)}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="empty">World events will appear here.</p>}
        </section>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="results panel" aria-label="Results">
        <h2>Results</h2>
        {observation?.jobs.map((job) => {
          const delivered = observation.receipts
            .filter((receipt) => receipt.job_id === job.id && receipt.round <= job.due_round)
            .reduce((total, receipt) => total + receipt.units, 0)
          return <span key={job.id}>{label(job.id)} <strong>{delivered}/{job.units}</strong></span>
        })}
        {observation && <span>Spend <strong>{observation.spent}</strong></span>}
        <span className="score">
          {result
            ? <>Local score <strong>{result.planner_score.toFixed(3)}</strong> · {result.complete ? 'Complete' : 'Incomplete'}</>
            : running ? 'Score pending' : 'No score yet'}
        </span>
      </section>

      <footer className="controls panel">
        <label>Models
          <select value={policy} disabled={running} onChange={(event) => setPolicy(event.target.value as Policy)}>
            {Object.entries(policies).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>
        <label>Environments
          <select value={scenario} disabled={running} onChange={(event) => setScenario(event.target.value as Scenario)}>
            {Object.entries(scenarios).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>
        <button className="dictation" type="button" disabled>Environment Dictation</button>
        <button className="run" type="button" disabled={running} onClick={run}>
          {running ? 'Running…' : 'Start run'}
        </button>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
