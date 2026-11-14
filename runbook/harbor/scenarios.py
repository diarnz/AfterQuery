"""Authored rule fixture and seeded Harbor Master scenario families."""

import hashlib
import json
import random
from dataclasses import asdict

from .model import Job, Lot, Manifest, Notice, Route, Slot, Vessel

FAMILIES = ("forecast_closure", "reactive_closure", "open_canal")


def _build(
    seed: int, family: str, closure_round: int, duration: int, cloth: int, grain: int,
    outer_cost: int, grain_cost: int, shallow_id: str,
) -> Manifest:
    due = closure_round + duration
    horizon = due + 2
    deep_id = "barge-b" if shallow_id == "barge-a" else "barge-a"
    release = closure_round if family == "reactive_closure" else 0
    north_slots = (1, 3, 5) if release == 0 else tuple(range(release + 1, horizon))
    east_slots = (due,) if family != "open_canal" else (closure_round + 1, due)
    notices = [Notice("east-extra-slot", "set_berth_capacity", closure_round, closure_round,
                      "east", 1, due + 1)]
    if family != "open_canal":
        published = 0 if family == "forecast_closure" else closure_round
        notices.append(Notice("short-canal-closure", "close_route", published,
                              closure_round, "short-canal"))
    return Manifest(
        family=family, seed=seed, horizon=horizon, docks=("east", "north", "west"),
        routes=(
            Route("short-canal", "west", "east", 1, 2, 2),
            Route("outer-canal", "west", "east", duration, outer_cost, 1),
            Route("north-out", "west", "north", 1, grain_cost, 2),
            Route("north-return", "north", "west", closure_round + 1, 2, 2),
        ),
        vessels=tuple(sorted(
            (Vessel(shallow_id, "west", max(cloth, grain), 1),
             Vessel(deep_id, "west", max(cloth, grain) + 1, 2)),
            key=lambda vessel: vessel.id,
        )),
        lots=(Lot("cloth", "west", cloth, closure_round), Lot("grain", "west", grain, release)),
        jobs=(Job("cloth-east", "cloth", "east", cloth, due),
              Job("grain-north", "grain", "north", grain, horizon - 1)),
        slots=tuple(Slot(dock, round_) for dock, rounds in (
            ("east", sorted(set(east_slots))), ("north", north_slots),
            ("west", (closure_round + 2, closure_round + 3)),
        ) for round_ in rounds if round_ <= horizon),
        notices=tuple(notices),
        cost_cap=20, slack_cap=4,
    )


def fixture() -> Manifest:
    """Appendix G, with a public forecast and a narrow departure window."""
    return _build(0, "forecast_closure", 2, 2, 4, 3, 6, 3, "barge-a")


def generate(seed: int, family: str = "forecast_closure") -> Manifest:
    if type(seed) is not int or family not in FAMILIES:
        raise ValueError("Expected an integer seed and a known Harbor Master family.")
    rng = random.Random(seed)
    return _build(
        seed, family, rng.choice((2, 3)), rng.choice((2, 3)),
        rng.randint(3, 6), rng.randint(2, 4), rng.randint(5, 8), rng.randint(2, 4),
        rng.choice(("barge-a", "barge-b")),
    )


def fingerprint(manifest: Manifest) -> str:
    payload = asdict(manifest)
    del payload["seed"]
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()
