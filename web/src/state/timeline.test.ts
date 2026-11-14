import { describe, expect, it } from 'vitest'
import { recordFrom } from '../test/fixtures'
import { buildTimeline, resolveCursor, stepAtRound } from './timeline'

describe('buildTimeline', () => {
  const steps = buildTimeline(recordFrom('fixture-reference'))

  it('has the opening plus one step per decision, each using the server snapshot', () => {
    expect(steps.map((step) => [step.kind, step.roundBefore, step.observation.round])).toEqual([
      ['opening', 0, 0],
      ['decision', 0, 1],
      ['decision', 1, 2],
      ['decision', 2, 3],
      ['decision', 3, 4],
      ['decision', 4, 4],
    ])
    expect(steps[2]?.before).toBe(steps[1]?.observation)
    expect(steps.map((step) => step.decision?.tool ?? null)).toEqual([null, 'commit', 'wait', 'commit', 'wait', 'finish'])
  })

  it('is empty before the opening frame arrives', () => {
    expect(buildTimeline({ ...recordFrom('fixture-idle'), opening: null, decisions: [] })).toEqual([])
  })
})

describe('resolveCursor', () => {
  const steps = buildTimeline(recordFrom('fixture-reference'))
  it('follows the latest step when nothing is requested', () => expect(resolveCursor(steps, null)).toBe(5))
  it('clamps out-of-range requests', () => {
    expect(resolveCursor(steps, 99)).toBe(5)
    expect(resolveCursor(steps, -3)).toBe(0)
  })
  it('handles an empty timeline', () => expect(resolveCursor([], 3)).toBe(0))
})

describe('stepAtRound', () => {
  const steps = buildTimeline(recordFrom('fixture-reference'))
  it('returns the last step whose snapshot is at or before the round', () => {
    expect(stepAtRound(steps, 0)?.index).toBe(0)
    expect(stepAtRound(steps, 2)?.index).toBe(2)
    expect(stepAtRound(steps, 4)?.index).toBe(5)
  })
})
