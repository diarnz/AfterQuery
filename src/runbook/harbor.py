"""Pure Harbor Master episode engine for the Appendix G fixture.

No network, database or model imports. The engine exposes the five MCP-style
tools (observe, inspect, commit, wait, finish) as plain methods.
"""

from __future__ import annotations

import copy
import json
from typing import Any

MANIFEST: dict[str, Any] = {
    "scenario_id": "harbor-appendix-g-v1",
    "horizon": 6,
    "docks": ["west", "east", "north"],
    "slots": [
        {"dock": "north", "round": 1, "capacity": 1, "opens": 0},
        {"dock": "north", "round": 3, "capacity": 1, "opens": 0},
        {"dock": "north", "round": 5, "capacity": 1, "opens": 0},
        {"dock": "east", "round": 4, "capacity": 1, "opens": 0},
        {"dock": "east", "round": 5, "capacity": 1, "opens": 2},
        {"dock": "west", "round": 4, "capacity": 1, "opens": 0},
        {"dock": "west", "round": 5, "capacity": 1, "opens": 0},
    ],
    "vessels": [
        {"id": "A", "dock": "west", "capacity": 4, "draft": 1},
        {"id": "B", "dock": "west", "capacity": 5, "draft": 2},
    ],
    "jobs": [
        {"id": "cloth", "source": "west", "dest": "east", "units": 4, "due": 4, "weight": 1, "loadable_from": 2},
        {"id": "grain", "source": "west", "dest": "north", "units": 3, "due": 5, "weight": 1, "loadable_from": 0},
    ],
    "edges": [
        {"id": "short-canal", "from": "west", "to": "east", "duration": 1, "cost": 2, "max_draft": 2,
         "closed_from": 2, "announce_round": 0},
        {"id": "outer-canal", "from": "west", "to": "east", "duration": 2, "cost": 6, "max_draft": 1,
         "closed_from": None, "announce_round": 0},
        {"id": "north-out", "from": "west", "to": "north", "duration": 1, "cost": 3, "max_draft": 2,
         "closed_from": None, "announce_round": 0},
        {"id": "north-return", "from": "north", "to": "west", "duration": 3, "cost": 2, "max_draft": 2,
         "closed_from": None, "announce_round": 0},
    ],
    "notices": [
        {"round": 0, "text": "Short canal is scheduled to close at the beginning of round 2. "
                             "Round 1 is the last round a vessel can enter it."},
        {"round": 2, "text": "Short canal is now closed. A spare berth slot east/5 is now open."},
    ],
    "cost_cap": 20,
    "slack_cap": 4,
    "budgets": {"max_batch": 4, "max_reads": 24, "max_attempts": 12, "max_path": 3},
}

ERROR_CODES = (
    "invalid_request",
    "stale_revision",
    "route_unavailable",
    "resource_conflict",
    "incompatible_inventory",
    "idempotency_conflict",
    "episode_closed",
    "budget_exhausted",
)


