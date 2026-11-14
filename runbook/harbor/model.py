"""Immutable Harbor Master data shared by the reducer and reference planner."""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class Route:
    id: str
    source: str
    destination: str
    duration: int
    cost: int
    max_draft: int
    entry_capacity: int = 1
    open: bool = True


@dataclass(frozen=True, slots=True)
class Vessel:
    id: str
    dock: str
    capacity: int
    draft: int


@dataclass(frozen=True, slots=True)
class Lot:
    id: str
    dock: str
    units: int
    release_round: int = 0


@dataclass(frozen=True, slots=True)
class Job:
    id: str
    lot_id: str
    destination: str
    units: int
    due_round: int
    weight: int = 1


@dataclass(frozen=True, slots=True)
class Slot:
    dock: str
    round: int
    capacity: int = 1


NoticeKind = Literal["close_route", "open_route", "set_draft", "set_berth_capacity"]


@dataclass(frozen=True, slots=True)
class Notice:
    id: str
    kind: NoticeKind
    published_round: int
    effective_round: int
    target: str
    value: int = 0
    arrival_round: int = 0


@dataclass(frozen=True, slots=True)
class Manifest:
    family: str
    seed: int
    horizon: int
    docks: tuple[str, ...]
    routes: tuple[Route, ...]
    vessels: tuple[Vessel, ...]
    lots: tuple[Lot, ...]
    jobs: tuple[Job, ...]
    slots: tuple[Slot, ...]
    notices: tuple[Notice, ...]
    cost_cap: int
    slack_cap: int
    version: str = "harbor-v1"


@dataclass(frozen=True, slots=True)
class Load:
    job_id: str
    units: int


@dataclass(frozen=True, slots=True)
class Reserve:
    vessel_id: str
    dock_id: str
    arrival_round: int


@dataclass(frozen=True, slots=True)
class Release:
    vessel_id: str


@dataclass(frozen=True, slots=True)
class Dispatch:
    vessel_id: str
    route: tuple[str, ...]
    loads: tuple[Load, ...]


Operation = Reserve | Release | Dispatch


@dataclass(frozen=True, slots=True)
class Decision:
    tool: Literal["commit", "wait", "finish"]
    operations: tuple[Operation, ...] = ()


@dataclass(frozen=True, slots=True)
class Hold:
    vessel_id: str
    dock: str
    round: int


@dataclass(frozen=True, slots=True)
class Voyage:
    id: str
    vessel_id: str
    origin: str
    destination: str
    departed: int
    arrival: int
    route: tuple[str, ...]
    loads: tuple[Load, ...]
    cost: int


@dataclass(frozen=True, slots=True)
class Receipt:
    id: str
    voyage_id: str
    job_id: str
    lot_id: str
    destination: str
    round: int
    units: int


@dataclass(frozen=True, slots=True)
class State:
    """Materialized public world state. Future private notices live in Manifest."""

    round: int
    revision: int
    routes: tuple[Route, ...]
    slots: tuple[Slot, ...]
    vessels: tuple[Vessel, ...]   # Traveling vessels are absent until arrival.
    lots: tuple[Lot, ...]
    holds: tuple[Hold, ...] = ()
    voyages: tuple[Voyage, ...] = ()  # Includes settled voyages for audit.
    receipts: tuple[Receipt, ...] = ()
    notices: tuple[Notice, ...] = ()  # Announced notices only.
    spent: int = 0
    terminal_reason: str | None = None


@dataclass(frozen=True, slots=True)
class Event:
    type: str
    round: int
    data: dict[str, object]


@dataclass(frozen=True, slots=True)
class Transition:
    state: State
    events: tuple[Event, ...] = ()
    error_code: str | None = None
    message: str | None = None
