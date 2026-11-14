// Records real run streams from a running Runbook API into test fixtures.
// Usage: RUNBOOK_API_URL=http://127.0.0.1:8000 npm run fixtures:record
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const api = process.env.RUNBOOK_API_URL ?? 'http://127.0.0.1:8000'
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'test', 'fixtures')

const cases = [
  ['fixture-reference', { scenario: 'fixture', policy: 'reference' }],
  ['fixture-idle', { scenario: 'fixture', policy: 'idle' }],
  ['fixture-stop-early', { scenario: 'fixture', policy: 'stop-early' }],
  ['reactive-closure-42-reference', { scenario: 'reactive_closure', policy: 'reference', seed: 42 }],
  ['open-canal-7-reference', { scenario: 'open_canal', policy: 'reference', seed: 7 }],
]

await mkdir(outDir, { recursive: true })
for (const [name, body] of cases) {
  const response = await fetch(`${api}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const text = await response.text()
  await writeFile(join(outDir, `${name}.ndjson`), text)
  console.log(`${name}: ${text.trim().split('\n').length} frames`)
}

const openapi = await fetch(`${api}/openapi.json`)
if (!openapi.ok) throw new Error(`openapi: HTTP ${openapi.status}`)
await writeFile(join(outDir, 'openapi.json'), JSON.stringify(await openapi.json(), null, 2) + '\n')
console.log('openapi.json recorded')
