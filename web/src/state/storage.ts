/** Browser storage can be missing or throw (private windows, blocked site data). Every access is guarded. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function browserStorage(): KeyValueStorage | null {
  try {
    const storage = window.localStorage
    const probe = '__runbook_probe__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

/** Per-tab storage: survives a reload, not a new tab. */
export function tabStorage(): KeyValueStorage | null {
  try {
    const storage = window.sessionStorage
    const probe = '__runbook_probe__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

export function readItem(storage: KeyValueStorage | null, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** Returns false when the write failed (quota exceeded or storage blocked). */
export function writeItem(storage: KeyValueStorage | null, key: string, value: string): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(storage: KeyValueStorage | null, key: string): void {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Nothing to recover: the value simply stays.
  }
}
