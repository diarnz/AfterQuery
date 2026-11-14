import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useShortcuts } from '../../lib/keyboard'
import { usePreferences } from '../../state/preferences'
import { useRun } from '../../state/runLibraryContext'
import { SelectionProvider } from '../../state/selection'
import { buildTimeline, resolveCursor } from '../../state/timeline'
import { Banner, EmptyState, Panel } from '../../ui'
import { useStepParams } from '../common/useStepParams'
import { EvidenceDrawer } from '../evidence/EvidenceDrawer'
import { RunControls } from '../footer/RunControls'
import { ReplayBar } from '../replay/ReplayBar'
import { ResultsTray } from '../results/ResultsTray'
import { TracePane } from '../trace/TracePane'
import { WorldPane } from '../world-pane/WorldPane'
import { RunHeader } from './RunHeader'
import { SetupConsole } from './SetupConsole'
import { TraceResizer } from './TraceResizer'

export function TerminalPage() {
  return (
    <SelectionProvider>
      <Terminal />
    </SelectionProvider>
  )
}

function Terminal() {
  const { runId } = useParams()
  const { record, live } = useRun(runId)
  const { traceWidth, resultsCollapsed, set } = usePreferences()
  const { step: requested, evidence, setStep, openEvidence, closeEvidence } = useStepParams()
  const navigate = useNavigate()
  // Playback belongs to one run: switching runs starts paused.
  const [playback, setPlayback] = useState<{ runId: string | undefined; on: boolean }>({ runId: undefined, on: false })
  const playing = playback.on && playback.runId === runId
  const setPlaying = useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      setPlayback((current) => {
        const was = current.on && current.runId === runId
        return { runId, on: typeof value === 'function' ? value(was) : value }
      }),
    [runId],
  )

  const steps = useMemo(() => (record ? buildTimeline(record) : []), [record])
  const cursor = resolveCursor(steps, requested)
  const following = requested === null || requested >= steps.length - 1
  const step = steps[cursor]
  const evidenceStep = evidence !== null ? steps[evidence] : undefined

  const evidenceTarget = step?.decision ? step.index : steps.findLast((item) => item.decision && item.index <= cursor)?.index
  const evidenceReason = steps.length === 0 ? 'No steps yet.' : null
  const openCurrentEvidence = useCallback(() => {
    if (step) openEvidence(evidenceTarget ?? step.index)
  }, [step, evidenceTarget, openEvidence])

  const goTo = useCallback((index: number | null) => setStep(index), [setStep])

  useShortcuts(
    [
      { key: 'j', handler: () => steps.length && goTo(Math.max(cursor - 1, 0)) },
      { key: 'k', handler: () => steps.length && goTo(cursor + 1 >= steps.length - 1 ? null : cursor + 1) },
      { key: 'Home', handler: () => steps.length && goTo(0) },
      { key: 'End', handler: () => goTo(null) },
      { key: ' ', handler: () => steps.length > 1 && setPlaying((value) => !value), skipOnControls: true },
      { key: 'e', handler: () => steps.length && openCurrentEvidence() },
      { key: 'r', handler: () => record && set('resultsCollapsed', !resultsCollapsed) },
    ],
    true,
  )

  if (runId && !record) {
    return (
      <div className="terminal terminal-empty">
        <Panel title="Run not found">
          <EmptyState title="This run is not in this browser" action={<Link to="/runs">Open run history</Link>}>
            <p>
              Runs exist only where they were recorded: the API streams each run once and keeps no history. Import an exported run file
              from Runs to view it here.
            </p>
          </EmptyState>
        </Panel>
        <RunControls viewedRunId={undefined} />
      </div>
    )
  }

  // Before a run there is only the console: the world and the trace open once a run starts.
  if (!record) {
    return (
      <div className="terminal terminal-idle">
        <SetupConsole />
        <RunControls viewedRunId={undefined} />
      </div>
    )
  }

  const style = { '--trace-width': `${traceWidth}px` } as CSSProperties
  return (
    <div className="terminal" style={style}>
      <RunHeader record={record} observation={step?.observation ?? null} following={following} />

      <div className="terminal-main">
        {step ? (
          <WorldPane
            observation={step.observation}
            stepIndex={step.index}
            title={`World · ${step.kind === 'opening' ? 'opening' : `after step ${step.index}`}`}
          />
        ) : (
          <Panel title="World" className="world-pane">
            {record.outcome ? (
              <Banner tone="infra" title="This run has no opening snapshot">
                The stream ended before the API sent its first frame.
              </Banner>
            ) : (
              <EmptyState title="Waiting for the opening snapshot">
                <p>The API is materializing the scenario.</p>
              </EmptyState>
            )}
          </Panel>
        )}
        <TraceResizer />
        <TracePane
          steps={steps}
          cursor={cursor}
          live={live}
          following={following}
          onSelectStep={(index) => goTo(index >= steps.length - 1 ? null : index)}
          onOpenEvidence={openEvidence}
        />
      </div>

      {steps.length > 0 && (
        <ReplayBar
          steps={steps}
          cursor={cursor}
          following={following}
          live={live}
          playing={playing}
          onPlayingChange={setPlaying}
          onChange={goTo}
        />
      )}

      {step && (
        <ResultsTray
          record={record}
          observation={step.observation}
          atLatest={following}
          onCompare={() => navigate(`/compare?a=${encodeURIComponent(record.id)}`)}
          onEvidence={openCurrentEvidence}
          evidenceDisabledReason={evidenceReason}
        />
      )}
      {record.outcome?.kind === 'error' && !step && (
        <Banner tone="infra" title={`Run error · ${record.outcome.error.code}`}>
          {record.outcome.error.message}
        </Banner>
      )}

      <RunControls viewedRunId={runId} />

      {evidenceStep && <EvidenceDrawer record={record} step={evidenceStep} onClose={closeEvidence} />}
    </div>
  )
}
