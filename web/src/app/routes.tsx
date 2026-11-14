import { Link, isRouteErrorResponse, useRouteError, type RouteObject } from 'react-router'
import { TerminalPage } from '../features/terminal/TerminalPage'
import { EmptyState, Panel } from '../ui'
import { AppShell } from './AppShell'

function NotFound() {
  return (
    <div className="page">
      <Panel title="Page not found">
        <EmptyState title="Nothing lives at this address" action={<Link to="/">Go to the terminal</Link>} />
      </Panel>
    </div>
  )
}

function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'
  return (
    <div className="page" role="alert">
      <Panel title="Something went wrong">
        <EmptyState title="This view crashed" action={<a href="/">Reload the terminal</a>}>
          <p className="mono">{message}</p>
          <p>Recorded runs are kept in this browser and are not affected.</p>
        </EmptyState>
      </Panel>
    </div>
  )
}

/** Secondary views load lazily; the terminal ships in the main bundle. */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <TerminalPage /> },
          { path: 'runs/:runId', element: <TerminalPage /> },
          { path: 'runs', lazy: async () => ({ Component: (await import('../features/runs-history/RunsPage')).RunsPage }) },
          { path: 'compare', lazy: async () => ({ Component: (await import('../features/compare/ComparePage')).ComparePage }) },
          {
            path: 'learning',
            lazy: async () => {
              const { CapabilityPage } = await import('../features/capability/CapabilityPage')
              return { Component: () => <CapabilityPage area="learning" /> }
            },
          },
          {
            path: 'evaluations',
            lazy: async () => {
              const { CapabilityPage } = await import('../features/capability/CapabilityPage')
              return { Component: () => <CapabilityPage area="evaluations" /> }
            },
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]
