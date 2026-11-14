import type { Observation } from '../../contracts/harbor'
import { formatScore, humanize, roundTag } from '../../lib/format'
import { usePreferences } from '../../state/preferences'
import type { RunRecord } from '../../state/runRecord'
import { Button, Meter } from '../../ui'
import { obligations, TERMINAL_REASONS } from '../../worlds/harbor'

const STATUS_TEXT = {
  met: { glyph: '✓', tone: 'ok', text: 'met' },
  in_transit: { glyph: '◐', tone: 'pending', text: 'in transit' },
  open: { glyph: '○', tone: 'muted', text: 'open' },
  missed: { glyph: '✕', tone: 'error', text: 'missed' },
} as const

export function ResultsTray({
  record,
  observation,
  atLatest,
  onCompare,
  onEvidence,
  evidenceDisabledReason,
}: {
  record: RunRecord
  observation: Observation
  atLatest: boolean
  onCompare(): void
  onEvidence(): void
  evidenceDisabledReason: string | null
}) {
  const { resultsCollapsed, set } = usePreferences()
  const rows = obligations(observation)

  return (
    <section className={`results-tray${resultsCollapsed ? ' is-collapsed' : ''}`} aria-labelledby="results-heading">
      <header className="results-header">
        <h2 id="results-heading" className="panel-title">Results</h2>
        <div className="results-summary mono" aria-hidden={!resultsCollapsed}>
          {resultsCollapsed && rows.map((row) => `${row.job.id} ${row.onTime}/${row.job.units}`).join(' · ')}
        </div>
        <div className="results-buttons">
          <Button size="sm" onClick={onCompare}>Compare</Button>
          <Button size="sm" onClick={onEvidence} disabledReason={evidenceDisabledReason}>Evidence</Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={!resultsCollapsed}
            aria-controls="results-content"
            onClick={() => set('resultsCollapsed', !resultsCollapsed)}
          >
            {resultsCollapsed ? 'Expand' : 'Collapse'} <kbd className="kbd">R</kbd>
          </Button>
        </div>
      </header>
      <div id="results-content" className="results-content" hidden={resultsCollapsed}>
        <div className="results-zone results-provisional">
          <h3>
            Obligations <span className="muted">· provisional, at {roundTag(observation.round)}</span>
          </h3>
          <ul className="obligations">
            {rows.map((row) => {
              const status = STATUS_TEXT[row.status]
              const label = `${row.job.id}: ${row.onTime} of ${row.job.units} units on time, ${row.inTransit} in transit, ${row.late} late, due round ${row.job.due_round}`
              return (
                <li key={row.job.id} className="obligation">
                  <span className="mono obligation-name">{row.job.id}</span>
                  <Meter
                    total={row.job.units}
                    label={label}
                    segments={[
                      { value: row.onTime, tone: 'ok' },
                      { value: row.inTransit, tone: 'pending' },
                      { value: row.late, tone: 'error' },
                    ]}
                  />
                  <span className="mono obligation-count">
                    {row.onTime}/{row.job.units}
                  </span>
                  <span className="obligation-detail">
                    {row.inTransit > 0 && <span className="tone-pending">{row.inTransit} in transit · </span>}
                    {row.late > 0 && <span className="tone-error">{row.late} late · </span>}
                    to {row.job.destination}, due {roundTag(row.job.due_round)}
                  </span>
                  <span className={`obligation-status tone-${status.tone}`}>
                    <span aria-hidden="true">{status.glyph} </span>
                    {status.text}
                  </span>
                </li>
              )
            })}
          </ul>
          <dl className="telemetry">
            <div>
              <dt>Spend</dt>
              <dd className="mono">
                {observation.spent} / {observation.cost_cap} cap
              </dd>
            </div>
            <div>
              <dt>Round</dt>
              <dd className="mono">
                {observation.round} / {observation.horizon}
              </dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd className="mono">{observation.revision}</dd>
            </div>
            <div>
              <dt>Batch limit</dt>
              <dd className="mono">{observation.limits.max_operations_per_batch} ops</dd>
            </div>
          </dl>
        </div>
        <Outcome record={record} atLatest={atLatest} />
      </div>
    </section>
  )
}

function Outcome({ record, atLatest }: { record: RunRecord; atLatest: boolean }) {
  const outcome = record.outcome
  const note = atLatest ? null : <p className="muted">Shown for the end of the run; the map shows an earlier step.</p>
  let body
  if (!outcome) {
    body = (
      <p className="tone-pending">
        <span aria-hidden="true">◌ </span>Run in progress. The result arrives with the final frame.
      </p>
    )
  } else if (outcome.kind === 'complete') {
    const { result } = outcome
    body = (
      <>
        <p className="estimate">
          <span className="estimate-label">Planner estimate</span>
          <span className="estimate-value mono" title={String(result.planner_score)}>
            {formatScore(result.planner_score)}
          </span>
          <span className={result.complete ? 'tone-ok' : 'tone-error'}>
            <span aria-hidden="true">{result.complete ? '✓ ' : '✕ '}</span>
            {result.complete ? 'All obligations met' : 'Obligations incomplete'}
          </span>
          <span className="muted">· {TERMINAL_REASONS[result.reason] ?? humanize(result.reason)}</span>
        </p>
        <p className="muted estimate-note">
          Computed by the API's reference-planner utility on settled deliveries. It is not an independent verifier verdict; this API
          does not provide one yet.
        </p>
      </>
    )
  } else if (outcome.kind === 'failed') {
    body = (
      <p className="tone-error">
        <span aria-hidden="true">✕ </span>The API rejected the policy's action: <code>{outcome.error.code}</code> · {outcome.error.message}
      </p>
    )
  } else if (outcome.kind === 'error') {
    body = (
      <p className="tone-infra">
        <span aria-hidden="true">⚠ </span>No result: <code>{outcome.error.code}</code> · {outcome.error.message}
      </p>
    )
  } else if (outcome.kind === 'stopped') {
    body = (
      <p className="tone-pending">
        <span aria-hidden="true">■ </span>Stopped by the operator before the run finished. The API reports no estimate for stopped runs.
      </p>
    )
  } else {
    body = (
      <p className="tone-infra">
        <span aria-hidden="true">⚠ </span>The page closed while this run was streaming. The API keeps no run history, so it cannot be resumed.
      </p>
    )
  }
  return (
    <div className="results-zone results-outcome">
      <h3>Run result</h3>
      {body}
      {note}
    </div>
  )
}
