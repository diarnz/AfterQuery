"""Independent verifier.

Consumes only the materialized manifest and the frozen ledger. It re-derives
arrivals, cost and receipts from accepted dispatch operations using its own
physics, so it does not call the live engine's reward logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any


@dataclass
class Verdict:
    reward: Fraction
    progress: Fraction
    quality: Fraction | None
    complete: bool
    integrity_ok: bool
    cost: int
    close_reason: str | None
    credited: dict[str, int]
    receipt_rounds: dict[str, list[tuple[int, int]]]
    violations: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "reward": float(self.reward), "reward_exact": str(self.reward),
            "progress": str(self.progress),
            "quality": None if self.quality is None else str(self.quality),
            "complete": self.complete, "integrity_ok": self.integrity_ok, "cost": self.cost,
            "close_reason": self.close_reason, "credited_units": self.credited,
            "violations": self.violations,
        }


def _clamp01(x: Fraction) -> Fraction:
    return max(Fraction(0), min(Fraction(1), x))


def verify(manifest: dict[str, Any], ledger: list[dict[str, Any]]) -> Verdict:
    horizon = manifest["horizon"]
    edges = {e["id"]: e for e in manifest["edges"]}
    vessels = {v["id"]: v for v in manifest["vessels"]}
    jobs = {j["id"]: j for j in manifest["jobs"]}
    slots = {(s["dock"], s["round"]): s for s in manifest["slots"]}

    closed = next((e for e in reversed(ledger) if e["type"] == "closed"), None)
    violations: list[str] = []
    if closed is None:
        raise ValueError("ledger has no closed event; cannot verify an open episode")
    close_round = closed["round"]

    location = {vid: v["dock"] for vid, v in vessels.items()}
    busy_until = {vid: -1 for vid in vessels}
    stock = {jid: j["units"] for jid, j in jobs.items()}
    committed = {jid: 0 for jid in jobs}
    slot_use: dict[tuple[str, int], int] = {}
    moves: list[dict[str, Any]] = []
    cost = 0

    ops_by_round: list[tuple[int, list[dict[str, Any]]]] = [
        (e["round"], e["operations"]) for e in ledger if e["type"] == "commit_accepted"
    ]
    for round_, operations in ops_by_round:
        for vid in vessels:
            if busy_until[vid] != -1 and busy_until[vid] <= round_:
                busy_until[vid] = -1
        for op in operations:
            if op.get("type") != "dispatch":
                continue
            vid = op["vessel_id"]
            spec = vessels[vid]
            if busy_until[vid] != -1:
                violations.append(f"{vid} dispatched at {round_} while in transit")
                continue
            here, entry, leg_cost = location[vid], round_, 0
            ok = True
            for edge_id in op["route"]:
                edge = edges[edge_id]
                if (edge["from"] != here or spec["draft"] > edge["max_draft"]
                        or (edge["closed_from"] is not None and entry >= edge["closed_from"])):
                    violations.append(f"{vid} used unavailable edge {edge_id} at {entry}")
                    ok = False
                    break
                leg_cost += edge["cost"]
                entry += edge["duration"]
                here = edge["to"]
            if not ok:
                continue
            if entry > horizon:
                violations.append(f"{vid} arrives after horizon")
                continue
            slot = slots.get((here, entry))
            if slot is None or slot["opens"] > round_:
                violations.append(f"{vid} arrival slot {here}/{entry} did not exist at {round_}")
                continue
            slot_use[(here, entry)] = slot_use.get((here, entry), 0) + 1
            if slot_use[(here, entry)] > slot["capacity"]:
                violations.append(f"slot {here}/{entry} over capacity")
            total = 0
            for load in op.get("loads", []):
                job = jobs[load["job_id"]]
                units = load["units"]
                total += units
                if (job["source"] != location[vid] or job["dest"] != here or round_ < job["loadable_from"]
                        or units > stock[job["id"]] or committed[job["id"]] + units > job["units"]):
                    violations.append(f"{vid} illegal load of {job['id']} at {round_}")
                stock[job["id"]] -= units
                committed[job["id"]] += units
            if total > spec["capacity"]:
                violations.append(f"{vid} over capacity at {round_}")
            cost += leg_cost
            busy_until[vid] = entry
            moves.append({"vessel": vid, "dest": here, "arrive": entry, "loads": op.get("loads", [])})
            location[vid] = here

    receipt_rounds: dict[str, list[tuple[int, int]]] = {jid: [] for jid in jobs}
    for move in moves:
        if move["arrive"] <= close_round:
            for load in move["loads"]:
                receipt_rounds[load["job_id"]].append((move["arrive"], load["units"]))

    claimed = sorted((e["job_id"], e["round"], e["units"]) for e in ledger if e["type"] == "receipt")
    derived = sorted((jid, r, u) for jid, rows in receipt_rounds.items() for r, u in rows)
    if claimed != derived:
        violations.append(f"engine receipts {claimed} differ from verifier receipts {derived}")
    engine_spend = sum(e["cost"] for e in ledger if e["type"] == "move_dispatched")
    if engine_spend != cost:
        violations.append(f"engine spend {engine_spend} differs from verifier spend {cost}")

    credited: dict[str, int] = {}
    for jid, job in jobs.items():
        on_time = sum(u for r, u in receipt_rounds[jid] if r <= job["due"])
        credited[jid] = min(on_time, job["units"])

    weight_total = sum(Fraction(j["weight"]) for j in jobs.values())
    progress = sum(Fraction(j["weight"] * credited[jid], j["units"]) for jid, j in jobs.items()) / weight_total
    complete = all(credited[jid] >= j["units"] for jid, j in jobs.items())

    quality: Fraction | None = None
    if violations:
        reward = Fraction(0)
    elif not complete:
        reward = Fraction(15, 100) * progress
    else:
        cost_q = _clamp01(1 - Fraction(cost, manifest["cost_cap"]))
        weighted, units_total = Fraction(0), 0
        for jid, job in jobs.items():
            budget = job["units"]
            for r, u in sorted(receipt_rounds[jid]):
                if r > job["due"] or budget == 0:
                    continue
                take = min(u, budget)
                budget -= take
                weighted += take * _clamp01(Fraction(job["due"] - r, manifest["slack_cap"]))
                units_total += take
        slack_q = weighted / units_total if units_total else Fraction(0)
        quality = Fraction(6, 10) * cost_q + Fraction(4, 10) * slack_q
        reward = Fraction(70, 100) + Fraction(30, 100) * quality

    return Verdict(reward=reward, progress=progress, quality=quality, complete=complete,
                   integrity_ok=not violations, cost=cost, close_reason=closed.get("reason"),
                   credited=credited, receipt_rounds=receipt_rounds, violations=violations)
