import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from src.ai_inspection.ai_inspector import main
from src.ai_inspection.claude_client import ClaudeAnalyzer, ClaudeAPIError
from src.ai_inspection.evidence_inspector import inspect_hybrid_input, build_evidence_request


class AnalysisModeTest(unittest.TestCase):
    # 네트워크 없는 CLI 통합 검증에 사용할 종류별 입력을 만든다.
    def write_input(self, root):
        source = root / "input.jsonl"
        source.write_text("\n".join(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": identifier,
                    "kind": kind, "url": "https://example.test/", "payload": {}}) for identifier, kind in
                    (("first", "navigation_failure"), ("second", "semantic_test_planning"))), encoding="utf-8")
        return source

    # SDK 대신 모의 API 본문을 반환해 과금 없이 사용량까지 검증한다.
    def api_response(self, analysis, stop="end_turn", tokens=20):
        return io.BytesIO(json.dumps({"model": "fixture-model", "id": "msg_fixture", "stop_reason": stop,
                "usage": {"input_tokens": tokens, "output_tokens": 10},
                "content": [{"type": "text", "text": json.dumps(analysis)}]}).encode())

    def test_analyze_two_kinds_records_usage_and_no_key_in_outputs(self):
        review = {"evidence_summary": "Observed", "possible_explanations": ["Automation limit"],
                  "needs_additional_verification": True, "suggested_checks": ["Review context"]}
        planning = {"page_summary": "Demo", "proposed_checks": ["Check navigation"], "open_questions": []}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            before = source.read_bytes()
            output = root / "output"
            with (patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fixture-secret-key"}), patch(
                    "src.ai_inspection.claude_client.urlopen", side_effect=[self.api_response(review), self.api_response(planning)]) as api,
                    patch("src.ai_inspection.browser_runner.verify_steps", side_effect=AssertionError("No browser")), contextlib.redirect_stdout(io.StringIO())):
                status = main(["--hybrid-input", str(source), "--analyze", "--limit", "2", "--model", "fixture-model",
                               "--max-tokens", "80", "--api-timeout", "5", "--output-dir", str(output)])
            self.assertEqual(status, 0)
            self.assertEqual(api.call_count, 2)
            sent = json.loads(api.call_args.args[0].data)
            self.assertEqual(sent["max_tokens"], 80)
            summary = json.loads((output / "evidence_batch.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["mode"], "analyze")
            self.assertEqual(summary["completed_count"], 2)
            self.assertEqual(summary["token_totals"], {"input_tokens": 40, "output_tokens": 20})
            self.assertEqual([item["input_id"] for item in summary["results"]], ["first", "second"])
            for path in output.iterdir():
                self.assertNotIn("fixture-secret-key", path.read_text(encoding="utf-8"))
            self.assertEqual(source.read_bytes(), before)

    def test_failed_response_preserves_usage_continues_and_returns_error(self):
        planning = {"page_summary": "Demo", "proposed_checks": [], "open_questions": []}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fixture-key"}), patch(
                    "src.ai_inspection.claude_client.urlopen", side_effect=[self.api_response({}, stop="max_tokens"), self.api_response(planning)]) as api, contextlib.redirect_stdout(io.StringIO()):
                status = main(["--hybrid-input", str(source), "--analyze", "--limit", "2", "--output-dir", str(root / "output")])
            summary = json.loads((root / "output/evidence_batch.json").read_text(encoding="utf-8"))
            self.assertEqual(status, 1)
            self.assertEqual(api.call_count, 2)
            self.assertEqual([item["analysis_status"] for item in summary["results"]], ["error", "completed"])
            self.assertEqual(summary["error_count"], 1)
            self.assertEqual(summary["usage_recorded_calls"], 2)

    def test_default_limit_is_one_and_prepare_never_constructs_client(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            with patch("src.ai_inspection.claude_client.ClaudeAnalyzer", side_effect=AssertionError("No analyzer")), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["--hybrid-input", str(source), "--prepare-only", "--output-dir", str(root / "output")]), 0)
            self.assertEqual(json.loads((root / "output/evidence_batch.json").read_text(encoding="utf-8"))["selected_count"], 1)

    def test_analysis_default_limit_and_invalid_contract_preserve_usage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            with (patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fixture-key"}),
                  patch("src.ai_inspection.claude_client.urlopen", return_value=self.api_response({"verdict": "confirmed"})) as api,
                  contextlib.redirect_stdout(io.StringIO())):
                status = main(["--hybrid-input", str(source), "--analyze", "--output-dir", str(root / "output")])
            summary = json.loads((root / "output/evidence_batch.json").read_text(encoding="utf-8"))
            self.assertEqual(status, 1)
            self.assertEqual(api.call_count, 1)
            self.assertEqual(summary["selected_count"], 1)
            self.assertEqual(summary["token_totals"], {"input_tokens": 20, "output_tokens": 10})
            self.assertNotIn("analysis", summary["results"][0])
            self.assertEqual(summary["results"][0]["error_type"], "ValueError")

    def test_invalid_input_and_unwritable_output_prevent_api_calls(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            source.write_text(source.read_text(encoding="utf-8") + "\nnot-json", encoding="utf-8")
            factory = Mock(side_effect=AssertionError("Must not construct"))
            with self.assertRaises(ValueError):
                inspect_hybrid_input(source, root / "output", analyzer_factory=factory)
            factory.assert_not_called()
            source = self.write_input(root)
            analyzer = Mock()
            with patch.object(Path, "write_text", side_effect=PermissionError("fixture output blocked")), self.assertRaises(PermissionError):
                inspect_hybrid_input(source, root / "output", analyzer=analyzer)
            analyzer.assert_not_called()

    def test_explicit_mode_positive_budgets_and_missing_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            base = ["--hybrid-input", str(source), "--output-dir", str(root / "output")]
            for flags in ([], ["--prepare-only", "--analyze"], ["--analyze", "--limit", "0"],
                          ["--analyze", "--max-tokens", "0"], ["--analyze", "--api-timeout", "nan"]):
                with self.subTest(flags=flags), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                    main(base + flags)
                self.assertEqual(error.exception.code, 2)
            with patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}), patch("src.ai_inspection.claude_client.urlopen") as api, contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                main(base + ["--analyze"])
            api.assert_not_called()

    def test_preflight_empty_input_and_output_collision_do_not_construct_analyzer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "ai_requests.jsonl"
            source.write_text("", encoding="utf-8")
            factory = Mock(side_effect=AssertionError("Must not construct"))
            with self.assertRaises(ValueError):
                inspect_hybrid_input(source, root, analyzer_factory=factory)
            source = root / "empty.jsonl"
            source.write_text("", encoding="utf-8")
            summary = inspect_hybrid_input(source, root / "output", analyzer_factory=factory)
            factory.assert_not_called()
            self.assertEqual(summary["analyzer_calls"], 0)

    def test_http_connection_and_timeout_do_not_retry_or_record_raw_error(self):
        request = build_evidence_request({"input_id": "one", "kind": "navigation_failure", "url": "https://example.test/", "payload": {}})
        for error in (HTTPError("https://example.test", 401, "fixture-secret", {}, None), URLError("fixture-secret"), TimeoutError("fixture-secret")):
            with self.subTest(error=type(error).__name__), patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fixture-key"}), patch(
                    "src.ai_inspection.claude_client.urlopen", side_effect=error) as api:
                client = ClaudeAnalyzer(model="fixture-model")
                client.last_usage = {"tokens": {"input_tokens": 999}}
                with self.assertRaises(ClaudeAPIError) as caught:
                    client(request)
                self.assertNotIn("fixture-secret", str(caught.exception))
                self.assertEqual(client.last_usage, {})
                self.assertEqual(api.call_count, 1)
