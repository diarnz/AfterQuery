import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { ShortcutsDialog } from '../features/help/ShortcutsDialog'
import { RunOutcomeLogger } from '../features/terminal/RunOutcomeLogger'
import { useShortcuts } from '../lib/keyboard'
import { usePreferences } from '../state/preferences'
import { useLibrarySnapshot } from '../state/runLibraryContext'
import { Badge } from '../ui'
import { useApiHealth } from './useApiHealth'

const THEME_LABEL = { system: 'System theme', dark: 'Dark theme', parchment: 'Parchment theme' } as const

const NAV = [
  { to: '/', label: 'Terminal', end: true },
  { to: '/runs', label: 'Runs', end: true },
  { to: '/compare', label: 'Compare', end: false },
  { to: '/learning', label: 'Learning', end: false },
  { to: '/evaluations', label: 'Evaluations', end: false },
] as const

export function AppShell() {
  const preferences = usePreferences()
  const health = useApiHealth()
  const { live } = useLibrarySnapshot()
  const [help, setHelp] = useState(false)
  const { pathname } = useLocation()
  // A single run opens in the terminal, so /runs/:id belongs to Terminal, not to the Runs list.
  const onRunPage = /^\/runs\/[^/]+/.test(pathname)

  useShortcuts([
    { key: '?', handler: () => setHelp(true) },
    { key: 't', handler: preferences.cycleTheme },
    { key: 'p', handler: () => preferences.set('projector', !preferences.projector) },
  ])

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Renaissance Runbook, terminal home">
          <span className="brand-mark" aria-hidden="true">
            &gt;_
          </span>
          <span className="brand-name">Renaissance Runbook</span>
        </NavLink>
        <nav aria-label="Main" className="topnav">
          <ul>
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive || (item.to === '/' && onRunPage) ? 'active' : undefined)}
                  aria-current={item.to === '/' && onRunPage ? 'page' : undefined}
                >
                  {item.label}
                  {item.to === '/' && live.size > 0 && (
                    <span className="nav-live" aria-label="(a run is live)">
                      ●
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="topbar-tools">
          {health === 'online' ? (
            <Badge tone="ok" glyph="●" title="GET /api/health answered ok">
              API online
            </Badge>
          ) : health === 'offline' ? (
            <Badge tone="infra" glyph="⚠" title="GET /api/health failed. Start the API with make api.">
              API offline
            </Badge>
          ) : (
            <Badge tone="muted" glyph="◌">
              Checking API
            </Badge>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={preferences.cycleTheme} aria-keyshortcuts="T">
            {THEME_LABEL[preferences.theme]}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={preferences.projector}
            onClick={() => preferences.set('projector', !preferences.projector)}
            aria-keyshortcuts="P"
          >
            Projector
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHelp(true)} aria-keyshortcuts="Shift+/">
            Shortcuts <kbd className="kbd">?</kbd>
          </button>
        </div>
      </header>
      {health === 'offline' && (
        <div className="api-offline" role="alert">
          <span aria-hidden="true">⚠ </span>
          The Runbook API is not answering at <code>/api/health</code>. Start it with <code>make api</code>. Recorded runs remain viewable.
        </div>
      )}
      <main id="main" className="app-main" tabIndex={-1}>
        <Outlet />
      </main>
      {help && <ShortcutsDialog onClose={() => setHelp(false)} />}
      <RunOutcomeLogger />
    </div>
  )
}
