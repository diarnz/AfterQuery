import json
import unittest
from dataclasses import replace
from fractions import Fraction

from runbook.harbor.engine import advance, initialize
from runbook.harbor.model import (
    Decision,
    Dispatch,
    Load,
    Notice,
    Release,
    Reserve,
    Slot,
)
from runbook.harbor.policy import choose, estimate, progress, public_position
from runbook.harbor.scenarios import FAMILIES, fingerprint, fixture, generate
from runbook.harbor.wire import apply_tool, decision_payload, observe


class HarborTests(unittest.TestCase):
    def play(self, manifest):
        state, _ = initialize(manifest)
        actions = []
        while state.terminal_reason is None:
            decision = choose(public_position(manifest, state))
            payload = decision_payload(decision, state.revision, f"step-{state.revision}")
            payload = json.loads(json.dumps(payload))
            state, response = apply_tool(manifest, state, decision.tool, payload)
            self.assertTrue(response["accepted"], response)
            actions.append((decision.tool, payload, response))
        return state, actions

    def test_fixture_matches_hand_calculated_ledger_and_replays(self):
        manifest = fixture()
        state, actions = self.play(manifest)
        self.assertEqual(state.spent, 9)
        self.assertEqual(
            [(r.job_id, r.destination, r.round, r.units) for r in state.receipts],
            [("grain-north", "north", 1, 3), ("cloth-east", "east", 4, 4)],
        )
        self.assertEqual(estimate(public_position(manifest, state)), Fraction(5953, 7000))

        replay, _ = initialize(manifest)
        for tool, payload, recorded in actions:
            replay, response = apply_tool(manifest, replay, tool, payload)
            self.assertEqual(response, recorded)
        self.assertEqual(replay, state)

    def test_closed_canal_rolls_back_prior_reservation_in_batch(self):
        manifest = replace(fixture(), slots=(*fixture().slots, Slot("east", 3)))
        state, _ = initialize(manifest)
        for _ in range(2):
            state = advance(manifest, state, Decision("wait")).state
        result = advance(manifest, state, Decision("commit", (
            Reserve("barge-a", "east", 3),
            Dispatch("barge-a", ("short-canal",), (Load("cloth-east", 4),)),
        )))
        self.assertEqual(result.error_code, "route_unavailable")
        self.assertIs(result.state, state)
        self.assertEqual(result.events, ())

    def test_late_delivery_is_physical_but_not_credited(self):
        manifest = fixture()
        state, _ = initialize(manifest)
        for _ in range(3):
            state = advance(manifest, state, Decision("wait")).state
        state = advance(manifest, state, Decision("commit", (
            Reserve("barge-a", "east", 5),
            Dispatch("barge-a", ("outer-canal",), (Load("cloth-east", 4),)),
        ))).state
        state = advance(manifest, state, Decision("wait")).state
        self.assertEqual(state.receipts[0].round, 5)
        self.assertEqual(state.receipts[0].units, 4)
        self.assertEqual(progress(public_position(manifest, state)), 0)

    def test_in_flight_voyage_finishes_after_closure(self):
        base = fixture()
        manifest = replace(
            base, slots=(*base.slots, Slot("east", 3)),
            routes=tuple(replace(r, duration=2) if r.id == "short-canal" else r for r in base.routes),
            lots=tuple(replace(lot, release_round=1) if lot.id == "cloth" else lot for lot in base.lots),
        )
        state, _ = initialize(manifest)
        state = advance(manifest, state, Decision("wait")).state
        dispatch = advance(manifest, state, Decision("commit", (
            Reserve("barge-a", "east", 3),
            Dispatch("barge-a", ("short-canal",), (Load("cloth-east", 4),)),
        )))
        self.assertIsNone(dispatch.error_code)
        self.assertIn("notice_applied", [e.type for e in dispatch.events])
        arrived = advance(manifest, dispatch.state, Decision("wait")).state
        self.assertEqual(arrived.receipts[0].round, 3)

    def test_grandfathered_berth_cannot_be_rebooked_after_release(self):
        base = fixture()
        notice = Notice("berth-cut", "set_berth_capacity", 1, 1, "east", 0, 4)
        manifest = replace(base, notices=(*base.notices, notice))
        state, _ = initialize(manifest)
        state = advance(manifest, state, Decision("commit", (Reserve("barge-a", "east", 4),))).state
        self.assertEqual(len(state.holds), 1)
        state = advance(manifest, state, Decision("commit", (Release("barge-a"),))).state
        result = advance(manifest, state, Decision("commit", (Reserve("barge-b", "east", 4),)))
        self.assertEqual(result.error_code, "resource_conflict")
        self.assertIs(result.state, state)

    def test_shared_inventory_and_berth_conflicts_are_atomic(self):
        base = fixture()
        job = replace(base.jobs[0], id="extra-cloth", units=3, due_round=3)
        manifest = replace(base, jobs=(*base.jobs, job), slots=(*base.slots, Slot("east", 1, 2)),
                           lots=tuple(replace(lot, release_round=0) for lot in base.lots))
        state, _ = initialize(manifest)
        conflict = advance(manifest, state, Decision("commit", (
            Reserve("barge-a", "north", 1), Reserve("barge-b", "north", 1),
        )))
        self.assertEqual(conflict.error_code, "resource_conflict")
        self.assertIs(conflict.state, state)
        overdraft = advance(manifest, state, Decision("commit", (
            Reserve("barge-b", "east", 1),
            Dispatch("barge-b", ("short-canal",), (Load("cloth-east", 2), Load("extra-cloth", 3))),
        )))
        self.assertEqual(overdraft.error_code, "incompatible_inventory")
        self.assertIs(overdraft.state, state)

    def test_future_notices_absent_until_published_and_seed_is_stable(self):
        manifest = generate(5, "reactive_closure")
        initial, _ = initialize(manifest)
        self.assertFalse(observe(manifest, initial)["notices"])
        self.assertFalse(public_position(manifest, initial).world.notices)
        self.assertEqual(manifest, generate(5, "reactive_closure"))
        self.assertEqual(fingerprint(manifest), fingerprint(replace(manifest, seed=999)))

    def test_generated_families_have_complete_reference_runs(self):
        for family in FAMILIES:
            for seed in range(12):
                with self.subTest(family=family, seed=seed):
                    manifest = generate(seed, family)
                    state, _ = self.play(manifest)
                    self.assertEqual(progress(public_position(manifest, state)), 1)

    def test_wire_rejects_stale_and_malformed_requests(self):
        manifest = fixture()
        state, _ = initialize(manifest)
        for value, code in ((-1, "invalid_request"), (True, "invalid_request"), (1, "stale_revision")):
            updated, response = apply_tool(
                manifest, state, "wait", {"action_id": "test", "expected_revision": value}
            )
            self.assertIs(updated, state)
            self.assertEqual(response["error"]["code"], code)

    def test_finishing_before_arrival_does_not_advance_time(self):
        manifest = fixture()
        state, _ = initialize(manifest)
        for _ in range(2):
            state = advance(manifest, state, Decision("wait")).state
        state = advance(manifest, state, Decision("commit", (
            Reserve("barge-a", "east", 4),
            Dispatch("barge-a", ("outer-canal",), (Load("cloth-east", 4),)),
        ))).state
        closed = advance(manifest, state, Decision("finish")).state
        self.assertEqual(closed.round, 3)
        self.assertEqual(closed.receipts, ())
        self.assertEqual(closed.spent, 6)


if __name__ == "__main__":
    unittest.main()
