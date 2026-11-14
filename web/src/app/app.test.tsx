import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { streamRun } from '../api/runs'
import { PreferencesProvider } from '../state/preferences'
import { EXPORT_FORMAT, RunLibrary } from '../state/runLibrary'
import { RunLibraryProvider } from '../state/runLibraryContext'
import { TerminalSession, TerminalSessionProvider } from '../state/terminalSession'
import { recordFrom, stubApi, type StreamName } from '../test/fixtures'
import { routes } from './routes'

let counter = 0

function setup(path: string, options: { stream?: StreamName; preload?: StreamName[]; health?: boolean } = {}) {
  const api = stubApi({ ...(options.stream ? { stream: options.stream } : {}), ...(options.health === false ? { health: false } : {}) })
  vi.stubGlobal('fetch', api.fetchMock)
  const library = new RunLibrary(null, streamRun, () => new Date('2026-11-14T10:00:00Z'), () => `test-run-${++counter}`)
  if (options.preload?.length) {
    library.importJson(
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs: options.preload.map((name) => recordFrom(name, `run-${name}`)) }),
    )
  }
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const session = new TerminalSession(null, () => new Date('2026-11-14T10:00:00'))
  const view = render(
    <PreferencesProvider storage={null}>
      <RunLibraryProvider library={library}>
        <TerminalSessionProvider session={session}>
          <RouterProvider router={router} />
        </TerminalSessionProvider>
      </RunLibraryProvider>
    </PreferencesProvider>,
  )
  return { ...view, library, router, user, api, session }
}

async function expectNoAxeViolations(container: HTMLElement) {
  // jsdom has no layout, so colour contrast is checked by tokens.test.ts instead.
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([])
}

