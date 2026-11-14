import { useId, type ReactNode } from 'react'

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  const headingId = useId()
  return (
    <section className={['panel', className].filter(Boolean).join(' ')} aria-labelledby={headingId} id={id}>
      <header className="panel-header">
        <h2 id={headingId} className="panel-title">
          {title}
        </h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={['panel-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </section>
  )
}
