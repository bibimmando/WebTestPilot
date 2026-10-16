import asyncio
from copy import deepcopy
import json
import unittest
from unittest.mock import AsyncMock

from src.ai_inspection.judgment.async_adapter import JudgmentValidationError, judge_async
from src.ai_inspection.judgment.input_contract import ROOT


class AsyncAdapterTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "examples/judge_input.v2.example.json").read_text(encoding="utf-8-sig"))
        self.reply = json.loads((ROOT / "examples/scenario_judgments.example.json").read_text(encoding="utf-8-sig"))

    async def test_native_id_and_single_call_are_preserved(self):
        call = AsyncMock(return_value=(self.reply, "toolu-real-1"))
        result, identifier = await judge_async(self.payload, call=call)
        self.assertEqual(result, self.reply)
        self.assertEqual(identifier, "toolu-real-1")
        self.assertEqual(call.await_count, 1)
        request = call.call_args.args[0]
        content = json.loads(request["messages"][0]["content"][0]["text"])
        self.assertEqual(content["scenarios"], self.payload["scenarios"])

    async def test_response_rejection_retains_tool_id(self):
        reply = deepcopy(self.reply)
        reply["judgments"][0]["snapshot_ids"] = ["outside"]
        call = AsyncMock(return_value=(reply, "toolu-rejected"))
        with self.assertRaises(JudgmentValidationError) as caught:
            await judge_async(self.payload, call=call)
        self.assertEqual(caught.exception.tool_use_id, "toolu-rejected")
        self.assertEqual(call.await_count, 1)

    async def test_invalid_input_and_empty_scenarios_do_not_call_transport(self):
        call = AsyncMock()
        payload = deepcopy(self.payload)
        payload["schema_version"] = "unknown"
        with self.assertRaises(JudgmentValidationError):
            await judge_async(payload, call=call)
        payload = deepcopy(self.payload)
        payload["scenarios"] = []
        self.assertEqual(await judge_async(payload, call=call), ({"judgments": []}, None))
        call.assert_not_awaited()

    async def test_cancellation_and_transport_errors_propagate_without_retry(self):
        for error in (asyncio.CancelledError(), TimeoutError("synthetic timeout")):
            call = AsyncMock(side_effect=error)
            with self.assertRaises(type(error)):
                await judge_async(self.payload, call=call)
            self.assertEqual(call.await_count, 1)

    async def test_missing_tool_id_is_rejected(self):
        with self.assertRaises(JudgmentValidationError):
            await judge_async(self.payload, call=AsyncMock(return_value=(self.reply, None)))
