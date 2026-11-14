import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
}

/** WAI-ARIA tabs with arrow-key navigation and automatic activation. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  renderPanel,
}: {
  items: readonly TabItem<T>[]
  value: T
  onChange(value: T): void
  label: string
  renderPanel(value: T): ReactNode
}) {
  const base = useId()
  const refs = useRef(new Map<T, HTMLButtonElement>())

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    refs.current.get(item.id)?.focus()
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tab-list">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node)
              else refs.current.delete(item.id)
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-controls={`${base}-panel-${item.id}`}
            aria-selected={item.id === value}
            tabIndex={item.id === value ? 0 : -1}
            className="tab"
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${value}`}
        aria-labelledby={`${base}-tab-${value}`}
        className="tab-panel"
      >
        {renderPanel(value)}
      </div>
    </div>
  )
}
