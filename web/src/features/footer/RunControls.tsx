import { useEffect, useId, useRef } from 'react'
import { useNavigate } from 'react-router'
import { FIXED_SCENARIOS, type RunCatalog } from '../../contracts/catalog'
import { useShortcuts } from '../../lib/keyboard'
import { shortRunId } from '../../state/runRecord'
import { useLibrarySnapshot, useRunLibrary } from '../../state/runLibraryContext'
import { useSessionSnapshot, useTerminalSession } from '../../state/terminalSession'
import { Button, Kbd } from '../../ui'
import { policyLabel, scenarioHint, scenarioLabel } from '../common/labels'
import { useRunCatalog } from '../common/useRunCatalog'

const DICTATION_REASON =
  'Environment Dictation needs a scenario-draft and transcription API (blueprint gaps G-07 and G-08). This backend does not provide it yet.'

export function parseSeed(text: string, catalog: RunCatalog): { seed: number | null; error: string | null } {
  const trimmed = text.trim()
  if (trimmed === '') return { seed: null, error: null }
  if (!/^\d+$/.test(trimmed)) return { seed: null, error: 'Seed must be a whole number.' }
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value < catalog.seedMin || value > catalog.seedMax) {
    return { seed: null, error: `Seed must be between ${catalog.seedMin} and ${catalog.seedMax}.` }
  }
  return { seed: value, error: null }
}

/** Visually a command-line flag; the accessible name stays a plain label. */
function FlagLabel({ htmlFor, flag, name }: { htmlFor: string; flag: string; name: string }) {
  return (
    <label htmlFor={htmlFor}>
      <span aria-hidden="true" className="flag">
        {flag}
      </span>
      <span className="sr-only">{name}</span>
    </label>
  )
}

/**
 * Footer control strip. Every decision is echoed to the session console as a
 * command line, and the choices live in the session so they survive navigation.
 */
