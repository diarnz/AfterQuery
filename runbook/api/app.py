"""Local API for the terminal. Harbor's domain layer stays transport independent."""

import json
from collections.abc import Iterator
from dataclasses import asdict
from secrets import randbelow
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from runbook.harbor.engine import initialize
from runbook.harbor.model import Decision, Manifest
from runbook.harbor.policy import choose, estimate, progress, public_position
from runbook.harbor.scenarios import fingerprint, fixture, generate
from runbook.harbor.wire import apply_tool, decision_payload, observe

app = FastAPI(title="Renaissance Runbook", version="0.1.0")

Scenario = Literal["fixture", "forecast_closure", "reactive_closure", "open_canal"]
Policy = Literal["reference", "idle", "stop-early"]


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario: Scenario = "fixture"
    policy: Policy = "reference"
    seed: int | None = Field(default=None, strict=True, ge=0, le=2**32 - 1)


def run_events(manifest: Manifest, policy: Policy, scenario: Scenario) -> Iterator[dict]:
    state, opening_events = initialize(manifest)
    yield {
        "type": "opening",
        "scenario": scenario,
        "scenario_hash": fingerprint(manifest),
        "seed": manifest.seed if scenario != "fixture" else None,
        "observation": observe(manifest, state),
        "events": [asdict(event) for event in opening_events],
    }
    steps = 0
    while state.terminal_reason is None:
        if policy == "idle" or (policy == "stop-early" and steps):
            decision = Decision("finish")
        else:
            decision = choose(public_position(manifest, state))
        payload = decision_payload(decision, state.revision, f"step-{steps + 1}")
        state, response = apply_tool(manifest, state, decision.tool, payload)
        if not response["accepted"]:
            yield {"type": "failed", "error": response["error"]}
            return
        yield {"type": "decision", "tool": decision.tool, "request": payload, "response": response}
        steps += 1

    position = public_position(manifest, state)
    yield {
        "type": "complete",
        "result": {
            "planner_score": float(estimate(position)),
            "complete": progress(position) == 1,
            "reason": state.terminal_reason,
        },
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/runs", response_class=StreamingResponse)
def start_run(request: RunRequest) -> StreamingResponse:
    if request.scenario == "fixture":
        manifest = fixture()
    else:
        seed = request.seed if request.seed is not None else randbelow(2**32)
        manifest = generate(seed, request.scenario)
    return StreamingResponse(
        (json.dumps(event) + "\n" for event in run_events(manifest, request.policy, request.scenario)),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store"},
    )
