"""Scripted control traces from Appendix G. Each step is (tool, args-without-revision)."""

from __future__ import annotations

from typing import Any

from .harbor import Episode
from .verify import Verdict, verify

Step = tuple[str, dict[str, Any]]


def reserve(vessel: str, dock: str, arrival: int) -> dict[str, Any]:
    return {"type": "reserve_berth", "vessel_id": vessel, "dock_id": dock, "arrival_round": arrival}


def dispatch(vessel: str, route: list[str], loads: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "dispatch", "vessel_id": vessel, "route": route, "loads": loads}


GRAIN = [{"job_id": "grain", "units": 3}]
CLOTH = [{"job_id": "cloth", "units": 4}]

CONTROLS: dict[str, list[Step]] = {
    "demonstration": [
        ("commit", {"operations": [reserve("B", "north", 1), dispatch("B", ["north-out"], GRAIN)]}),
        ("wait", {}),
        ("commit", {"operations": [reserve("A", "east", 4), dispatch("A", ["outer-canal"], CLOTH)]}),
        ("wait", {}),
        ("finish", {}),
    ],
    "a_takes_grain": [
        ("commit", {"operations": [reserve("A", "north", 1), dispatch("A", ["north-out"], GRAIN)]}),
        ("wait", {}),
        ("wait", {}),
        ("wait", {}),
        ("wait", {}),
        ("wait", {}),
    ],
    "b_on_outer_canal": [
        ("commit", {"operations": [reserve("A", "north", 1), dispatch("A", ["north-out"], GRAIN)]}),
        ("wait", {}),
        ("commit", {"operations": [reserve("B", "east", 4), dispatch("B", ["outer-canal"], CLOTH)]}),
        ("wait", {}),
        ("wait", {}),
        ("wait", {}),
    ],
    "late_outer_departure": [
        ("commit", {"operations": [reserve("B", "north", 1), dispatch("B", ["north-out"], GRAIN)]}),
        ("wait", {}),
        ("wait", {}),
        ("commit", {"operations": [reserve("A", "east", 5), dispatch("A", ["outer-canal"], CLOTH)]}),
        ("wait", {}),
        ("wait", {}),
    ],
    "stop_early": [
        ("commit", {"operations": [reserve("B", "north", 1), dispatch("B", ["north-out"], GRAIN)]}),
        ("finish", {}),
    ],
    "do_nothing": [("finish", {})],
}


def run_script(steps: list[Step]) -> tuple[Episode, Verdict]:
    ep = Episode()
    for i, (tool, args) in enumerate(steps):
        if ep.status != "active":
            break
        action_id = f"step-{i}"
        if tool == "commit":
            ep.commit(ep.revision, action_id, args["operations"])
        elif tool == "wait":
            ep.wait(ep.revision, action_id)
        else:
            ep.finish(ep.revision, action_id)
    if ep.status == "active":
        ep.external_close("script_end")
    return ep, verify(ep.manifest, ep.ledger)
