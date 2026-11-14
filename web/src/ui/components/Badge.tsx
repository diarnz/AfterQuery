import type { ReactNode } from 'react'

export type BadgeTone = 'live' | 'ok' | 'error' | 'notice' | 'pending' | 'infra' | 'muted' | 'brass'

/** Status is always glyph + word + colour, so it reads in grayscale too. */
export function Badge({ tone, glyph, children, title }: { tone: BadgeTone; glyph: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      <span aria-hidden="true" className="badge-glyph">
        {glyph}
      </span>
      {children}
    </span>
  )
}