describe('pre-run console', () => {
  it('shows only the console before a run, echoes each choice, then opens the world and trace', async () => {
    const { user } = setup('/')
    const log = await screen.findByRole('log', { name: 'Session console' })
    expect(screen.queryByRole('region', { name: 'Action trace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Harbor map/ })).not.toBeInTheDocument()
    expect(await within(log).findByText('catalog loaded from /openapi.json: 4 environments, 3 models')).toBeInTheDocument()
    expect(within(log).getByText('defaults: --model reference --env fixture')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Model / policy' }), 'stop-early')
    expect(within(log).getByText('model selected: stop-early # Stop-early baseline')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: /Environment/ }), 'open_canal')
    expect(within(log).getByText('environment selected: open_canal # Open canal')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Seed' }), '7')
    await user.tab()
    expect(within(log).getByText('seed set: 7')).toBeInTheDocument()
    await expectNoAxeViolations(document.body)

    await user.click(screen.getByRole('button', { name: /Start run/ }))
    expect(await screen.findByRole('region', { name: 'Action trace' })).toBeInTheDocument()
    expect(screen.queryByRole('log', { name: 'Session console' })).not.toBeInTheDocument()
  })

  it('keeps choices and the transcript when returning to the console, and logs the run outcome', async () => {
    const { user, router } = setup('/', { stream: 'fixture-stop-early' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model / policy' })).toBeEnabled())
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model / policy' }), 'stop-early')
    await user.click(screen.getByRole('button', { name: /Start run/ }))
    expect(await screen.findByText('0.075000')).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/')
    })
    const log = await screen.findByRole('log', { name: 'Session console' })
    expect(within(log).getByText('run --model stop-early --env fixture')).toBeInTheDocument()
    expect(within(log).getByText('run TEST-RUN started: streaming from POST /api/runs')).toBeInTheDocument()
    expect(
      within(log).getByText(/finished \(finished\): planner estimate 0\.075000, obligations incomplete$/),
    ).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model / policy' })).toHaveValue('stop-early')
  })

  it('logs a rejected seed', async () => {
    const { user } = setup('/')
    const log = await screen.findByRole('log', { name: 'Session console' })
    const environment = screen.getByRole('combobox', { name: /Environment/ })
    await waitFor(() => expect(environment).toBeEnabled())
    await user.selectOptions(environment, 'forecast_closure')
    await user.type(screen.getByRole('textbox', { name: 'Seed' }), 'abc')
    await user.tab()
    expect(within(log).getByText('seed rejected: Seed must be a whole number.')).toBeInTheDocument()
  })
})

describe('terminal', () => {
  it('starts a real-stream run, follows it live, and shows the planner estimate', async () => {
    const { user, router, api } = setup('/')
    const start = await screen.findByRole('button', { name: /Start run/ })
    await waitFor(() => expect(start).not.toHaveAttribute('aria-disabled'))
    await user.click(start)

    expect(router.state.location.pathname).toMatch(/^\/runs\/test-run-\d+$/)
    expect(await screen.findByText('0.850429')).toBeInTheDocument()
    expect(screen.getByText('All obligations met')).toBeInTheDocument()
    expect(screen.getByText(/not an independent verifier verdict/)).toBeInTheDocument()
    expect(api.calls.find((call) => call.url === '/api/runs')?.body).toEqual({ scenario: 'fixture', policy: 'reference' })

    const trace = screen.getByRole('region', { name: 'Action trace' })
    expect(within(trace).getAllByText('Commit')).toHaveLength(2)
    expect(within(trace).getByText('Finish')).toBeInTheDocument()
  })

  it('sends a chosen seed for generated scenarios and rejects an invalid one', async () => {
    const { user, api } = setup('/', { stream: 'reactive-closure-42-reference' })
    const environment = await screen.findByRole('combobox', { name: /Environment/ })
    await waitFor(() => expect(environment).toBeEnabled())
    await user.selectOptions(environment, 'reactive_closure')
    const seed = screen.getByRole('textbox', { name: 'Seed' })
    await user.type(seed, '12x')
    expect(seed).toHaveAccessibleDescription('Seed must be a whole number.')
    expect(screen.getByRole('button', { name: /Start run/ })).toHaveAttribute('aria-disabled', 'true')
    await user.clear(seed)
    await user.type(seed, '42')
    await user.click(screen.getByRole('button', { name: /Start run/ }))
    await waitFor(() => expect(api.calls.find((call) => call.url === '/api/runs')?.body).toEqual({ scenario: 'reactive_closure', policy: 'reference', seed: 42 }))
  })

  it('explains why Environment Dictation is unavailable', async () => {
    setup('/')
    const dictation = await screen.findByRole('button', { name: 'Environment Dictation' })
    expect(dictation).toHaveAttribute('aria-disabled', 'true')
    expect(dictation).toHaveAccessibleDescription(/scenario-draft and transcription API/)
  })

  it('replays a recorded run from the URL and moves with J and K', async () => {
    const { user, router } = setup('/runs/run-fixture-reference?step=3', { preload: ['fixture-reference'] })
    expect(await screen.findByText('World · after step 3')).toBeInTheDocument()
    expect(screen.getByText('Step 3 / 5')).toBeInTheDocument()
    expect(screen.getAllByText('Replay').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /cloth-east: 0 of 4 units on time, 4 in transit/ })).toBeInTheDocument()

    await user.keyboard('j')
    await waitFor(() => expect(router.state.location.search).toBe('?step=2'))
    await user.keyboard('k')
    await user.keyboard('k')
    await user.keyboard('k')
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.getByText('Latest step')).toBeInTheDocument()
  })

  it('opens the evidence drawer for a step and closes it with Escape', async () => {
    const { user, router } = setup('/runs/run-fixture-reference?step=3&evidence=3', { preload: ['fixture-reference'] })
    const drawer = await screen.findByRole('dialog', { name: 'Step 3 · Commit at round 2' })
    expect(within(drawer).getByText('What the policy could see')).toBeInTheDocument()
    expect(within(drawer).getByText('Dispatch barge-a via outer-canal · cloth-east ×4')).toBeInTheDocument()
    expect(within(drawer).getByText(/short-canal closed since r2/)).toBeInTheDocument()
    expect(within(drawer).getByText(/Not available\. Counterfactual repairs/)).toBeInTheDocument()
    await expectNoAxeViolations(document.body)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.search).toBe('?step=3')
  })

  it('filters the trace to a vessel clicked on the map', async () => {
    const { user } = setup('/runs/run-fixture-reference?step=3', { preload: ['fixture-reference'] })
    const vessel = await screen.findByRole('button', { name: /^Vessel barge-a, in transit/ })
    await user.click(vessel)
    expect(vessel).toHaveAttribute('aria-pressed', 'true')
    const trace = screen.getByRole('region', { name: 'Action trace' })
    expect(within(trace).getByText(/Showing vessel barge-a/)).toBeInTheDocument()
    expect(within(trace).queryByText('Notice published')).not.toBeInTheDocument()
    expect(within(trace).getByText('Voyage dispatched')).toBeInTheDocument()
  })

  it('shows an honest not-found state for a run this browser never recorded', async () => {
    setup('/runs/unknown-run')
    expect(await screen.findByText('This run is not in this browser')).toBeInTheDocument()
  })

  it('has no accessibility violations on a recorded run', async () => {
    const { container } = setup('/runs/run-fixture-stop-early', { preload: ['fixture-stop-early'] })
    expect(await screen.findByText('0.075000')).toBeInTheDocument()
    expect(screen.getByText('Obligations incomplete')).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('names the API as offline when health checks fail', async () => {
    setup('/', { health: false })
    expect(await screen.findByText(/The Runbook API is not answering/)).toBeInTheDocument()
  })
})

describe('runs, compare and capability views', () => {
  it('lists recorded runs with their planner estimates and deletes after confirmation', async () => {
    const { user, library } = setup('/runs', { preload: ['fixture-reference', 'fixture-stop-early'] })
    const table = await screen.findByRole('table', { name: /Runs recorded in this browser/ })
    expect(within(table).getByText('0.850429')).toBeInTheDocument()
    expect(within(table).getByText('0.075000')).toBeInTheDocument()
    await expectNoAxeViolations(document.body)

    await user.click(within(table).getAllByRole('button', { name: /^Delete run/ })[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(library.getSnapshot().records).toHaveLength(1))
  })

  it('imports an exported file', async () => {
    const { user, library } = setup('/runs')
    await screen.findByText('No runs yet')
    const file = new File(
      [JSON.stringify({ format: EXPORT_FORMAT, version: 1, runs: [recordFrom('fixture-idle', 'imported-run')] })],
      'runs.json',
      { type: 'application/json' },
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('missing file input')
    await act(async () => {
      await user.upload(input, file)
    })
    expect(await screen.findByText(/Imported 1 run/)).toBeInTheDocument()
    expect(library.get('imported-run')).toBeDefined()
  })

  it('compares two runs of one scenario and marks the first divergence', async () => {
    setup('/compare?a=run-fixture-stop-early&b=run-fixture-reference', { preload: ['fixture-reference', 'fixture-stop-early'] })
    expect(await screen.findByText('First divergence at round 1')).toBeInTheDocument()
    expect(screen.getByText('first divergence')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /Run (A|B) at round 1/ })).toHaveLength(2)
    await expectNoAxeViolations(document.body)
  })

  it('refuses to offer runs of a different scenario as run B', async () => {
    setup('/compare?a=run-fixture-reference', { preload: ['fixture-reference', 'open-canal-7-reference'] })
    const runB = await screen.findByLabelText(/Run B/)
    expect(within(runB).queryByText(/Open canal/)).not.toBeInTheDocument()
    expect(runB).toBeDisabled()
  })

  it('shows what the learning view needs instead of sample data', async () => {
    setup('/learning')
    expect(await screen.findByText('Not provided by this API yet')).toBeInTheDocument()
    expect(screen.getByText('GET /api/learning/checkpoints')).toBeInTheDocument()
  })
})
