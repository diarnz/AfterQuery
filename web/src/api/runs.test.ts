import { describe, expect, it, vi } from 'vitest'
import type { RunRequest } from '../contracts/catalog'
import type { RunFrame } from '../contracts/frames'
import { STREAMS, chunkedResponse, jsonResponse } from '../test/fixtures'
import { ApiRequestError } from './http'
import { streamRun } from './runs'

const request: RunRequest = { scenario: 'fixture', policy: 'reference', seed: null }

async function collect(signal = new AbortController().signal, req = request): Promise<RunFrame[]> {
  const frames: RunFrame[] = []
  for await (const frame of streamRun(req, signal)) frames.push(frame)
  return frames
}

describe('streamRun', () => {
  it('yields validated frames from a chunked real stream and posts the request body', async () => {
    const fetchMock = vi.fn(async () => chunkedResponse(STREAMS['fixture-reference'].text, {}, 11))
    vi.stubGlobal('fetch', fetchMock)
    const frames = await collect()
    expect(frames.map((frame) => frame.type)).toEqual(['opening', 'decision', 'decision', 'decision', 'decision', 'decision', 'complete'])
    const last = frames.at(-1)
    expect(last?.type === 'complete' && last.result.planner_score).toBeCloseTo(5953 / 7000, 12)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/runs')
    expect(JSON.parse(String(init.body))).toEqual({ scenario: 'fixture', policy: 'reference' })
  })

  it('sends the seed only when one is chosen', async () => {
    const fetchMock = vi.fn(async () => chunkedResponse(STREAMS['reactive-closure-42-reference'].text))
    vi.stubGlobal('fetch', fetchMock)
    await collect(undefined, { scenario: 'reactive_closure', policy: 'reference', seed: 42 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ scenario: 'reactive_closure', policy: 'reference', seed: 42 })
  })

  it('turns a 422 into a readable invalid_request error', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({ detail: [{ loc: ['body', 'seed'], msg: 'Input should be a valid integer' }] }, 422),
    )
    await expect(collect()).rejects.toMatchObject({ code: 'invalid_request', message: expect.stringContaining('seed: Input should be a valid integer') })
  })

  it('reports an unreachable API', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(collect()).rejects.toMatchObject({ code: 'network_unreachable' })
  })

  it('fails when the stream ends before a result', async () => {
    const lines = STREAMS['fixture-reference'].text.trim().split('\n')
    vi.stubGlobal('fetch', async () => chunkedResponse(lines.slice(0, 3).join('\n') + '\n'))
    await expect(collect()).rejects.toMatchObject({ code: 'stream_truncated' })
  })

  it('fails when the first frame is not an opening', async () => {
    const lines = STREAMS['fixture-reference'].text.trim().split('\n')
    vi.stubGlobal('fetch', async () => chunkedResponse(lines.slice(1).join('\n') + '\n'))
    await expect(collect()).rejects.toMatchObject({ code: 'contract_mismatch' })
  })

  it('fails on a frame that breaks the contract, naming where', async () => {
    const lines = STREAMS['fixture-reference'].text.trim().split('\n')
    const broken = JSON.parse(lines[1] as string) as { response: { observation: { round: unknown } } }
    broken.response.observation.round = 'two'
    vi.stubGlobal('fetch', async () => chunkedResponse([lines[0], JSON.stringify(broken)].join('\n') + '\n'))
    const error = await collect().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).message).toMatch(/Frame 2 .* response\.observation\.round/)
  })

  it('rejects frames after the final frame', async () => {
    const text = STREAMS['fixture-idle'].text
    vi.stubGlobal('fetch', async () => chunkedResponse(text + text.split('\n')[0] + '\n'))
    await expect(collect()).rejects.toMatchObject({ code: 'contract_mismatch' })
  })
})
