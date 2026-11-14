"""Exercise Harbor Master without a web server or provider credentials."""

import argparse
import json
from dataclasses import asdict

from .engine import initialize
from .model import Decision
from .policy import choose, estimate, progress, public_position
from .scenarios import FAMILIES, fingerprint, fixture, generate
from .wire import apply_tool, decision_payload, observe


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, help="Generate a scenario instead of using the rule fixture.")
    parser.add_argument("--family", choices=FAMILIES, default="forecast_closure")
    parser.add_argument("--policy", choices=("reference", "idle", "stop-early"), default="reference")
    parser.add_argument("--json", action="store_true", help="Include manifest and public trace.")
    args = parser.parse_args()
    if args.seed is None and args.family != "forecast_closure":
        parser.error("--family requires --seed")

    manifest = fixture() if args.seed is None else generate(args.seed, args.family)
    state, opening_events = initialize(manifest)
    opening = observe(manifest, state)
    trace = []
    while state.terminal_reason is None:
        if args.policy == "idle" or (args.policy == "stop-early" and trace):
            decision = Decision("finish")
        else:
            decision = choose(public_position(manifest, state))
        payload = decision_payload(decision, state.revision, f"step-{len(trace) + 1}")
        state, response = apply_tool(manifest, state, decision.tool, payload)
        if not response["accepted"]:
            raise RuntimeError(f"Reference selected a rejected action: {response['error']}")
        trace.append({"tool": decision.tool, "request": payload, "response": response})

    position = public_position(manifest, state)
    summary = {
        "scenario_hash": fingerprint(manifest),
        "family": manifest.family,
        "policy": args.policy,
        "complete": progress(position) == 1,
        "planner_score": float(estimate(position)),
        "round": state.round,
        "spent": state.spent,
        "receipts": [asdict(receipt) for receipt in state.receipts],
        "terminal_reason": state.terminal_reason,
    }
    if args.json:
        summary.update({
            "manifest": asdict(manifest),
            "opening_observation": opening,
            "opening_events": [asdict(event) for event in opening_events],
            "trace": trace,
        })
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
