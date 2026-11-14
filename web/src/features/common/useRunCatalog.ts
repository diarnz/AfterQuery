import { useCallback, useEffect, useState } from 'react'
import { fetchRunCatalog } from '../../api/catalog'
import type { RunCatalog } from '../../contracts/catalog'

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: RunCatalog }
  | { status: 'error'; message: string }

/** Reads scenarios and policies from the API's own OpenAPI document. */
export function useRunCatalog(): CatalogState & { retry(): void } {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CatalogState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetchRunCatalog(controller.signal)
      .then((catalog) => setState({ status: 'ready', catalog }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])
  return { ...state, retry }
}
