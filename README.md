# AfterQuery · Renaissance Runbook

Renaissance Runbook is a proposed Junction 2026 agent evaluation and training platform. It runs agents through changing Renaissance operations, verifies outcomes from a simulation ledger, and uses verified corrections to train and evaluate a small Gemma policy.

[Read the engineering blueprint](docs/BLUEPRINT.md)

## Main stack

| Layer | Stack | Where to work |
|---|---|---|
| Simulation and reference | Python 3.12, immutable dataclasses, deterministic reducers | `runbook/harbor/` |
| API and run streaming | FastAPI, Pydantic, Uvicorn, streamed NDJSON for the local console | `runbook/api/` |
| Terminal | React 19, TypeScript, Vite, CSS | `web/` |
| Data infrastructure | PostgreSQL 17 and pgvector in Docker Compose | `compose.yaml`, `infra/postgres/` |
| Reproducibility | uv and npm lockfiles, Make, Ruff, unittest, GitHub Actions | Repository root, `tests/`, `.github/workflows/` |

The organizer's Harbor/OpenCode harness will use the Python MCP SDK over the simulator's public tools. Model integration and LoRA training are separate workstreams. The training stack is PyTorch, Transformers and PEFT in a separate GPU environment.

## Team setup

Install uv, Node.js 24 with npm, and Make. Docker with Compose is needed for Postgres.

```sh
uv python install
make setup
```

In separate terminals, run `make api` and `make web`. Open `http://127.0.0.1:5173`. Vite proxies `/api` to Uvicorn at `127.0.0.1:8000`. Use `Start run` to see the reference planner execute Harbor Master, or select a baseline and run the same fixture. Generated scenarios draw a fresh seed when you launch them from the terminal. API clients can send a specific integer seed.

```sh
make db       # optional for console development
make check    # tests, Python lint, TypeScript build, Compose config
make db-stop  # stop Postgres and keep the local volume
```

Postgres listens on `127.0.0.1:5433` by default and initializes the `vector` extension on a fresh volume. The local database and user are both `runbook`. The development password defaults to `runbook-local`. Override `RUNBOOK_DB_PORT` or `RUNBOOK_DB_PASSWORD` in a local `.env` if needed. Credentialed services and hosted deployment should use different settings.

### Local API contract

- `GET /api/health` returns service status. `http://127.0.0.1:8000/docs` serves the FastAPI schema.
- `POST /api/runs` accepts JSON such as `{"scenario":"reactive_closure","policy":"reference","seed":42}`. The response contains one JSON object per line in order. An `opening` frame carries the first public snapshot and scenario fingerprint. A `decision` frame carries a tool call and its real post-action snapshot and events. A terminal `complete` or `failed` frame reports the result.
- The local API runs a fresh episode per request and streams it directly to the console. Postgres is provisioned for the future event ledger and learning data. Durable run IDs and reconnectable streams, live provider models, and Environment Dictation are pending. The UI control for dictation is disabled.

## Run Harbor Master locally

Requires Python 3.12 or compatible. The simulator uses the Python standard library and needs no API keys.

```sh
python3.12 -m runbook.harbor
python3.12 -m runbook.harbor --seed 42 --family reactive_closure
python3.12 -m runbook.harbor --policy idle
python3.12 -m runbook.harbor --policy stop-early
python3.12 -m runbook.harbor --json > /tmp/harbor-trace.json
python3.12 -m unittest discover -s tests -v
```

The default exercise runs the hand-calculated Appendix G fixture. Available generated families are `forecast_closure`, `reactive_closure`, and `open_canal`. The CLI's `planner_score` is the reference policy's local evaluation. The independent judge verifier and live Harbor integration are separate workstreams.

### Integration handoff

- Call `scenarios.fixture()` for the shared fixture or `scenarios.generate(seed, family)` for a seeded scenario. Persist the realized manifest to replay, alongside the decisions in order.
- Call `engine.initialize(manifest)` to get the starting state and opening events. `wire.observe(manifest, state)` produces a public snapshot. `wire.inspect` serves `charter`, `route-map`, `arrival-calendar`, `current-orders`, or `notice-board`.
- Call `wire.apply_tool(manifest, state, tool, payload)` with `commit`, `wait`, or `finish`. All three accept `action_id` and `expected_revision`. A commit also accepts the ordered array of `reserve_berth`, `release_berth`, and `dispatch` operations. The returned state and events should be persisted atomically on acceptance. Session authorization, deduplication by action ID, and attempt budgets belong to the service that calls this module.
- The `--json` dump includes the **private realized manifest** for verifier and replay development. Use its `opening_observation`, `opening_events`, and public tool replies for UI fixtures. Model runners should receive only public observations, inspection documents, and tool replies.
- In a reduced-capacity berth, existing holds and booked voyages remain valid. The `slots[].capacity` field is the new capacity for admission, while `slots[].free` shows the number of slots available for a new booking.
