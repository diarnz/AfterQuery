"""Deterministic Harbor Master rules.

The caller owns session locking, persistence and tool budgets. The reducer
returns the original state on rejection and never mutates caller-owned state.
"""

from dataclasses import asdict, replace

from .model import (
    Decision,
    Dispatch,
    Event,
    Hold,
    Manifest,
    Notice,
    Receipt,
    Release,
    Reserve,
    Slot,
    State,
    Transition,
    Vessel,
    Voyage,
)

MAX_OPERATIONS = 4
MAX_PATH_EDGES = 3


class RuleError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        raise RuleError(code, message)


def idle_vessel(state: State, vessel_id: str) -> Vessel:
    vessel = next((item for item in state.vessels if item.id == vessel_id), None)
    if vessel is None:
        raise RuleError("resource_conflict", f"Vessel {vessel_id} is not idle.")
    return vessel


def slot_capacity(state: State, dock: str, arrival: int) -> int:
    return next((slot.capacity for slot in state.slots
                 if (slot.dock, slot.round) == (dock, arrival)), 0)


def reserved_slots(state: State, dock: str, arrival: int) -> int:
    return (
        sum((hold.dock, hold.round) == (dock, arrival) for hold in state.holds)
        + sum((move.destination, move.arrival) == (dock, arrival) for move in state.voyages)
    )


def _reserve(manifest: Manifest, state: State, op: Reserve) -> tuple[State, Event]:
    idle_vessel(state, op.vessel_id)
    require(op.dock_id in manifest.docks, "invalid_request", "Unknown destination dock.")
    require(type(op.arrival_round) is int and state.round < op.arrival_round <= manifest.horizon,
            "invalid_request", "Arrival must be a future round within the horizon.")
    require(not any(h.vessel_id == op.vessel_id for h in state.holds),
            "resource_conflict", "Release this vessel’s current hold first.")
    require(reserved_slots(state, op.dock_id, op.arrival_round)
            < slot_capacity(state, op.dock_id, op.arrival_round),
            "resource_conflict", "No berth available at that dock and round.")
    hold = Hold(op.vessel_id, op.dock_id, op.arrival_round)
    return replace(state, holds=(*state.holds, hold)), Event("berth_reserved", state.round, asdict(hold))


def _release(state: State, op: Release) -> tuple[State, Event]:
    idle_vessel(state, op.vessel_id)
    hold = next((item for item in state.holds if item.vessel_id == op.vessel_id), None)
    if hold is None:
        raise RuleError("resource_conflict", "Vessel has no releasable berth hold.")
    return replace(state, holds=tuple(item for item in state.holds if item != hold)), Event(
        "berth_released", state.round, asdict(hold)
    )


def _itinerary(state: State, op: Dispatch, origin: str, draft: int) -> tuple[str, int, int]:
    require(0 < len(op.route) <= MAX_PATH_EDGES and len(set(op.route)) == len(op.route),
            "invalid_request", "Route must contain one to three distinct edges.")
    routes = {route.id: route for route in state.routes}
    entries: dict[tuple[str, int], int] = {}
    for voyage in state.voyages:
        entry = voyage.departed
        for edge in voyage.route:
            key = (edge, entry)
            entries[key] = entries.get(key, 0) + 1
            entry += routes[edge].duration
    dock, arrival, cost = origin, state.round, 0
    for edge_id in op.route:
        edge = routes.get(edge_id)
        if edge is None or edge.source != dock:
            raise RuleError("route_unavailable", f"Edge {edge_id} does not depart from {dock}.")
        require(edge.open and draft <= edge.max_draft, "route_unavailable",
                f"Edge {edge_id} is closed or the draft exceeds its limit.")
        require(entries.get((edge_id, arrival), 0) < edge.entry_capacity,
                "resource_conflict", f"Edge {edge_id} is full at round {arrival}.")
        dock = edge.destination
        arrival += edge.duration
        cost += edge.cost
    return dock, arrival, cost


def _dispatch(manifest: Manifest, state: State, op: Dispatch) -> tuple[State, Event]:
    vessel = idle_vessel(state, op.vessel_id)
    dock, arrival, cost = _itinerary(state, op, vessel.dock, vessel.draft)
    require(arrival <= manifest.horizon, "route_unavailable", "Voyage arrives beyond the horizon.")
    hold = Hold(vessel.id, dock, arrival)
    require(hold in state.holds, "resource_conflict", "Reserve the matching arrival berth first.")
    require(len({load.job_id for load in op.loads}) == len(op.loads),
            "invalid_request", "Use at most one load entry per job.")
    require(all(type(load.units) is int and load.units > 0 for load in op.loads),
            "invalid_request", "Cargo quantities must be positive integers.")
    require(sum(load.units for load in op.loads) <= vessel.capacity,
            "resource_conflict", "Vessel cargo capacity exceeded.")

    jobs = {job.id: job for job in manifest.jobs}
    lots = {lot.id: lot for lot in state.lots}
    for load in op.loads:
        job = jobs.get(load.job_id)
        if job is None or job.destination != dock:
            raise RuleError("incompatible_inventory", f"Job {load.job_id} is not eligible for {dock}.")
        lot = lots[job.lot_id]
        allocated = sum(existing.units for voyage in state.voyages for existing in voyage.loads
                        if existing.job_id == job.id)
        require(lot.dock == vessel.dock and lot.release_round <= state.round,
                "incompatible_inventory", f"Lot {lot.id} is not loadable here this round.")
        require(load.units <= lot.units and allocated + load.units <= job.units,
                "incompatible_inventory", f"Load exceeds available stock or unassigned demand for {job.id}.")
        lots[lot.id] = replace(lot, units=lot.units - load.units)

    move = Voyage(f"{vessel.id}-r{state.round}", vessel.id, vessel.dock, dock,
                  state.round, arrival, op.route, op.loads, cost)
    updated = replace(
        state, vessels=tuple(item for item in state.vessels if item.id != vessel.id),
        holds=tuple(item for item in state.holds if item != hold),
        lots=tuple(lots.values()), voyages=(*state.voyages, move), spent=state.spent + cost,
    )
    return updated, Event("voyage_dispatched", state.round, asdict(move))


