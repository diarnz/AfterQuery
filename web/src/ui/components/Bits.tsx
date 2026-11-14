import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3 className="display empty-title">{title}</h3>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/** role="alert" for errors that need attention now, role="status" for everything else. */
export function Banner({ tone, title, children, action }: { tone: 'error' | 'infra' | 'notice' | 'pending'; title: string; children?: ReactNode; action?: ReactNode }) {
  const glyph = tone === 'error' ? '✕' : tone === 'infra' ? '⚠' : tone === 'pending' ? '◐' : '◆'
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' || tone === 'infra' ? 'alert' : 'status'}>
      <span aria-hidden="true" className="banner-glyph">
        {glyph}
      </span>
      <div className="banner-text">
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
      {action && <div className="banner-action">{action}</div>}
    </div>
  )
}

/** Middle-truncated identifier with a copy button; the full value is in the accessible name. */
export function Hash({ value, label = 'value', head = 8, tail = 6 }: { value: string; label?: string; head?: number; tail?: number }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const shown = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <span className="hash">
      <code title={value}>
        <span aria-hidden="true">{shown}</span>
        <span className="sr-only">{value}</span>
      </code>
      <button type="button" className="hash-copy" onClick={copy} aria-label={`Copy ${label}`}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </span>
  )
}

export function Meter({ total, segments, label }: { total: number; segments: { value: number; tone: 'ok' | 'pending' | 'error' }[]; label: string }) {
  const safeTotal = Math.max(total, 1)
  return (
    <div className="meter" role="img" aria-label={label}>
      {segments.map((segment, index) =>
        segment.value > 0 ? (
          <span
            key={index}
            className={`meter-segment meter-${segment.tone}`}
            style={{ width: `${(Math.min(segment.value, safeTotal) / safeTotal) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  )
}

export function JsonView({ value, label }: { value: unknown; label: string }) {
  return (
    // Scrollable regions must be keyboard focusable (WCAG 2.1.1); jsx-a11y does not model that case.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <pre className="json-view" aria-label={label} tabIndex={0}>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
