import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against the real Runbook API and the Vite dev server.
 * Already-running servers are reused (`make api` and `make web`); otherwise both are started.
 * RUNBOOK_API_COMMAND overrides how the API starts (default: uv, as in the Makefile).
 */
const apiCommand =
  process.env.RUNBOOK_API_COMMAND ?? 'uv run --locked uvicorn runbook.api.app:app --host 127.0.0.1 --port 8000'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: apiCommand,
      cwd: '..',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
