import json
import unittest
from fractions import Fraction

from runbook.agent import run_episode
from runbook.providers import MissingKey, NvidiaNemotron, Scripted, extract_tool_call


def j(**kw):
    return json.dumps(kw)


GOOD = [
    j(tool="observe"),
    j(tool="commit", expected_revision=0, action_id="a", operations=[
        {"type": "reserve_berth", "vessel_id": "B", "dock_id": "north", "arrival_round": 1},
        {"type": "dispatch", "vessel_id": "B", "route": ["north-out"], "loads": [{"job_id": "grain", "units": 3}]}]),
    j(tool="wait", expected_revision=1, action_id="b"),
    j(tool="commit", expected_revision=2, action_id="c", operations=[
        {"type": "reserve_berth", "vessel_id": "A", "dock_id": "east", "arrival_round": 4},
        {"type": "dispatch", "vessel_id": "A", "route": ["outer-canal"], "loads": [{"job_id": "cloth", "units": 4}]}]),
    j(tool="wait", expected_revision=3, action_id="d"),
    j(tool="wait", expected_revision=4, action_id="e"),
    j(tool="finish", expected_revision=5, action_id="f"),
]

TRAP = [
    "Sure! I will think first. <think>{\"tool\": \"finish\"}</think>",
    "```json\n" + j(tool="commit", expected_revision=0, action_id="a", operations=[
        {"type": "reserve_berth", "vessel_id": "A", "dock_id": "north", "arrival_round": 1},
        {"type": "dispatch", "vessel_id": "A", "route": ["north-out"], "loads": [{"job_id": "grain", "units": 3}]}]) + "\n```",
    j(tool="wait", expected_revision=1, action_id="b"),
    j(tool="commit", expected_revision=2, action_id="c", operations=[
        {"type": "reserve_berth", "vessel_id": "B", "dock_id": "east", "arrival_round": 4},
        {"type": "dispatch", "vessel_id": "B", "route": ["outer-canal"], "loads": [{"job_id": "cloth", "units": 4}]}]),
    j(tool="finish", expected_revision=2, action_id="z"),
]


class AgentLoop(unittest.TestCase):
    def test_good_policy_reaches_reference(self):
        res = run_episode(Scripted(GOOD))
        self.assertEqual(res.verdict.reward, Fraction(5953, 7000))
        self.assertEqual(res.parse_errors, 0)

    def test_trap_policy_is_diagnosed(self):
        res = run_episode(Scripted(TRAP))
        self.assertFalse(res.verdict.complete)
        self.assertEqual(res.verdict.reward, Fraction(3, 40))
        self.assertEqual(res.rejections["route_unavailable"], 1)
        self.assertTrue(any("scarce-vessel" in n for n in res.notes))

    def test_garbage_replies_time_out_without_score(self):
        res = run_episode(Scripted(["no json here"]), max_turns=5)
        self.assertEqual(res.parse_errors, 5)
        self.assertEqual(res.close_reason, "timeout")
        self.assertEqual(res.verdict.reward, 0)

    def test_extract_ignores_think_blocks(self):
        self.assertEqual(extract_tool_call('<think>{"tool":"finish"}</think> {"tool":"observe"}'), {"tool": "observe"})

    def test_missing_key_is_clear(self):
        import os
        saved = {k: os.environ.pop(k, None) for k in ("NVIDIA_API_KEY", "NGC_API_KEY")}
        try:
            with self.assertRaises(MissingKey):
                NvidiaNemotron().complete([{"role": "user", "content": "hi"}])
        finally:
            for k, v in saved.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
