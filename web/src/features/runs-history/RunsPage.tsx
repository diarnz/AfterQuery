import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'
import { formatScore, formatTimestamp } from '../../lib/format'
import { MAX_STORED_RUNS } from '../../state/runLibrary'
import { runStatus, shortRunId, type RunRecord } from '../../state/runRecord'
import { useLibrarySnapshot, useRunLibrary } from '../../state/runLibraryContext'
import { Badge, Banner, Button, EmptyState, Modal, Panel } from '../../ui'
import { STATUS_BADGE, policyLabel, scenarioLabel } from '../common/labels'

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function stamp(): string {
  return new Date().toISOString().replace(/[:]/g, '').replace(/\..+$/, '')
}

function estimate(record: RunRecord): string {
  return record.outcome?.kind === 'complete' ? formatScore(record.outcome.result.planner_score) : '—'
}

export function RunsPage() {
  const library = useRunLibrary()
  const { records, live, persistence, droppedOnLoad } = useLibrarySnapshot()
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ tone: 'notice' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'one'; record: RunRecord } | { kind: 'all' } | null>(null)

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = library.importJson(await file.text())
      setMessage({
        tone: 'notice',
        text: `Imported ${result.added} run${result.added === 1 ? '' : 's'}${result.skipped ? `; skipped ${result.skipped} (already present, unfinished, or invalid)` : ''}.`,
      })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const finished = records.filter((record) => record.outcome)

  return (
    <div className="page runs-page">
      <header className="page-header">
        <h1 className="display">Runs</h1>
        <p className="muted">
          Every run this browser has streamed from the API. The API keeps no run history, so these records are the only copy; export them to
          keep or share them. Up to {MAX_STORED_RUNS} runs are stored.
        </p>
      </header>

      {persistence === 'memory' && (
        <Banner tone="infra" title="Runs are not being saved">
          This browser blocks site storage or is out of space, so runs last only until the page closes. Export anything you need.
        </Banner>
      )}
      {droppedOnLoad > 0 && (
        <Banner tone="pending" title={`${droppedOnLoad} stored record${droppedOnLoad === 1 ? '' : 's'} could not be read`}>
          They did not match this terminal's record format and were skipped.
        </Banner>
      )}
      {message && (
        <Banner tone={message.tone} title={message.tone === 'error' ? 'Import failed' : 'Import finished'}>
          {message.text}
        </Banner>
      )}

      <Panel
        title={`Recorded runs (${records.length})`}
        actions={
          <div className="button-row">
            <Button size="sm" onClick={() => fileInput.current?.click()}>
              Import…
            </Button>
            <Button
              size="sm"
              disabledReason={finished.length ? null : 'No finished runs to export.'}
              onClick={() => download(`runbook-runs-${stamp()}.json`, library.exportJson())}
            >
              Export all
            </Button>
            <Button size="sm" variant="danger" disabledReason={records.length ? null : 'Nothing to delete.'} onClick={() => setConfirm({ kind: 'all' })}>
              Delete all
            </Button>
            <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onImport} />
          </div>
        }
      >
        {records.length === 0 ? (
          <EmptyState title="No runs yet" action={<Link to="/">Start one in the terminal</Link>}>
            <p>Runs you start, or import from an export file, are listed here.</p>
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="runs-table">
              <caption className="sr-only">Runs recorded in this browser, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Started</th>
                  <th scope="col">Policy</th>
                  <th scope="col">Environment</th>
                  <th scope="col">Seed</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Planner estimate</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const status = STATUS_BADGE[runStatus(record)]
                  return (
                    <tr key={record.id}>
                      <th scope="row">
                        <Link to={`/runs/${record.id}`} className="mono">
                          {shortRunId(record.id)}
                        </Link>
                      </th>
                      <td>{formatTimestamp(record.createdAt)}</td>
                      <td>{policyLabel(record.request.policy)}</td>
                      <td>{scenarioLabel(record.request.scenario)}</td>
                      <td className="mono">{record.opening ? record.opening.seed ?? 'fixed' : record.request.seed ?? '—'}</td>
                      <td>
                        <Badge tone={status.tone} glyph={status.glyph}>
                          {status.label}
                        </Badge>
                      </td>
                      <td className="num mono">{estimate(record)}</td>
                      <td>
                        <div className="button-row">
                          {record.outcome && record.opening && (
                            <Link to={`/compare?a=${record.id}`} aria-label={`Compare run ${shortRunId(record.id)}`}>
                              Compare
                            </Link>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabledReason={record.outcome ? null : 'This run is still streaming.'}
                            onClick={() => download(`runbook-run-${shortRunId(record.id)}.json`, library.exportJson([record.id]))}
                            aria-label={`Export run ${shortRunId(record.id)}`}
                          >
                            Export
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirm({ kind: 'one', record })}
                            aria-label={`Delete run ${shortRunId(record.id)}`}
                          >
                            {live.has(record.id) ? 'Stop & delete' : 'Delete'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {confirm && (
        <Modal
          title={confirm.kind === 'all' ? 'Delete all runs?' : `Delete run ${shortRunId(confirm.record.id)}?`}
          onClose={() => setConfirm(null)}
          footer={
            <div className="button-row">
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm.kind === 'all') library.clear()
                  else library.remove(confirm.record.id)
                  setConfirm(null)
                }}
              >
                Delete
              </Button>
            </div>
          }
        >
          <p>
            {confirm.kind === 'all'
              ? `This removes all ${records.length} runs from this browser. The API keeps no copy, so they cannot be recovered unless you exported them.`
              : 'This removes the run from this browser. The API keeps no copy, so it cannot be recovered unless you exported it.'}
            {(confirm.kind === 'all' ? live.size > 0 : live.has(confirm.record.id)) && ' Streaming runs are stopped first.'}
          </p>
        </Modal>
      )}
    </div>
  )
}
