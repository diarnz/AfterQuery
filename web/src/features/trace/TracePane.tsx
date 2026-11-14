import { useEffect, useMemo, useRef, useState } from 'react'
import type { EntityRef } from '../../lib/entities'
import { humanize, roundTag } from '../../lib/format'
import { useSelection } from '../../state/selection'
import type { Step } from '../../state/timeline'
import { Button, EmptyState, Panel } from '../../ui'
import { operationText } from '../../worlds/harbor'
import { buildTraceRows, type TraceRow } from './buildTraceRows'

const TOOL_GLYPH: Record<string, string> = { commit: '✓', wait: '⏵', finish: '⏹' }

export function TracePane({
  steps,
  cursor,
  live,
  following,
  onSelectStep,
  onOpenEvidence,
}: {
  steps: readonly Step[]
  cursor: number
  live: boolean
  following: boolean
  onSelectStep(index: number): void
  onOpenEvidence(index: number): void
}) {
  const { pinned, clearPinned, setHovered } = useSelection()
  const rows = useMemo(() => buildTraceRows(steps, cursor, pinned), [steps, cursor, pinned])
  const list = useRef<HTMLOListElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const lastKey = rows.at(-1)?.key

  // Auto-follow keeps the newest row in view while following; scrolling up pauses it.
  useEffect(() => {
    const node = list.current
    if (!node || !following || !atBottom) return
    node.scrollTop = node.scrollHeight
  }, [lastKey, following, atBottom])

  const onScroll = () => {
    const node = list.current
    if (!node) return
    setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 24)
  }

  const actions = pinned ? (
    <Button size="sm" variant="ghost" onClick={clearPinned}>
      Showing {pinned.kind} {pinned.id} · Clear filter
    </Button>
  ) : (
    <span className="muted panel-hint">Hover a row to locate it on the map; click a map item to filter.</span>
  )

  return (
    <Panel title="Action trace" actions={actions} className="trace-pane" bodyClassName="trace-body">
      {rows.length === 0 ? (
        <EmptyState title={steps.length ? 'No rows match this filter' : 'Nothing yet'}>
          {steps.length
            ? <p>No step up to the current position mentions the selected item.</p>
            : <p>Start a run, or open one from Runs. Decisions and world events appear here, grouped by round.</p>}
        </EmptyState>
      ) : (
        <ol
          ref={list}
          className="trace-list"
          onScroll={onScroll}
          // Live announcements are limited to the trace's own region; rows are short.
          aria-live={live ? 'polite' : 'off'}
          aria-relevant="additions"
        >
          {rows.map((row) => (
            <TraceItem
              key={row.key}
              row={row}
              current={row.kind !== 'round' && row.step === cursor}
              onHover={setHovered}
              onSelectStep={onSelectStep}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </ol>
      )}
      {!atBottom && following && rows.length > 0 && (
        <button
          type="button"
          className="trace-jump"
          onClick={() => {
            const node = list.current
            if (node) node.scrollTop = node.scrollHeight
            setAtBottom(true)
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </Panel>
  )
}

function TraceItem({
  row,
  current,
  onHover,
  onSelectStep,
  onOpenEvidence,
}: {
  row: TraceRow
  current: boolean
  onHover(entities: readonly EntityRef[]): void
  onSelectStep(index: number): void
  onOpenEvidence(index: number): void
}) {
  if (row.kind === 'round') {
    return (
      <li className="trace-round" aria-label={`Round ${row.round}`}>
        <span aria-hidden="true">Round {row.round}</span>
      </li>
    )
  }
  const hoverProps = {
    onMouseEnter: () => onHover(row.entities),
    onMouseLeave: () => onHover([]),
    onFocus: () => onHover(row.entities),
    onBlur: () => onHover([]),
  }
  if (row.kind === 'decision') {
    const tone = row.accepted ? 'ok' : 'error'
    const glyph = row.accepted ? TOOL_GLYPH[row.tool] ?? '•' : '✕'
    return (
      <li className={`trace-row trace-decision${current ? ' is-current' : ''}`}>
        <span className="trace-seq mono" aria-label={`Step ${row.step}`}>#{row.step}</span>
        <div className="trace-main">
          <div className="trace-head">
            <span className={`trace-glyph tone-${tone}`} aria-hidden="true">{glyph}</span>
            <strong>{humanize(row.tool)}</strong>
            <span className={`tone-${tone}`}>{row.accepted ? 'Accepted' : `Rejected · ${row.error?.code ?? 'unknown'}`}</span>
            <span className="trace-meta mono">
              {roundTag(row.round)} · rev {row.revisionFrom}→{row.revisionTo}
            </span>
          </div>
          {row.operations.length > 0 && (
            <ul className="trace-ops">
              {row.operations.map((operation, index) => (
                <li key={index}>{operationText(operation)}</li>
              ))}
            </ul>
          )}
          {row.error && <p className="tone-error">{row.error.message}</p>}
          <div className="trace-actions">
            <button type="button" className="link-button" {...hoverProps} onClick={() => onSelectStep(row.step)}>
              Show map at this step
            </button>
            <button type="button" className="link-button" {...hoverProps} onClick={() => onOpenEvidence(row.step)}>
              Evidence
            </button>
            <span className="muted mono trace-action-id">{row.actionId}</span>
          </div>
        </div>
      </li>
    )
  }
  return (
    <li className={`trace-row trace-event${current ? ' is-current' : ''}`}>
      <span className="trace-seq mono" aria-hidden="true">#{row.step}</span>
      <div className="trace-main">
        <div className="trace-head">
          <span className={`trace-glyph tone-${row.text.tone}`} aria-hidden="true">{row.text.glyph}</span>
          <button type="button" className="trace-event-title link-button" {...hoverProps} onClick={() => onSelectStep(row.step)}>
            {row.text.title}
          </button>
          <span className="trace-meta mono">{roundTag(row.round)}</span>
        </div>
        <p className="trace-detail mono">{row.text.detail}</p>
      </div>
    </li>
  )
}
