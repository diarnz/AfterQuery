import { useState } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router'
import type { RunLibrary } from '../state/runLibrary'
import { RunLibraryProvider } from '../state/runLibraryContext'
import { PreferencesProvider } from '../state/preferences'
import type { KeyValueStorage } from '../state/storage'
import { TerminalSession, TerminalSessionProvider } from '../state/terminalSession'
import { routes } from './routes'

export function App({
  library,
  storage,
  tabStorage,
}: {
  library: RunLibrary
  /** Long-lived storage: preferences. */
  storage: KeyValueStorage | null
  /** Per-tab storage: the console session. */
  tabStorage: KeyValueStorage | null
}) {
  const [router] = useState(() => createBrowserRouter(routes))
  const [session] = useState(() => new TerminalSession(tabStorage))
  return (
    <PreferencesProvider storage={storage}>
      <RunLibraryProvider library={library}>
        <TerminalSessionProvider session={session}>
          <RouterProvider router={router} />
        </TerminalSessionProvider>
      </RunLibraryProvider>
    </PreferencesProvider>
  )
}
