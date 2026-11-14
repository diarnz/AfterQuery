import { Link } from 'react-router'
import { Panel } from '../../ui'

const AREAS = {
  learning: {
    title: 'Learning',
    summary:
      'Checkpoints, the failure-to-adapter lineage chain, and paired base-versus-tuned held-out reports (engineering blueprint §12–13).',
    needs: [
      ['GET /api/learning/checkpoints', 'Adapter digests, base revision, dataset digest, training status'],
      ['GET /api/learning/lineage/:ref', 'Ordered chain from episode to held-out report (gap G-13)'],
      ['GET /api/learning/evidence/:id', 'Repair, lesson and export records'],
      ['Durable run IDs', 'So a lineage node can link back to a stored episode'],
    ],
  },
  evaluations: {
    title: 'Evaluations',
    summary:
      'The judge report: reference, frontier, idle and stop-early attempts per scenario, sealed verifier verdicts, and the reproduction bundle (engineering blueprint §9 and §15).',
    needs: [
      ['GET /api/evaluations, GET /api/evaluations/:id', 'Suites, attempts and summaries (gap G-10)'],
      ['GET /api/runs/:id/verdict', 'Independent verifier verdicts; the current API returns only a planner estimate'],
      ['Durable run IDs and stored ledgers', 'So every table cell links to a replayable run'],
    ],
  },
} as const

/**
 * An honest placeholder for areas whose data the API does not serve yet. It
 * shows no sample numbers: what it lists is what the backend needs to add.
 */
export function CapabilityPage({ area }: { area: keyof typeof AREAS }) {
  const content = AREAS[area]
  return (
    <div className="page capability-page">
      <header className="page-header">
        <h1 className="display">{content.title}</h1>
        <p className="muted">{content.summary}</p>
      </header>
      <Panel title="Not provided by this API yet">
        <p>
          The Runbook API currently serves one run at a time over <code>POST /api/runs</code> and keeps no history. This view stays empty
          rather than showing sample data. It needs:
        </p>
        <table className="capability-table">
          <caption className="sr-only">Backend capabilities this view needs</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Used for</th>
            </tr>
          </thead>
          <tbody>
            {content.needs.map(([endpoint, purpose]) => (
              <tr key={endpoint}>
                <th scope="row">
                  <code>{endpoint}</code>
                </th>
                <td>{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          The full list of backend contract gaps is in <code>web/docs/FRONTEND_BLUEPRINT.md</code>, Appendix B. Meanwhile, runs, replay, evidence
          and comparison work in the <Link to="/">terminal</Link>.
        </p>
      </Panel>
    </div>
  )
}
