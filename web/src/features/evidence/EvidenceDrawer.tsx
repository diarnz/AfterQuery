import type { Observation } from '../../contracts/harbor'
import { humanize, roundTag } from '../../lib/format'
import type { RunRecord } from '../../state/runRecord'
import type { Step } from '../../state/timeline'
import { Badge, Hash, JsonView, Modal } from '../../ui'
import { classifyEvent, eventText, loadsText, noticeText, obligations, operationText } from '../../worlds/harbor'

/**
 * "What did the policy know, what did it do, what did the rules say, and what
 * happened." Every fact here is read from the frames the API sent for this step.
 */
export function EvidenceDrawer({ record, step, onClose }: { record: RunRecord; step: Step; onClose(): void }) {
  const title = step.decision
    ? `Step ${step.index} · ${humanize(step.decision.tool)} at round ${step.roundBefore}`
    : 'Opening · round 0'

  return (
    <Modal title={title} variant="drawer" onClose={onClose}>
      <div className="evidence">
        {step.before && (
          <section aria-labelledby="ev-before">
            <h3 id="ev-before">What the policy could see</h3>
            <Facts observation={step.before} />
            <details>
              <summary>Full public snapshot before the action</summary>
              <JsonView value={step.before} label="Public snapshot before the action" />
            </details>
          </section>
        )}

        {step.decision && (
          <section aria-labelledby="ev-action">
            <h3 id="ev-action">Action</h3>
            <p>
              <Badge tone={step.decision.response.accepted ? 'ok' : 'error'} glyph={step.decision.response.accepted ? '✓' : '✕'}>
                {step.decision.response.accepted ? 'Accepted' : `Rejected · ${step.decision.response.error?.code ?? 'unknown'}`}
              </Badge>{' '}
              <code>{step.decision.tool}</code> · action <code>{step.decision.request.action_id}</code> · expected revision{' '}
              <code>{step.decision.request.expected_revision}</code> → now <code>{step.decision.response.observation.revision}</code>
            </p>
            {step.decision.request.operations?.length ? (
              <ol className="evidence-ops">
                {step.decision.request.operations.map((operation, index) => (
                  <li key={index}>{operationText(operation)}</li>
                ))}
              </ol>
            ) : (
              <p className="muted">{step.decision.tool === 'wait' ? 'Waited one round without starting work.' : 'Closed the run without moving time.'}</p>
            )}
            {step.decision.response.error && (
              <p className="tone-error">{step.decision.response.error.message}</p>
            )}
            <details>
              <summary>Request payload as sent</summary>
              <JsonView value={step.decision.request} label="Request payload" />
            </details>
          </section>
        )}

        <section aria-labelledby="ev-consequence">
          <h3 id="ev-consequence">{step.decision ? 'What happened' : 'Opening events'}</h3>
          {step.events.length === 0 ? (
            <p className="muted">No world events.</p>
          ) : (
            <ul className="evidence-events">
              {step.events.map((event, index) => {
                const text = eventText(classifyEvent(event), step.observation.jobs)
                return (
                  <li key={index}>
                    <span className={`tone-${text.tone}`} aria-hidden="true">{text.glyph} </span>
                    <strong>{text.title}</strong> <span className="mono muted">{roundTag(event.round)}</span>
                    <div className="mono evidence-detail">{text.detail}</div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="ev-rules">
          <h3 id="ev-rules">Rules in force</h3>
          <p>{(step.before ?? step.observation).charter.goal}</p>
          <ol className="evidence-rules">
            {(step.before ?? step.observation).charter.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="ev-alternatives">
          <h3 id="ev-alternatives">Verified alternatives</h3>
          <p className="muted">
            Not available. Counterfactual repairs need the repair worker and fork endpoints from the engineering blueprint (§12), which
            this API does not provide yet. Nothing is inferred in the browser.
          </p>
        </section>

        <section aria-labelledby="ev-provenance">
          <h3 id="ev-provenance">Provenance</h3>
          <dl className="provenance">
            <dt>Run</dt>
            <dd>
              <Hash value={record.id} label="run ID" />
            </dd>
            {record.opening && (
              <>
                <dt>Scenario fingerprint</dt>
                <dd>
                  <Hash value={record.opening.scenario_hash} label="scenario fingerprint" />
                </dd>
              </>
            )}
            <dt>Step</dt>
            <dd className="mono">{step.index}</dd>
            <dt>Source</dt>
            <dd>Frames streamed by POST /api/runs and recorded in this browser on {new Date(record.createdAt).toLocaleString()}.</dd>
          </dl>
        </section>
      </div>
    </Modal>
  )
}

function Facts({ observation }: { observation: Observation }) {
  const inEffect = observation.notices.filter((notice) => notice.effective_round <= observation.round)
  const scheduled = observation.notices.filter((notice) => notice.effective_round > observation.round)
  const open = obligations(observation).filter((row) => row.status !== 'met')
  return (
    <dl className="facts">
      <dt>Round</dt>
      <dd className="mono">
        {observation.round} of {observation.horizon} · revision {observation.revision} · spend {observation.spent}/{observation.cost_cap}
      </dd>
      <dt>Routes</dt>
      <dd>
        <ul>
          {observation.routes.map((route) => (
            <li key={route.id} className={route.open ? undefined : 'tone-error'}>
              <span className="mono">{route.id}</span> {route.source}→{route.destination} · {route.open ? 'open' : 'closed'} · {route.duration}r · cost{' '}
              {route.cost} · draft ≤{route.max_draft}
            </li>
          ))}
        </ul>
      </dd>
      <dt>Vessels</dt>
      <dd>
        <ul>
          {observation.vessels.map((vessel) => {
            const voyage = vessel.voyage_id ? observation.voyages.find((item) => item.id === vessel.voyage_id) : undefined
            return (
              <li key={vessel.id}>
                <span className="mono">{vessel.id}</span> cap {vessel.capacity} · draft {vessel.draft} ·{' '}
                {voyage ? `→ ${voyage.destination} ETA ${roundTag(voyage.arrival)} with ${loadsText(voyage.loads)}` : `idle at ${vessel.dock ?? 'unknown'}`}
              </li>
            )
          })}
        </ul>
      </dd>
      <dt>Open obligations</dt>
      <dd>
        {open.length === 0 ? (
          'None'
        ) : (
          <ul>
            {open.map((row) => (
              <li key={row.job.id}>
                <span className="mono">{row.job.id}</span> {row.onTime}/{row.job.units} to {row.job.destination} by {roundTag(row.job.due_round)}
                {row.inTransit ? ` · ${row.inTransit} in transit` : ''}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt>Notices</dt>
      <dd>
        {inEffect.length + scheduled.length === 0 ? (
          'None published'
        ) : (
          <ul>
            {inEffect.map((notice) => (
              <li key={notice.id}>
                <span className="tone-notice" aria-hidden="true">◆ </span>In effect: {noticeText(notice, observation.round)}
              </li>
            ))}
            {scheduled.map((notice) => (
              <li key={notice.id}>
                <span className="tone-notice" aria-hidden="true">◆ </span>Announced: {noticeText(notice, observation.round)}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
  )
}
