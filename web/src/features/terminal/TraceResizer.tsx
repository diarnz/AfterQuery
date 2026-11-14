import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { TRACE_WIDTH_MAX, TRACE_WIDTH_MIN, usePreferences } from '../../state/preferences'

const clamp = (value: number) => Math.min(Math.max(Math.round(value), TRACE_WIDTH_MIN), TRACE_WIDTH_MAX)

/** Drag or use arrow keys to resize the trace pane. The width persists per viewer. */
export function TraceResizer() {
  const { traceWidth, set } = usePreferences()
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: traceWidth }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    set('traceWidth', clamp(drag.current.startWidth + (drag.current.startX - event.clientX)))
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    if (event.key === 'ArrowLeft') set('traceWidth', clamp(traceWidth + step))
    else if (event.key === 'ArrowRight') set('traceWidth', clamp(traceWidth - step))
    else if (event.key === 'Home') set('traceWidth', TRACE_WIDTH_MAX)
    else if (event.key === 'End') set('traceWidth', TRACE_WIDTH_MIN)
    else return
    event.preventDefault()
  }

  return (
    // A focusable separator is an ARIA widget (window splitter pattern); jsx-a11y treats every separator as static.
    /* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
    <div
      className="trace-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize action trace"
      aria-valuemin={TRACE_WIDTH_MIN}
      aria-valuemax={TRACE_WIDTH_MAX}
      aria-valuenow={traceWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
    /* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */
  )
}
