import { useEffect, useState } from 'react'
import { fetchHealth } from '../api/catalog'

export type ApiHealth = 'checking' | 'online' | 'offline'

const INTERVAL_MS = 15_000

/** Polls GET /api/health so a stopped API shows as a named state, not a frozen screen. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>('checking')
  useEffect(() => {
    let controller = new AbortController()
    let timer: number | undefined
    let disposed = false
    const check = async () => {
      controller = new AbortController()
      try {
        const ok = await fetchHealth(controller.signal)
        if (!disposed) setHealth(ok ? 'online' : 'offline')
      } catch {
        if (!disposed && !controller.signal.aborted) setHealth('offline')
      }
      if (!disposed) timer = window.setTimeout(check, INTERVAL_MS)
    }
    void check()
    return () => {
      disposed = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [])
  return health
}