class EngineError(Exception):
    def __init__(self, code: str, message: str, op_index: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.op_index = op_index


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


class Episode:
    def __init__(self, manifest: dict[str, Any] | None = None):
        self.manifest = copy.deepcopy(manifest or MANIFEST)
        m = self.manifest
        self.horizon: int = m["horizon"]
        self.round = 0
        self.revision = 0
        self.status = "active"
        self.close_reason: str | None = None
        self.vessels = {
            v["id"]: {"dock": v["dock"], "move": None} for v in m["vessels"]
        }
        self.stock = {j["id"]: j["units"] for j in m["jobs"]}
        self.committed = {j["id"]: 0 for j in m["jobs"]}
        self.delivered = {j["id"]: 0 for j in m["jobs"]}
        self.reservations: dict[str, dict[str, Any]] = {}
        self.moves: list[dict[str, Any]] = []
        self.receipts: list[dict[str, Any]] = []
        self.spend = 0
        self.ledger: list[dict[str, Any]] = []
        self.reads = 0
        self.attempts = 0
        self._accepted: dict[str, tuple[str, dict[str, Any]]] = {}
        self._event("episode_started", scenario_id=m["scenario_id"])
        self._event("notice", text=m["notices"][0]["text"], effective_round=0)

    # ------------------------------------------------------------------ utils
    def _event(self, type_: str, **fields: Any) -> dict[str, Any]:
        event = {"seq": len(self.ledger), "type": type_, "round": self.round,
                 "revision": self.revision, **fields}
        self.ledger.append(event)
        return event

    def _job(self, job_id: str) -> dict[str, Any] | None:
        return next((j for j in self.manifest["jobs"] if j["id"] == job_id), None)

    def _edge(self, edge_id: str) -> dict[str, Any] | None:
        return next((e for e in self.manifest["edges"] if e["id"] == edge_id), None)

    def _vessel_spec(self, vessel_id: str) -> dict[str, Any] | None:
        return next((v for v in self.manifest["vessels"] if v["id"] == vessel_id), None)

    @staticmethod
    def edge_open_at(edge: dict[str, Any], round_: int) -> bool:
        closed_from = edge.get("closed_from")
        return closed_from is None or round_ < closed_from

    def _slot_claims(self, reservations: dict[str, dict[str, Any]], dock: str, round_: int) -> int:
        return sum(1 for r in reservations.values() if r["dock"] == dock and r["round"] == round_)

    def _slot(self, dock: str, round_: int, at_round: int) -> dict[str, Any] | None:
        for s in self.manifest["slots"]:
            if s["dock"] == dock and s["round"] == round_ and s["opens"] <= at_round:
                return s
        return None

    # ------------------------------------------------------------ observation
    def observation(self) -> dict[str, Any]:
        m = self.manifest
        edges = []
        for e in m["edges"]:
            view = {
                "id": e["id"], "from": e["from"], "to": e["to"], "duration": e["duration"],
                "cost": e["cost"], "max_draft": e["max_draft"],
                "open_now": self.edge_open_at(e, self.round),
            }
            closed_from = e.get("closed_from")
            if closed_from is not None and self.round >= e["announce_round"] and self.round < closed_from:
                view["closes_at_round"] = closed_from
            edges.append(view)
        slots = []
        for s in m["slots"]:
            if s["opens"] <= self.round and s["round"] > self.round:
                free = s["capacity"] - self._slot_claims(self.reservations, s["dock"], s["round"])
                slots.append({"dock": s["dock"], "round": s["round"], "free": free})
        vessels = []
        for v in m["vessels"]:
            state = self.vessels[v["id"]]
            move = state["move"]
            vessels.append({
                "id": v["id"], "capacity": v["capacity"], "draft": v["draft"],
                "dock": state["dock"] if move is None else None,
                "in_transit": None if move is None else {
                    "to": self.moves[move]["dest"], "arrives_round": self.moves[move]["arrive"]},
                "reservation": self.reservations.get(v["id"]),
            })
        jobs = [{
            "id": j["id"], "source": j["source"], "dest": j["dest"], "units": j["units"],
            "due_round": j["due"], "weight": j["weight"], "loadable_from_round": j["loadable_from"],
            "stock_at_source": self.stock[j["id"]],
            "units_committed": self.committed[j["id"]],
            "units_delivered": self.delivered[j["id"]],
        } for j in m["jobs"]]
        b = m["budgets"]
        return {
            "revision": self.revision,
            "round": self.round,
            "horizon": self.horizon,
            "status": self.status,
            "close_reason": self.close_reason,
            "vessels": vessels,
            "jobs": jobs,
            "routes": edges,
            "open_berth_slots": slots,
            "notices": [n["text"] for n in m["notices"] if n["round"] <= self.round],
            "spend": self.spend,
            "receipts": [dict(r) for r in self.receipts],
            "budgets": {
                "reads_left": b["max_reads"] - self.reads,
                "attempts_left": b["max_attempts"] - self.attempts,
                "max_batch": b["max_batch"],
            },
        }

    # ------------------------------------------------------------------ tools
    def observe(self) -> dict[str, Any]:
        return self._read("observe", {}, lambda: {"status": "ok", "observation": self.observation()})

    def inspect(self, kind: Any, ref: Any) -> dict[str, Any]:
        def body() -> dict[str, Any]:
            if kind == "route":
                edge = self._edge(str(ref))
                if edge is None:
                    return self._reject("invalid_request", f"unknown route {ref!r}")
                calendar = {str(r): self.edge_open_at(edge, r) for r in range(self.round, self.horizon)}
                return {"status": "ok", "route": {k: edge[k] for k in
                        ("id", "from", "to", "duration", "cost", "max_draft")},
                        "open_by_entry_round": calendar}
            if kind == "dock":
                if ref not in self.manifest["docks"]:
                    return self._reject("invalid_request", f"unknown dock {ref!r}")
                slots = [{"round": s["round"], "capacity": s["capacity"],
                          "free": s["capacity"] - self._slot_claims(self.reservations, s["dock"], s["round"])}
                         for s in self.manifest["slots"]
                         if s["dock"] == ref and s["opens"] <= self.round and s["round"] > self.round]
                return {"status": "ok", "dock": ref, "slots": slots}
            if kind == "job":
                job = self._job(str(ref))
                if job is None:
                    return self._reject("invalid_request", f"unknown job {ref!r}")
                return {"status": "ok", "job": job, "stock_at_source": self.stock[job["id"]],
                        "units_committed": self.committed[job["id"]],
                        "units_delivered": self.delivered[job["id"]]}
            return self._reject("invalid_request", "kind must be one of route, dock, job")

        return self._read("inspect", {"kind": kind, "ref": ref}, body)

    def _read(self, name: str, args: dict[str, Any], body) -> dict[str, Any]:
        limit = self.manifest["budgets"]["max_reads"]
        if self.reads >= limit:
            self._event("read_rejected", tool=name, code="budget_exhausted")
            return {"status": "rejected", "code": "budget_exhausted",
                    "message": "read allowance exhausted; mutation tools still work"}
        self.reads += 1
        result = body()
        self._event("read", tool=name, args=args, ok=result.get("status") == "ok")
        return result

    def commit(self, expected_revision: Any, action_id: Any, operations: Any) -> dict[str, Any]:
        return self._mutate("commit", expected_revision, action_id, operations)

    def wait(self, expected_revision: Any, action_id: Any) -> dict[str, Any]:
        return self._mutate("wait", expected_revision, action_id, [])

    def finish(self, expected_revision: Any, action_id: Any) -> dict[str, Any]:
        return self._mutate("finish", expected_revision, action_id, [])

    def _reject(self, code: str, message: str, op_index: int | None = None) -> dict[str, Any]:
        out = {"status": "rejected", "code": code, "message": message}
        if op_index is not None:
            out["operation_index"] = op_index
        return out

    def _mutate(self, kind: str, expected_revision: Any, action_id: Any, operations: Any) -> dict[str, Any]:
        if self.status != "active":
            return {**self._reject("episode_closed", "episode already closed"),
                    "observation": self.observation()}
        if not isinstance(action_id, str) or not 1 <= len(action_id) <= 80:
            return self._count_rejection(kind, "invalid_request", "action_id must be a string of 1-80 chars")
        payload = json.dumps({"k": kind, "r": expected_revision, "o": operations}, sort_keys=True, default=str)
        cached = self._accepted.get(action_id)
        if cached is not None:
            if cached[0] == payload:
                return {**cached[1], "replayed": True}
            return self._count_rejection(kind, "idempotency_conflict",
                                         "action_id was already used for a different accepted decision")
        if not _is_int(expected_revision):
            return self._count_rejection(kind, "invalid_request", "expected_revision must be an integer")
        if expected_revision != self.revision:
            return self._count_rejection(kind, "stale_revision",
                                         f"current revision is {self.revision}")
        if not isinstance(operations, list):
            return self._count_rejection(kind, "invalid_request", "operations must be a list")
        if len(operations) > self.manifest["budgets"]["max_batch"]:
            return self._count_rejection(kind, "invalid_request",
                                         f"at most {self.manifest['budgets']['max_batch']} operations per batch")
        if kind == "commit" and not operations:
            return self._count_rejection(kind, "invalid_request", "commit needs at least one operation; use wait")

        if kind == "finish":
            self.attempts += 1
            self.revision += 1
            self._event("finish", action_id=action_id)
            self._close("finish")
        else:
            try:
                candidate = self._apply_batch(operations)
            except EngineError as err:
                return self._count_rejection(kind, err.code, err.message, err.op_index)
            self.attempts += 1
            self._commit_candidate(candidate)
            self.revision += 1
            self._event("commit_accepted", action_id=action_id, kind=kind, operations=operations)
            self._advance()
        if self.status == "active" and self.attempts >= self.manifest["budgets"]["max_attempts"]:
            self._close("budget_exhausted")
        response = {"status": "accepted", "observation": self.observation()}
        self._accepted[action_id] = (payload, response)
        return response

    def _count_rejection(self, kind: str, code: str, message: str, op_index: int | None = None) -> dict[str, Any]:
        self.attempts += 1
        self._event("commit_rejected", kind=kind, code=code, message=message)
        if self.attempts >= self.manifest["budgets"]["max_attempts"]:
            self._close("budget_exhausted")
        out = self._reject(code, message, op_index)
        out["observation"] = self.observation()
        return out

    # --------------------------------------------------------- batch semantics
    def _apply_batch(self, operations: list[Any]) -> dict[str, Any]:
        cand = {
            "vessels": copy.deepcopy(self.vessels),
            "stock": dict(self.stock),
            "committed": dict(self.committed),
            "reservations": copy.deepcopy(self.reservations),
            "moves": [],
            "spend": self.spend,
        }
        for index, op in enumerate(operations):
            try:
                self._apply_op(cand, op)
            except EngineError as err:
                err.op_index = index
                raise
        return cand

    def _apply_op(self, cand: dict[str, Any], op: Any) -> None:
        if not isinstance(op, dict) or "type" not in op:
            raise EngineError("invalid_request", "operation must be an object with a type")
        type_ = op["type"]
        vessel_id = op.get("vessel_id")
        spec = self._vessel_spec(vessel_id) if isinstance(vessel_id, str) else None
        if spec is None:
            raise EngineError("invalid_request", f"unknown vessel_id {vessel_id!r}")
        state = cand["vessels"][vessel_id]
        r = self.round

        if type_ == "reserve_berth":
            dock, arrival = op.get("dock_id"), op.get("arrival_round")
            if dock not in self.manifest["docks"] or not _is_int(arrival):
                raise EngineError("invalid_request", "reserve_berth needs dock_id and integer arrival_round")
            if state["move"] is not None:
                raise EngineError("resource_conflict", f"vessel {vessel_id} is in transit")
            if vessel_id in cand["reservations"]:
                raise EngineError("resource_conflict",
                                  f"vessel {vessel_id} already holds a reservation; release it first")
            if not r < arrival <= self.horizon:
                raise EngineError("resource_conflict", f"arrival_round must be in ({r}, {self.horizon}]")
            slot = self._slot(dock, arrival, r)
            if slot is None:
                raise EngineError("resource_conflict", f"no open berth slot {dock}/{arrival}")
            if self._slot_claims(cand["reservations"], dock, arrival) >= slot["capacity"]:
                raise EngineError("resource_conflict", f"berth slot {dock}/{arrival} is full")
            cand["reservations"][vessel_id] = {"dock": dock, "round": arrival, "state": "held"}
            return

        if type_ == "release_berth":
            held = cand["reservations"].get(vessel_id)
            if held is None or held["state"] != "held":
                raise EngineError("resource_conflict", f"vessel {vessel_id} has no held reservation")
            del cand["reservations"][vessel_id]
            return

        if type_ == "dispatch":
            self._apply_dispatch(cand, op, spec, state)
            return

        raise EngineError("invalid_request", f"unknown operation type {type_!r}")

    def _apply_dispatch(self, cand: dict[str, Any], op: dict[str, Any],
                        spec: dict[str, Any], state: dict[str, Any]) -> None:
        r = self.round
        vessel_id = spec["id"]
        route, loads = op.get("route"), op.get("loads", [])
        if (not isinstance(route, list) or not route or not all(isinstance(x, str) for x in route)
                or not isinstance(loads, list)):
            raise EngineError("invalid_request", "dispatch needs a non-empty route list and a loads list")
        if len(route) > self.manifest["budgets"]["max_path"] or len(set(route)) != len(route):
            raise EngineError("invalid_request", "route must have unique edges within the path cap")
        if state["move"] is not None:
            raise EngineError("resource_conflict", f"vessel {vessel_id} is in transit")
        here, entry, cost = state["dock"], r, 0
        for edge_id in route:
            edge = self._edge(edge_id)
            if edge is None:
                raise EngineError("invalid_request", f"unknown route edge {edge_id!r}")
            if edge["from"] != here:
                raise EngineError("route_unavailable", f"edge {edge_id} does not start at {here}")
            if spec["draft"] > edge["max_draft"]:
                raise EngineError("route_unavailable",
                                  f"vessel {vessel_id} draft {spec['draft']} exceeds {edge_id} limit {edge['max_draft']}")
            if not self.edge_open_at(edge, entry):
                raise EngineError("route_unavailable", f"edge {edge_id} is closed at round {entry}")
            cost += edge["cost"]
            entry += edge["duration"]
            here = edge["to"]
        arrival, dest = entry, here
        if arrival > self.horizon:
            raise EngineError("resource_conflict", f"arrival round {arrival} is beyond horizon {self.horizon}")
        held = cand["reservations"].get(vessel_id)
        if held is None or held["state"] != "held" or held["dock"] != dest or held["round"] != arrival:
            raise EngineError("resource_conflict",
                              f"vessel {vessel_id} needs a held reservation at {dest} for round {arrival}")
        seen: set[str] = set()
        load_out = []
        total = 0
        for load in loads:
            if not isinstance(load, dict) or not isinstance(load.get("job_id"), str) or not _is_int(load.get("units")):
                raise EngineError("invalid_request", "each load needs job_id and integer units")
            job, units = self._job(load["job_id"]), load["units"]
            if job is None or load["job_id"] in seen or units <= 0:
                raise EngineError("invalid_request", f"bad load for {load.get('job_id')!r}")
            seen.add(job["id"])
            if state["dock"] != job["source"] or dest != job["dest"]:
                raise EngineError("incompatible_inventory",
                                  f"job {job['id']} loads at {job['source']} and delivers to {job['dest']}")
            if r < job["loadable_from"]:
                raise EngineError("incompatible_inventory",
                                  f"job {job['id']} is not loadable until round {job['loadable_from']}")
            if units > cand["stock"][job["id"]] or units > job["units"] - cand["committed"][job["id"]]:
                raise EngineError("incompatible_inventory", f"not enough remaining units for {job['id']}")
            total += units
            load_out.append({"job_id": job["id"], "units": units})
        if total > spec["capacity"]:
            raise EngineError("resource_conflict", f"load {total} exceeds capacity {spec['capacity']}")
        for load in load_out:
            cand["stock"][load["job_id"]] -= load["units"]
            cand["committed"][load["job_id"]] += load["units"]
        held["state"] = "allocated"
        cand["spend"] += cost
        move_id = len(self.moves) + len(cand["moves"])
        cand["moves"].append({"id": move_id, "vessel": vessel_id, "route": list(route), "origin": state["dock"],
                              "dest": dest, "depart": r, "arrive": arrival, "loads": load_out, "cost": cost})
        state["move"] = move_id

    def _commit_candidate(self, cand: dict[str, Any]) -> None:
        self.vessels, self.stock = cand["vessels"], cand["stock"]
        self.committed, self.reservations = cand["committed"], cand["reservations"]
        self.spend = cand["spend"]
        self.moves.extend(cand["moves"])
        for move in cand["moves"]:
            self._event("move_dispatched", **{k: move[k] for k in
                        ("id", "vessel", "route", "origin", "dest", "depart", "arrive", "loads", "cost")})

    def _advance(self) -> None:
        self.round += 1
        for move in self.moves:
            if move["arrive"] == self.round:
                self.vessels[move["vessel"]] = {"dock": move["dest"], "move": None}
                self.reservations.pop(move["vessel"], None)
                for load in move["loads"]:
                    self.delivered[load["job_id"]] += load["units"]
                    receipt = {"move": move["id"], "job_id": load["job_id"], "dock": move["dest"],
                               "round": self.round, "units": load["units"]}
                    self.receipts.append(receipt)
                    self._event("receipt", **receipt)
        for n in self.manifest["notices"]:
            if n["round"] == self.round:
                self._event("notice", text=n["text"], effective_round=n["round"])
        if self.round >= self.horizon:
            self._close("horizon")

    def _close(self, reason: str) -> None:
        if self.status != "active":
            return
        self.status = "closed"
        self.close_reason = reason
        self._event("closed", reason=reason)

    def external_close(self, reason: str) -> None:
        """Close on wall-clock timeout or operator stop without moving the world."""
        self._close(reason)
