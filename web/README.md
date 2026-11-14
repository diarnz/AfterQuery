# Renaissance Runbook · Web terminal

This folder holds the React terminal for Renaissance Runbook and nothing else. All frontend code, assets, tests, tooling, and frontend docs live here. Python simulation, scoring, and the API stay in `runbook/` and are reached only through the API's published contracts.

- [Frontend blueprint](docs/FRONTEND_BLUEPRINT.md): design language, screens, architecture, data flow, testing, and what is implemented.
- [Engineering blueprint](../docs/BLUEPRINT.md): the parent specification. It wins on any conflict.

## Run it

Requires Node.js 22.12+ (the repo pins 24) and the Runbook API.

```sh
make api          # from the repo root, API on 127.0.0.1:8000
npm --prefix web ci
npm --prefix web run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/openapi.json` to the API. Set `RUNBOOK_API_URL` to point the proxy somewhere else.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 5173 |
| `npm run check` | Typecheck, lint (including layer rules), unit and integration tests, production build |
| `npm run test` | Vitest: contracts, streaming, run library, map geometry, full-app integration with axe |
| `npm run e2e` | Playwright in Chromium (desktop and phone) against the real API. It reuses running servers or starts them; set `RUNBOOK_API_COMMAND` if `uv` is not installed. Run `npx playwright install chromium` once first |
| `npm run fixtures:record` | Re-records the real API streams used as test fixtures (API must be running) |

## What works today

The API serves one endpoint for runs: `POST /api/runs` streams NDJSON frames (opening, one per decision, then a result). The terminal is built on exactly that.

- **Console:** before a run, the terminal is a session console. Every choice in the flags (`--model`, `--env`, `--seed`) is echoed as a command line, and each run's ending is logged. The world and action trace appear only once you start a run.
- **Terminal:** pick a policy and environment (read from the API's OpenAPI document), optional seed, start and stop runs, and watch them stream.
- **Harbor map:** an SVG chart of docks, routes, closures, scheduled notices, vessels at berth and in transit, stock and receipts. Click to filter the trace; every element is keyboard reachable.
- **Action trace:** decisions and world events grouped by round, with links to the map and evidence.
- **Replay:** step through any run with the scrubber or J/K. The position is in the URL, and every frame shown is the server's own snapshot.
- **Evidence drawer:** what the policy could see, the action as sent, what happened, and the rules in force.
- **Compare:** two runs of the same scenario, aligned by round, with the first divergence marked.
- **Runs:** runs are recorded in this browser (the API keeps no history), with export and import.
- **Results:** provisional obligations, plus the API's planner estimate. It is labelled as the planner's estimate, not a verifier verdict.

Learning, Evaluations, Environment Dictation and verifier verdicts show what the backend needs to add. They show no sample data. The full list is in the blueprint's Appendix B.

## Ground rules

1. The browser renders server state. It never simulates a round or computes a score.
2. Every displayed fact links to the frame it came from.
3. Live, replay, and recorded material is always labelled.
4. No provider keys in the browser.
5. Frontend changes stay inside `web/`.
