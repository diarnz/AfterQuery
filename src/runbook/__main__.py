"""CLI: python -m runbook {controls,models,play}"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .agent import run_episode
from .controls import CONTROLS, run_script
from .providers import PROVIDERS, MissingKey, ProviderError, list_models

REFERENCE = 5953 / 7000


def cmd_controls(_: argparse.Namespace) -> int:
    print(f"{'control':<24}{'reward':>10}  complete  close")
    for name, steps in CONTROLS.items():
        ep, v = run_script(steps)
        print(f"{name:<24}{float(v.reward):>10.6f}  {str(v.complete):<8}  {ep.close_reason}")
    return 0


def cmd_models(_: argparse.Namespace) -> int:
    print(json.dumps(list_models(), indent=2))
    return 0


def cmd_play(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for name in args.targets:
        for trial in range(args.trials):
            provider = PROVIDERS[name](model=args.model) if args.model and len(args.targets) == 1 else PROVIDERS[name]()
            print(f"[{name}] model={provider.model} trial {trial + 1}/{args.trials}")
            try:
                result = run_episode(provider, max_turns=args.max_turns, log=print)
            except MissingKey as err:
                print(f"  skipped: {err}")
                rows.append({"provider": name, "skipped": str(err)})
                break
            summary = result.summary()
            if result.close_reason == "provider_failure":
                summary["infra_error"] = True
            rows.append(summary)
            path = out_dir / f"{name}-{int(time.time())}-{trial}.json"
            path.write_text(json.dumps({"summary": summary, "transcript": result.transcript,
                                        "ledger": result.ledger}, indent=2, default=str))
            v = result.verdict
            if summary.get("infra_error"):
                print("  infrastructure error (provider failed); not a scored result")
                print(f"  trace: {path}")
                continue
            print(f"  reward={float(v.reward):.4f} (reference {REFERENCE:.4f}) complete={v.complete} "
                  f"close={result.close_reason} parse_errors={result.parse_errors}")
            for note in result.notes:
                print(f"  - {note}")
            print(f"  trace: {path}")
    scored = [r for r in rows if "verdict" in r and not r.get("infra_error")]
    if scored:
        print("\nsummary")
        for r in scored:
            print(f"  {r['provider']:<9} reward={r['verdict']['reward']:.4f} gap={REFERENCE - r['verdict']['reward']:+.4f} "
                  f"complete={r['verdict']['complete']}")
    return 0 if scored else 2


def main() -> int:
    parser = argparse.ArgumentParser(prog="runbook")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("controls", help="score scripted control traces offline").set_defaults(fn=cmd_controls)
    sub.add_parser("models", help="list reachable Nemotron/Gemini model ids").set_defaults(fn=cmd_models)
    play = sub.add_parser("play", help="run models through the Harbor fixture")
    play.add_argument("targets", nargs="+", choices=sorted(PROVIDERS))
    play.add_argument("--trials", type=int, default=3)
    play.add_argument("--model", help="override model id (single target only)")
    play.add_argument("--max-turns", type=int, default=40)
    play.add_argument("--out", default="artifacts/runs")
    play.set_defaults(fn=cmd_play)
    args = parser.parse_args()
    try:
        return args.fn(args)
    except ProviderError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
