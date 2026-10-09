"""JSONL CLI and mocked Claude transport contract tests."""

import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.ai_inspection.ai_inspector import main
from src.ai_inspection.claude_client import ClaudeAnalyzer, ClaudeAPIError
from src.ai_inspection.evidence_inspector import build_evidence_request


class InspectorCLITest(unittest.TestCase):
    def test_prepare_only_without_api_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "input.jsonl"
            source.write_text(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "one",
                "kind": "navigation_failure", "url": "https://example.test/", "payload": {}}), encoding="utf-8")
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--hybrid-input", str(source), "--prepare-only", "--limit", "1",
                                       "--output-dir", str(Path(temporary) / "output")]), 0)

    def test_removed_url_ranked_and_browser_options_are_rejected(self):
        base = ["--hybrid-input", "unused.jsonl", "--prepare-only", "--output-dir", "unused"]
        for extra in (["https://example.test/"], ["--input", "ranked.json"], ["--observe-only"],
                      ["--execute-checks"], ["--top", "3"]):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                main(base + extra)
            self.assertEqual(error.exception.code, 2)


class ClaudeAdapterTest(unittest.TestCase):
    def test_hybrid_request_schema_and_usage_with_mock_only(self):
        analysis = {"evidence_summary": "Download", "possible_explanations": ["Expected download"],
                    "needs_additional_verification": True, "suggested_checks": ["Check download event"]}
        response = {"id": "msg_fixture", "model": "test-model", "stop_reason": "end_turn",
                    "usage": {"input_tokens": 40, "output_tokens": 20},
                    "content": [{"type": "text", "text": json.dumps(analysis)}]}
        request = build_evidence_request({"input_id": "one", "kind": "navigation_failure",
                                         "url": "https://example.test/", "payload": {"error": "Download"}})
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), patch(
                "src.ai_inspection.claude_client.urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as api:
            client = ClaudeAnalyzer(model="test-model")
            self.assertEqual(client(request), analysis)
            payload = json.loads(api.call_args.args[0].data)
            content = json.loads(payload["messages"][0]["content"])
            self.assertEqual(content["input_id"], "one")
            self.assertNotIn("page", content)
            self.assertEqual(payload["output_config"]["format"]["schema"]["properties"]["needs_additional_verification"]["type"], "boolean")
            self.assertEqual(api.call_count, 1)
            self.assertEqual(client.last_usage["tokens"]["input_tokens"], 40)

    def test_truncation_rejected_and_missing_key_does_not_connect(self):
        request = build_evidence_request({"input_id": "one", "kind": "semantic_test_planning",
                                         "url": "https://example.test/", "payload": {}})
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}), self.assertRaises(ValueError):
            ClaudeAnalyzer()
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), patch(
                "src.ai_inspection.claude_client.urlopen",
                return_value=io.BytesIO(b'{"stop_reason":"max_tokens","usage":{},"content":[]}')):
            with self.assertRaises(ClaudeAPIError):
                ClaudeAnalyzer(model="test-model")(request)
