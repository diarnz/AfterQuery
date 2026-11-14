import { describe, expect, it } from 'vitest'
import { OPENAPI, STREAMS, rawLines, type StreamName } from '../test/fixtures'
import { catalogFromOpenApi } from './catalog'
import { runFrameSchema } from './frames'
import { observationSchema } from './harbor'

describe('run frame contract', () => {
  it.each(Object.keys(STREAMS) as StreamName[])('parses every frame of the recorded %s stream', (name) => {
    const lines = rawLines(name)
    const parsed = lines.map((line) => runFrameSchema.safeParse(line))
    for (const result of parsed) expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
    expect(lines[0]).toMatchObject({ type: 'opening' })
    expect(['complete', 'failed']).toContain((lines.at(-1) as { type: string }).type)
  })

  it('ignores unknown additive fields', () => {
    const [opening] = rawLines('fixture-reference') as Record<string, unknown>[]
    const result = runFrameSchema.parse({ ...opening, future_field: { anything: true } })
    expect(result).not.toHaveProperty('future_field')
  })

  it('rejects an observation with a different schema version', () => {
    const [opening] = rawLines('fixture-reference') as { observation: Record<string, unknown> }[]
    const result = observationSchema.safeParse({ ...opening?.observation, schema: 'harbor.observe.v2' })
    expect(result.success).toBe(false)
  })

  it('rejects a frame of unknown type', () => {
    expect(runFrameSchema.safeParse({ type: 'telemetry' }).success).toBe(false)
  })
})

describe('run catalog from OpenAPI', () => {
  it('reads scenarios, policies and seed bounds from the recorded document', () => {
    const catalog = catalogFromOpenApi(OPENAPI)
    expect(catalog.scenarios).toEqual(['fixture', 'forecast_closure', 'reactive_closure', 'open_canal'])
    expect(catalog.policies).toEqual(['reference', 'idle', 'stop-early'])
    expect(catalog.defaultScenario).toBe('fixture')
    expect(catalog.defaultPolicy).toBe('reference')
    expect(catalog.seedMin).toBe(0)
    expect(catalog.seedMax).toBe(2 ** 32 - 1)
  })

  it('throws when the document does not describe RunRequest', () => {
    expect(() => catalogFromOpenApi({ components: { schemas: {} } })).toThrow()
  })
})
