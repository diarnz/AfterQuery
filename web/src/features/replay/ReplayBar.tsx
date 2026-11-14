import { useEffect, useState } from 'react'
import { roundTag } from '../../lib/format'
import type { Step } from '../../state/timeline'
import { Button } from '../../ui'

export const SPEEDS = [0.5, 1, 2, 4] as const
const BASE_INTERVAL_MS = 1200

function StepMarks({ step }: { step: Step }) {
  return (
    <>
      {step.events.some((event) => event.type.startsWith('notice_')) && <span className="tone-notice">◆</span>}
      {step.events.some((event) => event.type === 'delivery_receipted') && <span className="tone-ok">■</span>}
      {step.decision && !step.decision.response.accepted && <span className="tone-error">✕</span>}
    </>
  )
}

/**
 * Transport for moving through a run's steps. It only moves a cursor over
 * snapshots the API already sent; it never runs or changes the episode.
 */
export function ReplayBar({
  steps,
  cursor,
  following,
  live,
  playing,
  onPlayingChange,
  onChange,
}: {
  steps: readonly Step[]
  cursor: number
  following: boolean
  live: boolean
  playing: boolean
  onPlayingChange(playing: boolean): void
  /** null returns to "follow latest". */
  onChange(index: number | null): void
}) {
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const last = steps.length - 1
  const current = steps[cursor]

  useEffect(() => {
    if (!playing) return
    if (cursor >= last) {
      onPlayingChange(false)
      return
    }
    const timer = window.setTimeout(() => onChange(cursor + 1 >= last ? null : cursor + 1), BASE_INTERVAL_MS / speed)
    return () => window.clearTimeout(timer)
  }, [playing, cursor, last, speed, onChange, onPlayingChange])

  /** Reaching the last step returns to "follow latest", so live runs keep updating. */
  const go = (index: number) => onChange(index >= last ? null : Math.max(0, index))
  const atStart = cursor <= 0
  const atEnd = cursor >= last
  const mode = following ? (live ? 'Following live' : 'Latest step') : 'Replay'

  return (
    <section className="replay-bar" aria-label="Replay">
      <div className="replay-transport">
        <Button size="sm" variant="ghost" aria-label="First step" disabledReason={atStart ? 'Already at the first step.' : null} onClick={() => go(0)}>
          ⏮
        </Button>
        <Button size="sm" variant="ghost" aria-label="Previous step (J)" disabledReason={atStart ? 'Already at the first step.' : null} onClick={() => go(cursor - 1)}>
          ◀
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          disabledReason={!playing && atEnd ? 'Already at the latest step.' : null}
          onClick={() => onPlayingChange(!playing)}
        >
          {playing ? '⏸' : '⏵'}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Next step (K)" disabledReason={atEnd ? 'Already at the latest step.' : null} onClick={() => go(cursor + 1)}>
          ▶
        </Button>
        <Button size="sm" variant="ghost" aria-label={live ? 'Follow live' : 'Latest step'} disabledReason={following ? 'Already showing the latest step.' : null} onClick={() => onChange(null)}>
          ⏭
        </Button>
      </div>

      <div className="replay-track">
        <input
          type="range"
          min={0}
          max={Math.max(last, 0)}
          step={1}
          value={cursor}
          aria-label="Step"
          aria-valuetext={current ? `Step ${cursor} of ${last}, round ${current.observation.round}` : 'No steps'}
          onChange={(event) => {
            go(Number(event.target.value))
          }}
        />
        <ol className="replay-ticks" aria-hidden="true">
          {steps.map((step) => (
            <li key={step.index} className={step.index === cursor ? 'is-current' : undefined}>
              <span className="mono">{roundTag(step.observation.round)}</span>
              <span className="replay-marks">
                <StepMarks step={step} />
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="replay-status">
        <span className="mono">
          Step {cursor} / {last}
        </span>
        <span className={`replay-mode${following ? '' : ' is-replay'}`}>{mode}</span>
        <label className="replay-speed">
          <span>Speed</span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])}>
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
