import type { Observation } from '../../contracts/harbor'
import { runStatus, shortRunId, type RunRecord } from '../../state/runRecord'
import { Badge, Hash } from '../../ui'
import { STATUS_BADGE, policyLabel, scenarioLabel } from '../common/labels'

export function RunHeader({
  record,
  observation,
  following,
}: {
  record: RunRecord
  observation: Observation | null
  following: boolean
}) {
  const status = STATUS_BADGE[runStatus(record)]
  return (
    <header className="run-header">
      <h1 className="sr-only">
        Run {shortRunId(record.id)}: {policyLabel(record.request.policy)} on {scenarioLabel(record.request.scenario)}
      </h1>
      <p className="run-command">
        <span aria-hidden="true" className="prompt-user">
          runbook@harbor
        </span>
        <span aria-hidden="true" className="prompt-path">
          :~$
        </span>{' '}
        <span className="mono">
          run --model {record.request.policy} --env {record.request.scenario}
          {record.request.seed !== null ? ` --seed ${record.request.seed}` : ''}
        </span>{' '}
        <span className="run-id">
          # run <span className="mono">{shortRunId(record.id)}</span>
        </span>
      </p>
      <div className="run-badges">
        <span className="run-world">Harbor Master · {scenarioLabel(record.request.scenario)}</span>
        <Badge tone={status.tone} glyph={status.glyph}>
          {status.label}
        </Badge>
        {!following && (
          <Badge tone="brass" glyph="↺">
            Replay
          </Badge>
        )}
        <span className="run-policy">{policyLabel(record.request.policy)}</span>
      </div>
      <dl className="run-facts">
        {observation && (
          <>
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
          </>
        )}
        {record.opening && (
          <>
            <div>
              <dt>Seed</dt>
              <dd className="mono">{record.opening.seed ?? 'fixed'}</dd>
            </div>
            <div>
              <dt>Scenario</dt>
              <dd>
                <Hash value={record.opening.scenario_hash} label="scenario fingerprint" head={6} tail={4} />
              </dd>
            </div>
          </>
        )}
      </dl>
    </header>
  )
}
