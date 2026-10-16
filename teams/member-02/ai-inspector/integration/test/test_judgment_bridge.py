"""No browser, network or paid model: exercise the existing staged call manager."""
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from integration.judgment.input_contract import ROOT
from integration.judgment_bridge import run_judgment
from integration.models import ScriptedModel
from integration import staged


class BridgeTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "examples/judge_input.v2.example.json").read_text(encoding="utf-8-sig"))
        self.reply = json.loads((ROOT / "examples/scenario_judgments.example.json").read_text(encoding="utf-8-sig"))
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.model = ScriptedModel([{"role": "assistant", "stop_reason": "tool_use", "content": [
            {"type": "tool_use", "id": "toolu-bridge", "name": "scenario_judgments", "input": self.reply}]}])
        self.runtime = SimpleNamespace(output=Path(self.directory.name), calls=0, max_calls=1, max_rounds=1,
            usage=[], judgment_model=self.model, model=self.model, persist=lambda *args: None)
        self.flow = {"flow_id": "bridge-flow", "rounds": 0, "messages": []}
        self.evidence = SimpleNamespace(collector=SimpleNamespace(_sanitize=lambda value: value))

    async def invoke(self):
        return await run_judgment(self.runtime, self.evidence, self.flow, self.payload, call=staged._call)

    async def test_call_manager_logs_id_usage_and_fresh_context(self):
        reply, identifier = await self.invoke()
        self.assertEqual(reply, self.reply)
        self.assertEqual(identifier, "toolu-bridge")
        self.assertEqual((self.runtime.calls, self.flow["rounds"]), (1, 1))
        self.assertEqual(self.runtime.usage[0]["stage"], "judgment")
        self.assertEqual(len(self.model.requests[0]["messages"]), 1)
        folder = self.runtime.output / "flows/bridge-flow"
        response = json.loads((folder / "judgment_response.json").read_text(encoding="utf-8"))
        self.assertEqual(response["tool_use_id"], identifier)

    async def test_call_and_round_limits_prevent_transport(self):
        for key in ("max_calls", "max_rounds"):
            setattr(self.runtime, key, 0)
            with self.assertRaises(staged.LimitReached):
                await self.invoke()
            setattr(self.runtime, key, 1)
        self.assertEqual(len(self.model.requests), 0)

    async def test_foreign_evidence_error_retains_received_id_and_usage(self):
        self.reply["judgments"][0]["snapshot_ids"] = ["foreign"]
        # ScriptedModel stores a copy at construction; update its response through a new fixture.
        self.runtime.judgment_model = ScriptedModel([{"role": "assistant", "stop_reason": "tool_use", "content": [
            {"type": "tool_use", "id": "toolu-invalid", "name": "scenario_judgments", "input": self.reply}]}])
        with self.assertRaises(staged.ResponseError) as caught:
            await self.invoke()
        self.assertEqual(caught.exception.tool_use_id, "toolu-invalid")
        self.assertEqual(self.runtime.calls, 1)
        self.assertEqual(len(self.runtime.usage), 1)

    async def test_policy_and_missing_ui_image_reject_conclusive_judgment(self):
        for index in (1, 3):
            reply = deepcopy(self.reply)
            reply["judgments"][index]["verdict"] = "passed"
            async def call(*args):
                return reply, "toolu-conclusive"
            with self.assertRaises(staged.ResponseError):
                await run_judgment(self.runtime, self.evidence, self.flow, self.payload, call=call)

    async def test_cancellation_uses_existing_usage_finally(self):
        class CancelledModel:
            last_usage = {"input_tokens": 3}
            async def complete(self, *args):
                raise asyncio.CancelledError()
        self.runtime.judgment_model = CancelledModel()
        with self.assertRaises(asyncio.CancelledError):
            await self.invoke()
        self.assertEqual(self.runtime.calls, 1)
        self.assertEqual(self.runtime.usage[0]["input_tokens"], 3)
