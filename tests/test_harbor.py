import unittest
from fractions import Fraction

from runbook.controls import CLOTH, CONTROLS, GRAIN, dispatch, reserve, run_script
from runbook.harbor import Episode
from runbook.verify import verify


class HarborFixture(unittest.TestCase):
    def test_demonstration_matches_hand_computed_ledger(self):
        ep, v = run_script(CONTROLS["demonstration"])
        self.assertEqual(v.reward, Fraction(5953, 7000))
        self.assertEqual(v.cost, 9)
        self.assertEqual(v.quality, Fraction(351, 700))
        self.assertTrue(v.complete and v.integrity_ok)
        self.assertEqual(ep.close_reason, "finish")

    def test_stop_early_and_idle(self):
        self.assertEqual(run_script(CONTROLS["stop_early"])[1].reward, Fraction(3, 40))
        self.assertEqual(run_script(CONTROLS["do_nothing"])[1].reward, 0)

    def test_mistake_traces_are_partial_only(self):
        for name in ("a_takes_grain", "b_on_outer_canal", "late_outer_departure"):
            v = run_script(CONTROLS[name])[1]
            self.assertFalse(v.complete, name)
            self.assertEqual(v.reward, Fraction(3, 40), name)

    def test_b_on_outer_canal_is_rejected_for_draft(self):
        ep = Episode()
        ep.commit(0, "r0", [reserve("A", "north", 1), dispatch("A", ["north-out"], GRAIN)])
        ep.wait(1, "r1")
        res = ep.commit(2, "r2", [reserve("B", "east", 4), dispatch("B", ["outer-canal"], CLOTH)])
        self.assertEqual(res["code"], "route_unavailable")
        self.assertEqual(ep.round, 2)

    def test_short_canal_rejected_after_closure_without_clock_move(self):
        ep = Episode()
        ep.commit(0, "r0", [reserve("B", "north", 1), dispatch("B", ["north-out"], GRAIN)])
        ep.wait(1, "r1")
        res = ep.commit(2, "r2", [reserve("A", "east", 4), dispatch("A", ["short-canal"], CLOTH)])
        self.assertEqual(res["code"], "route_unavailable")
        self.assertEqual((ep.round, ep.revision), (2, 2))

    def test_batch_is_atomic(self):
        ep = Episode()
        res = ep.commit(0, "x", [reserve("B", "north", 1), dispatch("B", ["short-canal"], GRAIN)])
        self.assertEqual(res["status"], "rejected")
        self.assertEqual(ep.reservations, {})
        self.assertEqual(ep.revision, 0)

    def test_cloth_not_loadable_before_round_two(self):
        ep = Episode()
        res = ep.commit(0, "x", [reserve("B", "east", 4), dispatch("B", ["short-canal", "short-canal"], CLOTH)])
        self.assertEqual(res["status"], "rejected")
        res = ep.commit(0, "y", [reserve("B", "east", 4), dispatch("B", ["outer-canal"], CLOTH)])
        self.assertIn(res["code"], ("route_unavailable", "incompatible_inventory"))

    def test_stale_revision_and_idempotent_replay(self):
        ep = Episode()
        self.assertEqual(ep.wait(5, "w")["code"], "stale_revision")
        first = ep.wait(0, "w1")
        again = ep.wait(0, "w1")
        self.assertTrue(again["replayed"])
        self.assertEqual(first["observation"]["round"], again["observation"]["round"])
        self.assertEqual(ep.commit(1, "w1", [reserve("A", "west", 4)])["code"], "idempotency_conflict")

    def test_attempt_budget_closes_episode(self):
        ep = Episode()
        for i in range(12):
            ep.wait(99, f"bad-{i}")
        self.assertEqual(ep.status, "closed")
        self.assertEqual(ep.close_reason, "budget_exhausted")

    def test_hidden_slot_not_visible_or_bookable_before_notice(self):
        ep = Episode()
        slots = [(s["dock"], s["round"]) for s in ep.observation()["open_berth_slots"]]
        self.assertNotIn(("east", 5), slots)
        res = ep.commit(0, "x", [reserve("A", "east", 5)])
        self.assertEqual(res["code"], "resource_conflict")

    def test_verifier_flags_tampered_ledger(self):
        ep, _ = run_script(CONTROLS["demonstration"])
        tampered = [dict(e) for e in ep.ledger]
        for e in tampered:
            if e["type"] == "receipt" and e["job_id"] == "cloth":
                e["round"] = 3
        self.assertFalse(verify(ep.manifest, tampered).integrity_ok)


if __name__ == "__main__":
    unittest.main()
