import json
import unittest

import httpx

from runbook.api.app import app


class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_reference_stream_delivers_real_receipts(self):
        response = await self.client.post("/api/runs", json={"scenario": "fixture"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/x-ndjson")
        opening, *steps, final = map(json.loads, response.iter_lines())
        self.assertEqual(opening["observation"]["round"], 0)
        self.assertNotIn("manifest", opening)
        self.assertTrue(all(step["response"]["accepted"] for step in steps))
        self.assertEqual(final["type"], "complete")
        self.assertTrue(final["result"]["complete"])
        self.assertAlmostEqual(final["result"]["planner_score"], 5953 / 7000)
        receipts = steps[-1]["response"]["observation"]["receipts"]
        self.assertEqual([(r["job_id"], r["round"]) for r in receipts],
                         [("grain-north", 1), ("cloth-east", 4)])

    async def test_reactive_run_only_publishes_notices_when_due(self):
        response = await self.client.post("/api/runs", json={"scenario": "reactive_closure", "seed": 42})
        stream = list(map(json.loads, response.iter_lines()))
        self.assertEqual(stream[0]["seed"], 42)
        self.assertEqual(stream[0]["observation"]["notices"], [])
        self.assertTrue(any(event["type"] == "notice_published"
                            for step in stream if step["type"] == "decision"
                            for event in step["response"]["events"]))
        self.assertTrue(stream[-1]["result"]["complete"])

    async def test_baselines_and_validation(self):
        for policy, score in (("idle", 0), ("stop-early", 0.075)):
            with self.subTest(policy=policy):
                response = await self.client.post("/api/runs", json={"policy": policy})
                result = list(map(json.loads, response.iter_lines()))[-1]["result"]
                self.assertFalse(result["complete"])
                self.assertEqual(result["planner_score"], score)
        invalid = await self.client.post("/api/runs", json={"seed": True})
        self.assertEqual(invalid.status_code, 422)
