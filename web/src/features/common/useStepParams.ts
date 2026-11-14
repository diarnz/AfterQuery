import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

function parseIndex(value: string | null): number | null {
  if (value === null || !/^\d{1,6}$/.test(value)) return null
  return Number(value)
}

/**
 * Replay position and the evidence drawer live in the URL (?step=, ?evidence=),
 * so a pasted link opens the same moment. No ?step means "follow the latest step".
 */
export function useStepParams() {
  const [params, setParams] = useSearchParams()
  const step = parseIndex(params.get('step'))
  const evidence = parseIndex(params.get('evidence'))

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setStep = useCallback((index: number | null) => update({ step: index === null ? null : String(index) }), [update])
  const openEvidence = useCallback((index: number) => update({ evidence: String(index) }), [update])
  const closeEvidence = useCallback(() => update({ evidence: null }), [update])

  return { step, evidence, setStep, openEvidence, closeEvidence }
}
