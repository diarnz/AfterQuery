import { useId } from 'react'
import { Link, useSearchParams } from 'react-router'
import { formatScore, formatTimestamp, humanize, roundTag } from '../../lib/format'
import { runStatus, shortRunId, type RunRecord } from '../../state/runRecord'
import { useLibrarySnapshot } from '../../state/runLibraryContext'
import { SelectionProvider, useSelection } from '../../state/selection'
import { buildTimeline, stepAtRound, type Step } from '../../state/timeline'
import { Badge, Banner, EmptyState, Panel } from '../../ui'
import { HarborMap, operationText } from '../../worlds/harbor'
import { STATUS_BADGE, policyLabel, scenarioLabel } from '../common/labels'
import { alignRuns } from './alignRuns'

function runOption(record: RunRecord): string {
  return `${shortRunId(record.id)} · ${policyLabel(record.request.policy)} · ${scenarioLabel(record.request.scenario)}${
    record.opening?.seed !== null && record.opening?.seed !== undefined ? ` · seed ${record.opening.seed}` : ''
  } · ${formatTimestamp(record.createdAt)}`
}

export function ComparePage() {
  return (
    <SelectionProvider>
      <Compare />
    </SelectionProvider>
  )
}

function Compare() {
  const { records } = useLibrarySnapshot()
  const [params, setParams] = useSearchParams()
  const ids = { a: useId(), b: useId() }
  const candidates = records.filter((record) => record.opening && record.outcome)
  const a = candidates.find((record) => record.id === params.get('a'))
  const b = candidates.find((record) => record.id === params.get('b'))
  const matching = a ? candidates.filter((record) => record.id !== a.id && record.opening?.scenario_hash === a.opening?.scenario_hash) : []

  const setParam = (key: 'a' | 'b' | 'round', value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null) next.delete(key)
        else next.set(key, value)
        if (key === 'a') next.delete('b')
        if (key !== 'round') next.delete('round')
        return next
      },
      { replace: true },
    )

  const stepsA = a ? buildTimeline(a) : []
  const stepsB = b ? buildTimeline(b) : []
  const alignment = alignRuns(stepsA, stepsB)
  const sameScenario = !!a && !!b && a.opening?.scenario_hash === b.opening?.scenario_hash

  const roundParam = params.get('round')
  const requestedRound = roundParam !== null && /^\d+$/.test(roundParam) ? Number(roundParam) : null
  const round = requestedRound ?? alignment.firstDivergence ?? 0

  return (
    <div className="page compare-page">
      <header className="page-header">
        <h1 className="display">Compare runs</h1>
        <p className="muted">
          Two runs of the same scenario, aligned by simulation round. Only runs recorded in this browser with an identical scenario fingerprint
          can be compared.
        </p>
      </header>

      {candidates.length < 2 ? (
        <Panel title="Not enough runs">
          <EmptyState title="Record at least two finished runs of one scenario" action={<Link to="/">Open the terminal</Link>}>
            <p>For example, run the Appendix G fixture with the reference planner and again with the stop-early baseline.</p>
          </EmptyState>
        </Panel>
      ) : (
        <div className="compare-pickers">
          <div className="control">
            <label htmlFor={ids.a}>Run A</label>
            <select id={ids.a} value={a?.id ?? ''} onChange={(event) => setParam('a', event.target.value || null)}>
              <option value="">Choose a run…</option>
              {candidates.map((record) => (
                <option key={record.id} value={record.id}>
                  {runOption(record)}
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor={ids.b}>Run B · same scenario only</label>
            <select id={ids.b} value={b?.id ?? ''} disabled={!a || matching.length === 0} onChange={(event) => setParam('b', event.target.value || null)}>
              <option value="">{!a ? 'Choose run A first' : matching.length ? 'Choose a run…' : 'No other run of this scenario'}</option>
              {matching.map((record) => (
                <option key={record.id} value={record.id}>
                  {runOption(record)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {a && b && !sameScenario && (
        <Banner tone="error" title="These runs used different scenarios">
          Their scenario fingerprints differ, so a round-by-round comparison would be meaningless.
        </Banner>
      )}

      {a && b && sameScenario && (
        <>
          <Banner tone={alignment.firstDivergence === null ? 'notice' : 'pending'} title={
            alignment.firstDivergence === null
              ? 'Both runs made the same decisions at every round'
              : `First divergence at round ${alignment.firstDivergence}`
          }>
            Client-side comparison of the decision payloads the API recorded for each run.
          </Banner>

          <div className="compare-maps">
            <CompareSide label="A" record={a} steps={stepsA} round={round} />
            <CompareSide label="B" record={b} steps={stepsB} round={round} />
          </div>

          <Panel title="Decisions by round">
            <table className="compare-table">
              <caption className="sr-only">Decisions of run A and run B, aligned by round. Select a round to show both maps at that round.</caption>
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">A · {policyLabel(a.request.policy)}</th>
                  <th scope="col">B · {policyLabel(b.request.policy)}</th>
                </tr>
              </thead>
              <tbody>
                {alignment.rounds.map((row) => (
                  <tr key={row.round} className={`${row.differs ? 'is-different' : ''}${row.round === round ? ' is-current' : ''}`}>
                    <th scope="row">
                      <button type="button" className="link-button mono" aria-pressed={row.round === round} onClick={() => setParam('round', String(row.round))}>
                        {roundTag(row.round)}
                      </button>
                      {row.round === alignment.firstDivergence && (
                        <span className="divergence-mark">
                          <span aria-hidden="true">◀ </span>first divergence
                        </span>
                      )}
                    </th>
                    <td>
                      <DecisionCell steps={row.a} runId={a.id} />
                    </td>
                    <td>
                      <DecisionCell steps={row.b} runId={b.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  )
}

function DecisionCell({ steps, runId }: { steps: Step[]; runId: string }) {
  if (steps.length === 0) return <span className="muted">No decision</span>
  return (
    <ul className="compare-decisions">
      {steps.map((step) =>
        step.decision ? (
          <li key={step.index}>
            <strong>{humanize(step.decision.tool)}</strong>{' '}
            <span className={step.decision.response.accepted ? 'tone-ok' : 'tone-error'}>
              {step.decision.response.accepted ? 'accepted' : `rejected · ${step.decision.response.error?.code ?? ''}`}
            </span>
            {(step.decision.request.operations ?? []).map((operation, index) => (
              <div key={index} className="mono compare-op">
                {operationText(operation)}
              </div>
            ))}
            <Link className="compare-evidence" to={`/runs/${runId}?step=${step.index}&evidence=${step.index}`}>
              Evidence for step {step.index}
            </Link>
          </li>
        ) : null,
      )}
    </ul>
  )
}

function CompareSide({ label, record, steps, round }: { label: string; record: RunRecord; steps: Step[]; round: number }) {
  const { hovered, pinned, setHovered, togglePinned } = useSelection()
  const step = stepAtRound(steps, round) ?? steps[0]
  const status = STATUS_BADGE[runStatus(record)]
  const outcome = record.outcome
  return (
    <Panel
      title={
        <>
          {label} · {policyLabel(record.request.policy)} <span className="mono muted">{shortRunId(record.id)}</span>
        </>
      }
      actions={
        <Badge tone={status.tone} glyph={status.glyph}>
          {status.label}
        </Badge>
      }
    >
      {step && (
        <HarborMap
          observation={step.observation}
          highlighted={hovered}
          pinned={pinned}
          onHover={(entity) => setHovered(entity ? [entity] : [])}
          onToggle={togglePinned}
          label={`Run ${label} at round ${step.observation.round}`}
        />
      )}
      <p className="compare-outcome">
        {outcome?.kind === 'complete' ? (
          <>
            Planner estimate <strong className="mono">{formatScore(outcome.result.planner_score)}</strong> ·{' '}
            <span className={outcome.result.complete ? 'tone-ok' : 'tone-error'}>{outcome.result.complete ? 'complete' : 'incomplete'}</span>
          </>
        ) : (
          <span className="tone-infra">No result: {status.label.toLowerCase()}</span>
        )}
        <Link to={`/runs/${record.id}`}>Open in terminal</Link>
      </p>
    </Panel>
  )
}
