import { describe, expect, it } from 'vitest'
import { NdjsonError, NdjsonSplitter, readNdjson } from './ndjson'

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const values: unknown[] = []
  for await (const value of readNdjson(stream)) values.push(value)
  return values
}

describe('NdjsonSplitter', () => {
  it('joins lines split across pushes and skips blank lines', () => {
    const splitter = new NdjsonSplitter()
    expect(splitter.push('{"a":')).toEqual([])
    expect(splitter.push('1}\n\n{"b"')).toEqual([{ a: 1 }])
    expect(splitter.push(':2}\r\n')).toEqual([{ b: 2 }])
    expect(splitter.finish()).toEqual([])
  })

  it('accepts a complete final line without a newline', () => {
    const splitter = new NdjsonSplitter()
    expect(splitter.push('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }])
    expect(splitter.finish()).toEqual([{ b: 2 }])
  })

  it('reports the line number of invalid JSON', () => {
    const splitter = new NdjsonSplitter()
    splitter.push('{"ok":true}\n')
    expect(() => splitter.push('{"broken"\n')).toThrowError(NdjsonError)
    try {
      new NdjsonSplitter().push('\n{nope}\n')
    } catch (error) {
      expect((error as NdjsonError).line).toBe(2)
    }
  })

  it('rejects a truncated final line', () => {
    const splitter = new NdjsonSplitter()
    splitter.push('{"a":1}\n{"b":')
    expect(() => splitter.finish()).toThrowError(/Line 2/)
  })
})

describe('readNdjson', () => {
  it('decodes multibyte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"text":"rond → ✓"}\n{"n":2}\n')
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]))
    expect(await collect(streamOf(chunks))).toEqual([{ text: 'rond → ✓' }, { n: 2 }])
  })

  it('propagates a stream error', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}\n'))
        controller.error(new Error('connection reset'))
      },
    })
    await expect(collect(failing)).rejects.toThrow('connection reset')
  })
})
