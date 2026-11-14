import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible dialog: focus moves in and is trapped, Escape closes, focus
 * returns to the opener. "drawer" slides from the right; "dialog" is centred.
 */
export function Modal({
  title,
  onClose,
  children,
  variant = 'dialog',
  footer,
}: {
  title: ReactNode
  onClose(): void
  children: ReactNode
  variant?: 'dialog' | 'drawer'
  footer?: ReactNode
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = panel.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => !item.closest('[hidden], [inert]'))
      if (items.length === 0) {
        event.preventDefault()
        node.focus()
        return
      }
      const firstItem = items[0] as HTMLElement
      const lastItem = items[items.length - 1] as HTMLElement
      if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === node)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  return createPortal(
    <div className={`modal-backdrop modal-${variant}`}>
      <button type="button" className="modal-scrim" aria-label="Close" tabIndex={-1} onClick={() => onCloseRef.current()} />
      <div ref={panel} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        {/* div, not header/footer: portaled to <body>, those would become extra banner/contentinfo landmarks. */}
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm modal-close" onClick={() => onCloseRef.current()}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
