"""Small reference policy using only the public position and announced notices."""

from dataclasses import dataclass, replace
from fractions import Fraction
from itertools import product

from .engine import (
    MAX_OPERATIONS,
    MAX_PATH_EDGES,
    advance,
    reserved_slots,
    slot_capacity,
)
from .model import (
    Decision,
    Dispatch,
    Job,
    Load,
    Manifest,
    Release,
    Reserve,
    State,
    Vessel,
)


@dataclass(frozen=True, slots=True)
class Position:
    world: State
    horizon: int
    docks: tuple[str, ...]
    jobs: tuple[Job, ...]
    vessel_catalog: tuple[Vessel, ...]
    cost_cap: int
    slack_cap: int


def public_position(manifest: Manifest, state: State) -> Position:
    return Position(state, manifest.horizon, manifest.docks, manifest.jobs, manifest.vessels,
                    manifest.cost_cap, manifest.slack_cap)


def progress(position: Position) -> Fraction:
    state = position.world
    return sum(
        Fraction(job.weight * min(job.units, sum(
            receipt.units for receipt in state.receipts
            if receipt.job_id == job.id and receipt.round <= job.due_round
        )), job.units)
        for job in position.jobs
    ) / sum(job.weight for job in position.jobs)


def estimate(position: Position) -> Fraction:
    """Planner utility on settled deliveries. The judge owns independent verification."""
    fraction = progress(position)
    if fraction < 1:
        return Fraction(15, 100) * fraction
    state = position.world
    jobs = {job.id: job for job in position.jobs}
    slack = sum(
        receipt.units * min(position.slack_cap, max(0, jobs[receipt.job_id].due_round - receipt.round))
        for receipt in state.receipts
    )
    slack_quality = Fraction(slack, position.slack_cap * sum(job.units for job in position.jobs))
    cost_quality = Fraction(max(0, position.cost_cap - state.spent), position.cost_cap)
    return Fraction(7, 10) + Fraction(18, 100) * cost_quality + Fraction(12, 100) * slack_quality


def _paths(state: State, dock: str, draft: int, visited: frozenset[str], depth: int):
    if depth == MAX_PATH_EDGES:
        return
    for edge in state.routes:
        if edge.source != dock or edge.destination in visited or not edge.open or draft > edge.max_draft:
            continue
        yield (edge,)
        for suffix in _paths(state, edge.destination, draft, visited | {edge.destination}, depth + 1):
            yield (edge, *suffix)


def _vessel_choices(position: Position, vessel):
    state = position.world
    prior = next((hold for hold in state.holds if hold.vessel_id == vessel.id), None)
    lots = {lot.id: lot for lot in state.lots}
    allocated = {job.id: 0 for job in position.jobs}
    for move in state.voyages:
        for load in move.loads:
            allocated[load.job_id] += load.units
    for path in _paths(state, vessel.dock, vessel.draft, frozenset({vessel.dock}), 0):
        arrival = state.round + sum(edge.duration for edge in path)
        dock = path[-1].destination
        if arrival > position.horizon or slot_capacity(state, dock, arrival) == 0:
            continue
        same_hold = prior is not None and (prior.dock, prior.round) == (dock, arrival)
        reservations = ()
        if not same_hold:
            if reserved_slots(state, dock, arrival) >= slot_capacity(state, dock, arrival):
                continue
            if prior:
                reservations = (Release(vessel.id),)
            reservations += (Reserve(vessel.id, dock, arrival),)
        jobs = [
            job for job in position.jobs
            if job.destination == dock and lots[job.lot_id].dock == vessel.dock
            and lots[job.lot_id].release_round <= state.round and arrival <= job.due_round
            and job.units > allocated[job.id] and lots[job.lot_id].units > 0
        ]
        ranges = [range(min(job.units - allocated[job.id], lots[job.lot_id].units, vessel.capacity) + 1)
                  for job in jobs]
        for counts in product(*ranges):
            if sum(counts) > vessel.capacity:
                continue
            # Reposition only where unassigned stock could subsequently be picked up.
            if not any(counts) and not any(
                job.units > allocated[job.id] and lots[job.lot_id].dock == dock
                and lots[job.lot_id].units > 0 for job in position.jobs
            ):
                continue
            loads = tuple(Load(job.id, units) for job, units in zip(jobs, counts) if units)
            yield (*reservations, Dispatch(vessel.id, tuple(edge.id for edge in path), loads))


def _candidates(position: Position):
    # Each vessel may dispatch once or remain idle. Same-round conflicts are checked by advance().
    choices = [(*_vessel_choices(position, vessel), ()) for vessel in position.world.vessels]
    for selections in product(*choices):
        operations = tuple(operation for selection in selections for operation in selection)
        if 0 < len(operations) <= MAX_OPERATIONS:
            yield Decision("commit", operations)
    yield Decision("wait")


def choose(position: Position, *, node_budget: int = 8_000) -> Decision:
    """Plan under announced changes, then replan after the next real transition."""
    if position.world.terminal_reason is not None:
        raise ValueError("Cannot plan for a closed episode.")
    if node_budget < 1:
        raise ValueError("Node budget must be positive.")
    if progress(position) == 1:
        return Decision("finish")

    world = position.world
    visible = Manifest(
        "planning", 0, position.horizon, position.docks, world.routes, position.vessel_catalog, world.lots,
        position.jobs, world.slots, world.notices, position.cost_cap, position.slack_cap,
    )

    best_score = Fraction(-1)
    best_decision = Decision("wait")
    explored = 0

    def search(state: State, first: Decision | None = None):
        nonlocal best_score, best_decision, explored
        current = replace(position, world=state)
        if state.terminal_reason is not None or progress(current) == 1:
            value = estimate(current)
            if first is not None and value > best_score:
                best_score, best_decision = value, first
            return
        for decision in _candidates(current):
            if explored >= node_budget:
                break
            explored += 1
            result = advance(visible, state, decision)
            if result.error_code is None:
                search(result.state, first or decision)

    search(world)
    return best_decision
