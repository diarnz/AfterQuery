import { useEffect, useRef } from 'react'

export interface Shortcut {
  /** KeyboardEvent.key, compared case-insensitively for letters. */
  key: string
  ctrl?: boolean
  /** Fire even when focus is in a text field. Used only for Ctrl combinations. */
  allowInFields?: boolean
  /** Do nothing when focus is on a button, link, tab or slider, where the key already has a meaning (Space). */
  skipOnControls?: boolean
  handler(event: KeyboardEvent): void
}

export function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a[href], summary, [role="button"], [role="tab"], [role="slider"], input[type="range"], input[type="checkbox"], input[type="radio"]') !== null
}

export function isFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file'].includes(type)
}

function matches(shortcut: Shortcut, event: KeyboardEvent): boolean {
  const wantsCtrl = shortcut.ctrl === true
  const hasCtrl = event.ctrlKey || event.metaKey
  if (wantsCtrl !== hasCtrl || event.altKey) return false
  return shortcut.key.length === 1
    ? event.key.toLowerCase() === shortcut.key.toLowerCase()
    : event.key === shortcut.key
}

/** Window-level shortcuts. Ignored inside text fields and open dialogs unless allowed. */
export function useShortcuts(shortcuts: readonly Shortcut[], enabled = true): void {
  const latest = useRef(shortcuts)
  useEffect(() => {
    latest.current = shortcuts
  })
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const inDialog = event.target instanceof HTMLElement && event.target.closest('[aria-modal="true"]') !== null
      for (const shortcut of latest.current) {
        if (!matches(shortcut, event)) continue
        if (!shortcut.allowInFields && (isFieldTarget(event.target) || inDialog)) return
        if (shortcut.skipOnControls && isControlTarget(event.target)) return
        event.preventDefault()
        shortcut.handler(event)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
