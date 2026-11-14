import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useLibrarySnapshot } from '../../state/runLibraryContext'
import { useSessionSnapshot, type LineTone } from '../../state/terminalSession'

const PREFIX: Record<LineTone, string> = {
  input: '$',
  system: '·',
  ok: '✓',
  error: '✕',
  muted: '#',
}

/**
 * What the terminal shows before a run starts: a console transcript of the
 * session. Each choice in the controls below is echoed here as a command line;
 * the world and the action trace appear only once a run is started.
 */
export function SetupConsole() {
  const { lines } = useSessionSnapshot()
  const { records } = useLibrarySnapshot()
  const log = useRef<HTMLOListElement>(null)
  const lastId = lines.at(-1)?.id

  useEffect(() => {
    const node = log.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lastId])

  return (
    <section className="console" aria-labelledby="console-title">
      <div className="console-bar">
        <h1 id="console-title" className="console-title">
          runbook — harbor master
        </h1>
        <span className="console-meta">harbor.observe.v1 · tty1</span>
      </div>
      <div className="console-screen">
        <p className="console-banner" aria-hidden="true">
          RENAISSANCE RUNBOOK · agent evaluation tty
        </p>
        <p className="console-intro">
          Choose a model and an environment with the flags below, then run. Every choice is echoed here; the world and the action trace
          open when the run starts.
          {records.length > 0 && (
            <>
              {' '}
              {records.length} recorded run{records.length === 1 ? '' : 's'} can be replayed from <Link to="/runs">Runs</Link>.
            </>
          )}
        </p>
        <div className="console-log-region" role="log" aria-live="polite" aria-label="Session console">
          <ol ref={log} className="console-log">
          {lines.map((line) => (
            <li key={line.id} className={`console-line line-${line.tone}`}>
              <span className="console-time" aria-hidden="true">
                [{line.at}]
              </span>
              <span className="console-prefix" aria-hidden="true">
                {PREFIX[line.tone]}
              </span>
              <span className="console-text">{line.text}</span>
            </li>
          ))}
          </ol>
        </div>
        <p className="console-prompt" aria-hidden="true">
          <span className="prompt-user">runbook@harbor</span>
          <span className="prompt-path">:~$</span>
          <span className="cursor" />
        </p>
      </div>
    </section>
  )
}
