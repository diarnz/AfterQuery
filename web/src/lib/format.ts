/** Display helpers. Pure functions only. */

/** Turns "cloth-east" or "reactive_closure" into "Cloth east" / "Reactive closure". */
export function humanize(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Dense round notation used in data: r4. */
export function roundTag(round: number): string {
  return `r${round}`
}

/** One display rounding rule for scores: 6 decimal places. */
export function formatScore(value: number): string {
  return value.toFixed(6)
}

export function middleTruncate(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

/** "barge-a" → "A"; falls back to the first character of the last segment. */
export function vesselLetter(id: string): string {
  const last = id.split(/[-_]/).filter(Boolean).at(-1) ?? id
  return (last.charAt(0) || '?').toUpperCase()
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Deterministic JSON with sorted object keys, for comparing payloads. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
