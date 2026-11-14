import { describe, expect, it } from 'vitest'
import { catalogFromOpenApi } from '../contracts/catalog'
import { canonicalJson, formatScore, humanize, middleTruncate, vesselLetter } from '../lib/format'
import { OPENAPI, recordFrom } from '../test/fixtures'
import { buildTimeline } from '../state/timeline'
import { alignRuns } from './compare/alignRuns'
import { parseSeed } from './footer/RunControls'
import { buildTraceRows } from './trace/buildTraceRows'

describe('alignRuns', () => {
  const reference = buildTimeline(recordFrom('fixture-reference'))
  const stopEarly = buildTimeline(recordFrom('fixture-stop-early'))

  it('finds the first round where decisions differ', () => {
    const alignment = alignRuns(stopEarly, reference)
    expect(alignment.firstDivergence).toBe(1)
    expect(alignment.rounds.map((row) => [row.round, row.differs])).toEqual([
      [0, false],
      [1, true],
      [2, true],
      [3, true],
      [4, true],
    ])
  })

  it('reports no divergence for identical runs', () => {
    expect(alignRuns(reference, reference).firstDivergence).toBeNull()
  })
})

describe('buildTraceRows', () => {
  const steps = buildTimeline(recordFrom('fixture-reference'))

  it('groups rows by round and stops at the cursor', () => {
    const rows = buildTraceRows(steps, 1, null)
    expect(rows.map((row) => (row.kind === 'round' ? `R${row.round}` : row.kind === 'decision' ? `D${row.step}` : `E${row.step}`))).toEqual([
      'R0', 'E0', 'D1', 'E1', 'E1', 'R1', 'E1', 'E1',
    ])
  })

  it('filters to rows that mention the pinned entity', () => {
    const rows = buildTraceRows(steps, 5, { kind: 'vessel', id: 'barge-a' })
    const touched = rows.flatMap((row) => (row.kind === 'round' ? [] : [row.step]))
    expect(new Set(touched)).toEqual(new Set([3, 4]))
  })
})

describe('parseSeed', () => {
  const catalog = catalogFromOpenApi(OPENAPI)
  it('accepts blank, zero and the maximum', () => {
    expect(parseSeed('', catalog)).toEqual({ seed: null, error: null })
    expect(parseSeed(' 0 ', catalog)).toEqual({ seed: 0, error: null })
    expect(parseSeed(String(2 ** 32 - 1), catalog)).toEqual({ seed: 2 ** 32 - 1, error: null })
  })
  it('rejects negatives, fractions and out-of-range values', () => {
    expect(parseSeed('-1', catalog).error).toMatch(/whole number/)
    expect(parseSeed('1.5', catalog).error).toMatch(/whole number/)
    expect(parseSeed(String(2 ** 32), catalog).error).toMatch(/between 0 and 4294967295/)
  })
})

describe('format helpers', () => {
  it('formats and normalises display values', () => {
    expect(formatScore(5953 / 7000)).toBe('0.850429')
    expect(humanize('reactive_closure')).toBe('Reactive closure')
    expect(vesselLetter('barge-b')).toBe('B')
    expect(middleTruncate('d87ef83688d7806a6d86f40003216421', 4, 4)).toBe('d87e…6421')
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}')
  })
})
