/**
 * Incremental NDJSON parsing. Chunks may split lines, and multibyte characters,
 * at any byte; the decoder runs in streaming mode so both are handled.
 */

export class NdjsonError extends Error {
  constructor(message: string, readonly line: number) {
    super(message)
    this.name = 'NdjsonError'
  }
}

export class NdjsonSplitter {
  private buffer = ''
  private lineNumber = 0

  /** Returns every complete, non-blank line contained in the new text, parsed as JSON. */
  push(text: string): unknown[] {
    this.buffer += text
    const values: unknown[] = []
    let end = this.buffer.indexOf('\n')
    while (end !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '')
      this.buffer = this.buffer.slice(end + 1)
      this.lineNumber += 1
      if (line.trim()) values.push(this.parse(line))
      end = this.buffer.indexOf('\n')
    }
    return values
  }

  /** Call once the stream ends. A trailing line without a newline is accepted if it is complete JSON. */
  finish(): unknown[] {
    const rest = this.buffer
    this.buffer = ''
    if (!rest.trim()) return []
    this.lineNumber += 1
    return [this.parse(rest)]
  }

  private parse(line: string): unknown {
    try {
      return JSON.parse(line)
    } catch {
      throw new NdjsonError(`Line ${this.lineNumber} of the run stream is not valid JSON.`, this.lineNumber)
    }
  }
}

export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const splitter = new NdjsonSplitter()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      yield* splitter.push(decoder.decode(value, { stream: true }))
    }
    yield* splitter.push(decoder.decode())
    yield* splitter.finish()
  } finally {
    reader.releaseLock()
    // Cancelling an already-finished or errored body is harmless; ignore its rejection.
    body.cancel().catch(() => undefined)
  }
}
