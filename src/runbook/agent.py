"""Agent loop: drives a provider through one Harbor episode and scores it."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

from .harbor import Episode
from .providers import MissingKey, Provider, ProviderError, extract_tool_call
from .verify import Verdict, verify

SYSTEM_PROMPT = """You are an operations agent in Harbor Master, a Renaissance canal-port simulation.
Goal: deliver every job's cargo to its destination dock by its due round, while spending as little as you can and arriving with slack.

World rules
- Time is in whole rounds, starting at round 0. Actions start at rounds 0..horizon-1. Arrivals settle when the clock reaches the arrival round. The horizon is inclusive.
- A vessel is either idle at a dock or in transit. In-transit vessels cannot be changed or redirected.
- A dispatch moves one idle vessel along a path of route edges (each edge used once, edges must be continuous from the vessel's dock). Arrival round = current round + sum of edge durations. Every edge must be open at the round the vessel enters it, and the vessel's draft must not exceed the edge's max_draft.
- Before dispatching, the vessel must hold a berth reservation at the destination dock for exactly that arrival round (reserve_berth). A vessel holds at most one reservation; release_berth first to change it. Each berth slot has capacity per dock-round; only slots listed in open_berth_slots exist. Operations in one batch are applied in order and each sees the effects of the earlier ones; one bad operation rejects the whole batch.
- Loads: a job's cargo can only be loaded at its source dock, from its loadable_from_round on, and delivered to its destination dock. Total load must not exceed the vessel capacity or the remaining units.
- Costs are the sum of edge costs of every dispatch, including empty moves. Notices announce changes; read them.
- commit and wait both advance the clock by exactly one round after applying. finish closes the episode immediately without advancing time. Only cargo already settled counts, and only if received by its due round.
- Rejected attempts do not move the clock but each consumes one of your limited mutation attempts. Reads (observe, inspect) have a separate allowance.

Reward: 0 if invariants are violated. If any job is incomplete or late: 0.15 x weighted fraction of on-time delivered units. If all jobs are complete on time: 0.70 + 0.30 x quality, where quality is 60% low spend (cap 20) and 40% slack before due rounds (cap 4).

Tools. Reply with exactly ONE JSON object per turn and nothing else:
{"tool": "observe"}
{"tool": "inspect", "kind": "route" | "dock" | "job", "ref": "<id>"}
{"tool": "commit", "expected_revision": <int>, "action_id": "<unique short string>", "operations": [ ... up to 4 ... ]}
{"tool": "wait", "expected_revision": <int>, "action_id": "<unique short string>"}
{"tool": "finish", "expected_revision": <int>, "action_id": "<unique short string>"}
Operations:
{"type": "reserve_berth", "vessel_id": "A", "dock_id": "east", "arrival_round": 4}
{"type": "release_berth", "vessel_id": "A"}
{"type": "dispatch", "vessel_id": "A", "route": ["edge-id", ...], "loads": [{"job_id": "cloth", "units": 4}]}
expected_revision must equal the revision in the latest observation. Error codes you may see: invalid_request, stale_revision, route_unavailable, resource_conflict, incompatible_inventory, idempotency_conflict, episode_closed, budget_exhausted.
Decide from the observation; plan ahead because earlier choices can make later deliveries impossible."""


@dataclass
class RunResult:
    provider: str
    model: str
    verdict: Verdict
    close_reason: str | None
    turns: int
    parse_errors: int
    provider_errors: int
    tool_calls: Counter
    rejections: Counter
    transcript: list[dict[str, Any]] = field(default_factory=list)
    ledger: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {
            "provider": self.provider, "model": self.model, "turns": self.turns,
            "close_reason": self.close_reason, "parse_errors": self.parse_errors,
            "provider_errors": self.provider_errors, "tool_calls": dict(self.tool_calls),
            "rejections": dict(self.rejections), "verdict": self.verdict.as_dict(), "notes": self.notes,
        }


def _dispatch_tool(ep: Episode, call: dict[str, Any]) -> dict[str, Any]:
    tool = call["tool"]
    if tool == "observe":
        return ep.observe()
    if tool == "inspect":
        return ep.inspect(call.get("kind"), call.get("ref"))
    if tool == "commit":
        return ep.commit(call.get("expected_revision"), call.get("action_id"), call.get("operations"))
    if tool == "wait":
        return ep.wait(call.get("expected_revision"), call.get("action_id"))
    if tool == "finish":
        return ep.finish(call.get("expected_revision"), call.get("action_id"))
    return {"status": "rejected", "code": "invalid_request",
            "message": "tool must be one of observe, inspect, commit, wait, finish"}


def run_episode(provider: Provider, max_turns: int = 40,
                log: Callable[[str], None] | None = None) -> RunResult:
    log = log or (lambda _: None)
    ep = Episode()
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "Episode started. Opening observation:\n" + json.dumps(ep.observation())},
    ]
    transcript: list[dict[str, Any]] = []
    tool_calls: Counter = Counter()
    rejections: Counter = Counter()
    parse_errors = provider_errors = turns = 0
    notes: list[str] = []

    while ep.status == "active" and turns < max_turns:
        turns += 1
        try:
            reply = provider.complete(messages)
        except MissingKey:
            raise
        except ProviderError as err:
            provider_errors += 1
            notes.append(f"turn {turns}: provider error: {err}")
            log(f"  turn {turns}: provider error: {err}")
            if provider_errors >= 3:
                break
            continue
        messages.append({"role": "assistant", "content": reply})
        call = extract_tool_call(reply)
        if call is None:
            parse_errors += 1
            feedback = {"status": "rejected", "code": "invalid_request",
                        "message": "reply must be a single JSON object with a 'tool' field"}
            transcript.append({"turn": turns, "reply": reply, "parsed": None, "result": feedback})
            messages.append({"role": "user", "content": json.dumps(feedback)})
            log(f"  turn {turns}: unparseable reply")
            continue
        result = _dispatch_tool(ep, call)
        tool_calls[call["tool"]] += 1
        if result.get("status") == "rejected":
            rejections[result.get("code", "unknown")] += 1
        transcript.append({"turn": turns, "reply": reply, "parsed": call, "result": result})
        log(f"  turn {turns}: {json.dumps(call)[:160]} -> {result.get('status')} {result.get('code', '')}")
        messages.append({"role": "user", "content": json.dumps(result)})

    if ep.status == "active":
        ep.external_close("timeout" if turns >= max_turns else "provider_failure")
        notes.append(f"episode closed externally: {ep.close_reason}")
    verdict = verify(ep.manifest, ep.ledger)
    return RunResult(provider=provider.name, model=provider.model, verdict=verdict,
                     close_reason=ep.close_reason, turns=turns, parse_errors=parse_errors,
                     provider_errors=provider_errors, tool_calls=tool_calls, rejections=rejections,
                     transcript=transcript, ledger=ep.ledger, notes=notes + diagnose(ep, verdict))


def diagnose(ep: Episode, verdict: Verdict) -> list[str]:
    """Plain-language failure labels derived from the ledger."""
    notes: list[str] = []
    if verdict.violations:
        notes.append("integrity failure: " + "; ".join(verdict.violations))
    dispatches = [e for e in ep.ledger if e["type"] == "move_dispatched"]
    grain_first = next((d for d in dispatches if any(l["job_id"] == "grain" for l in d["loads"])), None)
    if grain_first and grain_first["vessel"] == "A":
        notes.append("scarce-vessel error: small barge A (draft 1, only vessel allowed on the outer canal) "
                     "took the grain, leaving no vessel able to reach east on time once the short canal closes")
    for jid, job in {j["id"]: j for j in ep.manifest["jobs"]}.items():
        got = verdict.credited[jid]
        if got < job["units"]:
            late = [r for r, _ in verdict.receipt_rounds[jid] if r > job["due"]]
            if late:
                notes.append(f"{jid}: delivered late (round {min(late)} > due {job['due']})")
            elif sum(u for _, u in verdict.receipt_rounds[jid]) == 0:
                notes.append(f"{jid}: never delivered")
            else:
                notes.append(f"{jid}: only {got}/{job['units']} units on time")
    rejected = [e for e in ep.ledger if e["type"] == "commit_rejected"]
    if rejected:
        notes.append(f"{len(rejected)} rejected attempt(s): " + ", ".join(sorted({e['code'] for e in rejected})))
    if verdict.complete and verdict.reward < 0.85:
        notes.append("completed but below the reference score (spent more or arrived with less slack)")
    return notes