def _apply_notice(state: State, notice: Notice) -> State:
    if notice.kind == "set_berth_capacity":
        slots = {(slot.dock, slot.round): slot for slot in state.slots}
        slots[notice.target, notice.arrival_round] = Slot(notice.target, notice.arrival_round, notice.value)
        return replace(state, slots=tuple(slots.values()))
    changes = {"max_draft": notice.value} if notice.kind == "set_draft" else {
        "open": notice.kind == "open_route"
    }
    return replace(state, routes=tuple(
        replace(route, **changes) if route.id == notice.target else route for route in state.routes
    ))


def _notices(state: State, schedule: tuple[Notice, ...]) -> tuple[State, tuple[Event, ...]]:
    events = []
    for notice in sorted(schedule, key=lambda item: (item.kind, item.id)):
        if notice.published_round == state.round and notice not in state.notices:
            state = replace(state, notices=(*state.notices, notice))
            events.append(Event("notice_published", state.round, asdict(notice)))
        if notice.effective_round == state.round:
            state = _apply_notice(state, notice)
            events.append(Event("notice_applied", state.round, asdict(notice)))
    return state, tuple(events)


def initialize(manifest: Manifest) -> tuple[State, tuple[Event, ...]]:
    initial = State(0, 0, manifest.routes, manifest.slots, manifest.vessels, manifest.lots)
    return _notices(initial, manifest.notices)


def _settle(manifest: Manifest, state: State) -> tuple[State, tuple[Event, ...]]:
    vessels, receipts, events = list(state.vessels), list(state.receipts), []
    vessel_specs = {vessel.id: vessel for vessel in manifest.vessels}
    jobs = {job.id: job for job in manifest.jobs}
    for move in state.voyages:
        if move.arrival != state.round:
            continue
        vessels.append(replace(vessel_specs[move.vessel_id], dock=move.destination))
        events.append(Event("voyage_arrived", state.round, {"voyage_id": move.id}))
        for load in move.loads:
            receipt = Receipt(f"{move.id}/{load.job_id}", move.id, load.job_id,
                              jobs[load.job_id].lot_id, move.destination, state.round, load.units)
            receipts.append(receipt)
            events.append(Event("delivery_receipted", state.round, asdict(receipt)))
    for hold in state.holds:
        if hold.round == state.round:
            events.append(Event("berth_expired", state.round, asdict(hold)))
    return replace(state, vessels=tuple(sorted(vessels, key=lambda vessel: vessel.id)),
                   holds=tuple(hold for hold in state.holds if hold.round > state.round),
                   receipts=tuple(receipts)), tuple(events)


def advance(manifest: Manifest, state: State, decision: Decision) -> Transition:
    try:
        require(state.terminal_reason is None, "episode_closed", "This episode is closed.")
        require(decision.tool in ("commit", "wait", "finish"), "invalid_request", "Unknown decision.")
        if decision.tool == "commit":
            require(0 < len(decision.operations) <= MAX_OPERATIONS, "invalid_request",
                    "Commit must contain one to four operations.")
        else:
            require(not decision.operations, "invalid_request", "Only commits contain operations.")

        candidate = replace(state, revision=state.revision + 1)
        if decision.tool == "finish":
            return Transition(replace(candidate, terminal_reason="finished"), (
                Event("run_closed", state.round, {"reason": "finished"}),))
        effects = []
        for operation in decision.operations:
            if isinstance(operation, Reserve):
                candidate, event = _reserve(manifest, candidate, operation)
            elif isinstance(operation, Release):
                candidate, event = _release(candidate, operation)
            elif isinstance(operation, Dispatch):
                candidate, event = _dispatch(manifest, candidate, operation)
            else:
                raise RuleError("invalid_request", "Unknown operation.")
            effects.append(event)
        candidate, arrivals = _settle(manifest, replace(candidate, round=state.round + 1))
        candidate, notices = _notices(candidate, manifest.notices)
        effects.extend((*arrivals, *notices))
        if candidate.round == manifest.horizon:
            candidate = replace(candidate, terminal_reason="horizon")
            effects.append(Event("run_closed", candidate.round, {"reason": "horizon"}))
        return Transition(candidate, tuple(effects))
    except RuleError as error:
        return Transition(state, error_code=error.code, message=str(error))
