import { useEffect, useRef } from 'react'
import { formatScore, humanize } from '../../lib/format'
import { shortRunId } from '../../state/runRecord'
import { useLibrarySnapshot } from '../../state/runLibraryContext'
import { useTerminalSession } from '../../state/terminalSession'

/** Writes each run's ending to the session console when its stream closes. Renders nothing. */
export function RunOutcomeLogger() {
  const { records, live } = useLibrarySnapshot()
  const session = useTerminalSession()
  const previous = useRef<ReadonlySet<string>>(live)

  useEffect(() => {
    for (const id of previous.current) {
      if (live.has(id)) continue
      const record = records.find((item) => item.id === id)
      const outcome = record?.outcome
      const name = `run ${shortRunId(id)}`
      if (!outcome) continue
      if (outcome.kind === 'complete') {
        const { result } = outcome
        session.log(
          result.complete ? 'ok' : 'error',
          `${name} finished (${humanize(result.reason).toLowerCase()}): planner estimate ${formatScore(result.planner_score)}, ${
            result.complete ? 'all obligations met' : 'obligations incomplete'
          }`,
        )
      } else if (outcome.kind === 'stopped') {
        session.log('muted', `${name} stopped by operator; no estimate`)
      } else if (outcome.kind === 'failed' || outcome.kind === 'error') {
        session.log('error', `${name} ended with ${outcome.error.code}: ${outcome.error.message}`)
      } else {
        session.log('error', `${name} interrupted`)
      }
    }
    previous.current = live
  }, [live, records, session])

  return null
}
