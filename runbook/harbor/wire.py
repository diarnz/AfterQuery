"""JSON-ready payloads for the harness and UI owners.

This module runs in process. The service is responsible for run identity,
idempotency, attempt budgets, and persisting the world's accepted events.
"""

from dataclasses import asdict
from typing import Any

from .engine import MAX_OPERATIONS, MAX_PATH_EDGES, advance, reserved_slots
from .model import Decision, Dispatch, Load, Manifest, Release, Reserve, State

_OPERATION_NAMES = {Reserve: "reserve_berth", Release: "release_berth", Dispatch: "dispatch"}


def _text(value: object) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 128:
        raise ValueError("Expected a nonempty string of at most 128 characters.")
    return value


def _integer(value: object) -> int:
    if type(value) is not int or not 0 <= value <= 1_000_000_000:
        raise ValueError("Expected a nonnegative integer up to 1,000,000,000.")
    return value


def _object(value: object, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or value.keys() != keys:
        raise ValueError(f"Expected object fields: {', '.join(sorted(keys))}.")
    return value


def _array(value: object, limit: int) -> list:
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f"Expected an array with at most {limit} entries.")
    return value


def _operation(value: object):
    kind = value.get("type") if isinstance(value, dict) else None
    if kind == "reserve_berth":
        op = _object(value, {"type", "vessel_id", "dock_id", "arrival_round"})
        return Reserve(_text(op["vessel_id"]), _text(op["dock_id"]), _integer(op["arrival_round"]))
    if kind == "release_berth":
        op = _object(value, {"type", "vessel_id"})
        return Release(_text(op["vessel_id"]))
    if kind == "dispatch":
        op = _object(value, {"type", "vessel_id", "route", "loads"})
        loads = [_object(item, {"job_id", "units"}) for item in _array(op["loads"], 32)]
        return Dispatch(
            _text(op["vessel_id"]),
            tuple(_text(edge) for edge in _array(op["route"], MAX_PATH_EDGES)),
            tuple(Load(_text(load["job_id"]), _integer(load["units"])) for load in loads),
        )
    raise ValueError("Unknown operation type.")


def decision_payload(decision: Decision, revision: int, action_id: str) -> dict:
    payload = {"expected_revision": revision, "action_id": action_id}
    if decision.tool == "commit":
        payload["operations"] = [
            {"type": _OPERATION_NAMES[type(op)], **asdict(op)} for op in decision.operations
        ]
        for op in payload["operations"]:
            if op["type"] == "dispatch":
                op["route"] = list(op["route"])
                op["loads"] = list(op["loads"])
    return payload


def charter(manifest: Manifest) -> dict:
    return {
        "id": manifest.version,
        "goal": "Deliver every required unit to its job's destination by its inclusive due round.",
        "rules": [
            "Reads do not advance time. A successful commit or wait advances one round.",
            "Operations apply in submission order. Any failure rolls back the entire batch.",
            "Reserve the destination berth before dispatch, including within the same batch.",
            "Routes must be open and fit the vessel's draft when the voyage is dispatched.",
            "Existing voyages settle before notices take effect. Existing berth claims are honored.",
            "Finish closes immediately. The horizon closes after settling arrivals at that round.",
        ],
        "horizon": manifest.horizon,
        "cost_cap": manifest.cost_cap,
        "slack_cap": manifest.slack_cap,
    }


def observe(manifest: Manifest, state: State) -> dict:
    available = {vessel.id: vessel for vessel in state.vessels}
    pending = {voyage.vessel_id: voyage.id for voyage in state.voyages if voyage.arrival > state.round}
    return {
        "schema": "harbor.observe.v1",
        "charter": charter(manifest),
        "episode_state": "closed" if state.terminal_reason else "active",
        "terminal_reason": state.terminal_reason,
        "round": state.round,
        "revision": state.revision,
        "horizon": manifest.horizon,
        "docks": list(manifest.docks),
        "limits": {"max_operations_per_batch": MAX_OPERATIONS, "max_route_edges": MAX_PATH_EDGES},
        "cost_cap": manifest.cost_cap,
        "slack_cap": manifest.slack_cap,
        "jobs": [asdict(job) for job in manifest.jobs],
        "vessels": [
            {**asdict(spec), "dock": available[spec.id].dock if spec.id in available else None,
             "voyage_id": pending.get(spec.id)}
            for spec in manifest.vessels
        ],
        "lots": [asdict(lot) for lot in state.lots],
        "routes": [asdict(route) for route in state.routes],
        "slots": [
            {**asdict(slot), "free": max(0, slot.capacity - reserved_slots(state, slot.dock, slot.round))}
            for slot in state.slots if slot.round > state.round
        ],
        "holds": [asdict(hold) for hold in state.holds],
        "voyages": [asdict(voyage) for voyage in state.voyages],
        "receipts": [asdict(receipt) for receipt in state.receipts],
        "notices": [asdict(notice) for notice in state.notices],
        "spent": state.spent,
    }


def inspect(manifest: Manifest, state: State, ref: str) -> dict:
    fields_by_document = {
        "charter": ("charter",),
        "route-map": ("docks", "routes"),
        "arrival-calendar": ("slots", "holds"),
        "current-orders": ("jobs", "lots", "receipts"),
        "notice-board": ("notices",),
    }
    if ref not in fields_by_document:
        raise ValueError(f"Unknown document: {ref}.")
    snapshot = observe(manifest, state)
    return {
        "ref": ref,
        "round": state.round,
        "revision": state.revision,
        "data": {field: snapshot[field] for field in fields_by_document[ref]},
    }


def apply_tool(manifest: Manifest, state: State, tool: str, payload: object) -> tuple[State, dict]:
    action_id = None
    try:
        if tool not in ("commit", "wait", "finish"):
            raise ValueError("Unknown decision tool.")
        keys = {"expected_revision", "action_id"}
        if tool == "commit":
            keys.add("operations")
        body = _object(payload, keys)
        action_id = _text(body["action_id"])
        revision = _integer(body["expected_revision"])
        operations = ()
        if tool == "commit":
            operations = tuple(_operation(item) for item in _array(body["operations"], MAX_OPERATIONS))
    except ValueError as error:
        return state, _response(manifest, state, action_id, "invalid_request", str(error))

    if revision != state.revision:
        return state, _response(manifest, state, action_id, "stale_revision", "Read the current revision.")
    result = advance(manifest, state, Decision(tool, operations))
    return result.state, _response(manifest, result.state, action_id, result.error_code, result.message,
                                   [asdict(event) for event in result.events])


def _response(manifest, state, action_id, error, message, events=()):
    return {
        "action_id": action_id,
        "accepted": error is None,
        "error": {"code": error, "message": message} if error else None,
        "events": list(events),
        "observation": observe(manifest, state),
    }