export function RunControls({ viewedRunId }: { viewedRunId: string | undefined }) {
  const catalogState = useRunCatalog()
  const library = useRunLibrary()
  const snapshot = useLibrarySnapshot()
  const session = useTerminalSession()
  const { choices } = useSessionSnapshot()
  const navigate = useNavigate()
  const ids = { policy: useId(), scenario: useId(), seed: useId(), seedHelp: useId(), seedError: useId() }

  const catalog = catalogState.status === 'ready' ? catalogState.catalog : null
  // The user's choice wins when the catalog still offers it; otherwise the API's default applies.
  const policy = catalog ? (catalog.policies.includes(choices.policy) ? choices.policy : catalog.defaultPolicy) : ''
  const scenario = catalog ? (catalog.scenarios.includes(choices.scenario) ? choices.scenario : catalog.defaultScenario) : ''

  const liveId = [...snapshot.live][0]
  const seedApplies = scenario !== '' && !FIXED_SCENARIOS.has(scenario)
  const seed = catalog && seedApplies ? parseSeed(choices.seedText, catalog) : { seed: null, error: null }
  const committedSeed = useRef(choices.seedText)

  useEffect(() => {
    if (catalogState.status === 'ready') {
      const { catalog: ready } = catalogState
      session.logOnce(
        'catalog',
        'system',
        `catalog loaded from /openapi.json: ${ready.scenarios.length} environments, ${ready.policies.length} models`,
      )
      session.logOnce('defaults', 'muted', `defaults: --model ${ready.defaultPolicy} --env ${ready.defaultScenario}`)
    } else if (catalogState.status === 'error') {
      session.logOnce(`catalog-error:${catalogState.message}`, 'error', `catalog unavailable: ${catalogState.message}`)
    }
  }, [catalogState, session])

  const startReason =
    catalogState.status === 'loading'
      ? 'Loading scenarios and policies from the API.'
      : catalogState.status === 'error'
        ? 'The run catalog could not be loaded from the API.'
        : liveId
          ? 'A run is already streaming. Stop it or wait for it to finish.'
          : seed.error

  const commitSeed = () => {
    if (!catalog || !seedApplies || choices.seedText === committedSeed.current) return
    committedSeed.current = choices.seedText
    const parsed = parseSeed(choices.seedText, catalog)
    if (parsed.error) session.log('error', `seed rejected: ${parsed.error}`)
    else if (parsed.seed === null) session.log('input', 'seed cleared: the API will draw one')
    else session.log('input', `seed set: ${parsed.seed}`)
  }

  const start = () => {
    if (startReason !== null || !catalog) {
      if (startReason !== null) session.log('error', `cannot run: ${startReason}`)
      return
    }
    commitSeed()
    session.log('input', `run --model ${policy} --env ${scenario}${seed.seed !== null ? ` --seed ${seed.seed}` : ''}`)
    const id = library.start({ scenario, policy, seed: seed.seed })
    session.log('ok', `run ${shortRunId(id)} started: streaming from POST /api/runs`)
    navigate(`/runs/${id}`)
  }
  const stop = () => {
    if (!liveId) return
    session.log('input', `stop ${shortRunId(liveId)}`)
    library.stop(liveId)
  }

  useShortcuts([
    { key: 'Enter', ctrl: true, allowInFields: true, handler: start },
    { key: '.', ctrl: true, allowInFields: true, handler: stop },
  ])

  return (
    <footer className="run-controls" aria-label="Run controls">
      <div className="control">
        <FlagLabel htmlFor={ids.policy} flag="--model" name="Model / policy" />
        <select
          id={ids.policy}
          value={policy}
          disabled={!catalog}
          onChange={(event) => {
            const value = event.target.value
            session.choose({ policy: value })
            session.log('input', `model selected: ${value} # ${policyLabel(value)}`)
          }}
        >
          {!catalog && <option value="">{catalogState.status === 'error' ? 'Unavailable' : 'Loading…'}</option>}
          {catalog?.policies.map((id) => (
            <option key={id} value={id}>
              {policyLabel(id)}
            </option>
          ))}
        </select>
      </div>
      <div className="control">
        <FlagLabel htmlFor={ids.scenario} flag="--env" name="Environment · Harbor Master" />
        <select
          id={ids.scenario}
          value={scenario}
          disabled={!catalog}
          onChange={(event) => {
            const value = event.target.value
            session.choose({ scenario: value })
            session.log('input', `environment selected: ${value} # ${scenarioLabel(value)}`)
            if (FIXED_SCENARIOS.has(value)) session.log('muted', `--seed is ignored: ${value} is hand-computed`)
          }}
        >
          {!catalog && <option value="">{catalogState.status === 'error' ? 'Unavailable' : 'Loading…'}</option>}
          {catalog?.scenarios.map((id) => (
            <option key={id} value={id}>
              {scenarioLabel(id)}
            </option>
          ))}
        </select>
      </div>
      <div className="control control-seed">
        <FlagLabel htmlFor={ids.seed} flag="--seed" name="Seed" />
        <input
          id={ids.seed}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={seedApplies ? 'random' : 'not used'}
          value={seedApplies ? choices.seedText : ''}
          disabled={!catalog || !seedApplies}
          aria-invalid={seed.error ? true : undefined}
          aria-describedby={seed.error ? ids.seedError : ids.seedHelp}
          onChange={(event) => session.choose({ seedText: event.target.value })}
          onBlur={commitSeed}
        />
        <span id={ids.seedHelp} className="sr-only">
          {seedApplies ? 'Optional. Leave blank to let the API draw a random seed.' : 'This scenario is hand-computed and ignores the seed.'}
        </span>
        {seed.error && (
          <span id={ids.seedError} className="field-error">
            {seed.error}
          </span>
        )}
      </div>
      <p className="control-hint muted">
        {catalogState.status === 'error' ? (
          <>
            <span className="tone-infra">⚠ {catalogState.message}</span>{' '}
            <button type="button" className="link-button" onClick={catalogState.retry}>
              Retry
            </button>
          </>
        ) : (
          <># {scenarioHint(scenario) ?? 'Choose a model and an environment, then run.'}</>
        )}
      </p>
      <div className="control-buttons">
        <Button disabledReason={DICTATION_REASON}>Environment Dictation</Button>
        {liveId ? (
          <Button variant="danger" onClick={stop} aria-keyshortcuts="Control+.">
            ■ Stop {liveId === viewedRunId ? 'run' : 'live run'} <Kbd>Ctrl .</Kbd>
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabledReason={startReason} aria-keyshortcuts="Control+Enter">
            Start run <Kbd>Ctrl ↵</Kbd>
          </Button>
        )}
      </div>
    </footer>
  )
}
