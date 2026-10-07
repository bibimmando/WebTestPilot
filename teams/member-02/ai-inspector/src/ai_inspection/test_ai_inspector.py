from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from src.ai_inspection.ai_inspector import build_ai_request, inspect_page, inspect_preprocessed, validate_analysis
from src.ai_inspection.claude_client import ClaudeAnalyzer
from src.ai_inspection.inspection_input import compact_candidate, entry_url, select_candidates


class PreprocessedInputTest(unittest.TestCase):
    def candidate(self, **updates):
        candidate = {"id": "test", "kind": "endpoint", "method": "GET", "priority_score": 5,
                     "origin": "https://example.test", "url_pattern": "/form",
                     "source_pages": ["https://example.test/", "https://example.test/form"]}
        return {**candidate, **updates}

    def test_selection_and_entry_page_resolution(self):
        first, second = self.candidate(), self.candidate(id="higher", priority_score=8)
        data = {"schema_version": 1, "start_url": "https://example.test/", "candidates": [first, second]}
        self.assertEqual(select_candidates(data)[0]["id"], "higher")
        self.assertEqual(select_candidates(data, candidate_id="test"), [first])
        self.assertEqual(entry_url(first, data["start_url"]), "https://example.test/form")
        self.assertEqual(entry_url(self.candidate(method="POST", url_pattern="/api/save"), data["start_url"]), "https://example.test/")
        self.assertEqual(entry_url(self.candidate(url_pattern="/items/{integer}"), data["start_url"]), "https://example.test/")
        with self.assertRaises(ValueError):
            entry_url(self.candidate(source_pages=["https://other.test/"]), data["start_url"])
        with self.assertRaises(ValueError):
            select_candidates({**data, "candidates": [first, first]})
        with self.assertRaises(ValueError):
            select_candidates({**data, "schema_version": 2})

    def test_empty_input_and_per_candidate_failure(self):
        data = {"schema_version": 1, "start_url": "https://example.test/", "candidates": []}
        with tempfile.TemporaryDirectory() as directory, patch("src.ai_inspection.ai_inspector.inspect_page") as browser:
            summary = inspect_preprocessed(data, Path(directory))
            self.assertEqual(summary["ai_calls"], 0)
            browser.assert_not_called()
            data["candidates"] = [self.candidate(source_pages=[])]
            summary = inspect_preprocessed(data, Path(directory))
            self.assertEqual(summary["results"][0]["analysis_status"], "error")
            self.assertEqual(summary["results"][0]["candidate_id"], "test")
            browser.assert_not_called()

    def test_candidate_context_is_bounded(self):
        context = compact_candidate(self.candidate(label="x" * 2000, priority_reasons=["y" * 1000] * 20))
        self.assertEqual(len(context["label"]), 500)
        self.assertEqual(len(context["priority_reasons"]), 10)
        self.assertNotIn("source_pages", context)


def plan():
    return {
        "page_summary": "A task input page", "open_questions": [],
        "proposed_checks": [{
            "check_id": "add_task", "category": "functional", "objective": "Add a task",
            "steps": [{"action": "fill", "control_id": "input", "value": "Example task"}],
        }],
    }


class InspectorContractTest(unittest.TestCase):
    def test_unknown_control_and_script_action_are_rejected(self):
        for action, control in (("click", "invented"), ("evaluate", "input")):
            with self.subTest(action=action, control=control):
                data = plan()
                data["proposed_checks"][0]["steps"][0].update(action=action, control_id=control)
                with self.assertRaises(ValueError):
                    validate_analysis(data, {"input"})

    def test_verdict_and_excessive_plan_are_rejected(self):
        data = plan()
        data["verdict"] = "bug"
        with self.assertRaises(ValueError):
            validate_analysis(data, {"input"})
        data = plan()
        data["proposed_checks"][0]["steps"] *= 11
        with self.assertRaises(ValueError):
            validate_analysis(data, {"input"})

    def test_ai_request_does_not_include_screenshot_or_selectors(self):
        observation = {
            "url": "http://example.test/", "title": "Demo", "text_excerpt": "Task",
            "controls": [{"control_id": "input", "selector": "#task", "label": "Task"}],
            "controls_omitted": 0, "console_errors": [], "request_failures": [],
            "network_responses": [], "screenshot": "/local/initial.png",
        }
        request = build_ai_request(observation, "Inspect the task input")
        self.assertNotIn("selector", request["page"]["controls"][0])
        self.assertNotIn("screenshot", request["page"])
        self.assertEqual(request["page"]["controls"][0]["control_id"], "input")


class ClaudeAdapterTest(unittest.TestCase):
    def test_single_call_uses_schema_and_preserves_usage(self):
        response = {
            "id": "msg_fixture", "model": "test-model", "stop_reason": "end_turn",
            "usage": {"input_tokens": 40, "output_tokens": 20},
            "content": [{"type": "text", "text": json.dumps(plan())}],
        }
        request = {"system": "Plan", "task": "Inspect", "page": {"controls": [{"control_id": "input"}]},
                   "candidate": {"id": "selected", "priority_score": 5}}
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), patch(
            "src.ai_inspection.claude_client.urlopen", return_value=io.BytesIO(json.dumps(response).encode())
        ) as mocked:
            client = ClaudeAnalyzer(model="test-model")
            self.assertEqual(client(request), plan())
            payload = json.loads(mocked.call_args.args[0].data)
            self.assertEqual(payload["model"], "test-model")
            self.assertEqual(payload["output_config"]["format"]["type"], "json_schema")
            self.assertEqual(json.loads(payload["messages"][0]["content"])["candidate"]["id"], "selected")
            self.assertEqual(mocked.call_count, 1)
            self.assertEqual(client.last_usage["tokens"]["input_tokens"], 40)

    def test_truncated_response_is_not_executed(self):
        response = {"stop_reason": "max_tokens", "usage": {}, "content": []}
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), patch(
            "src.ai_inspection.claude_client.urlopen", return_value=io.BytesIO(json.dumps(response).encode())
        ):
            with self.assertRaises(ValueError):
                ClaudeAnalyzer()({"system": "Plan", "task": "Inspect", "page": {"controls": []}})


@unittest.skipUnless(os.environ.get("WEBTESTPILOT_BROWSER_TESTS") == "1", "Set WEBTESTPILOT_BROWSER_TESTS=1 for real-browser integration")
class InspectorBrowserTest(unittest.TestCase):
    def test_local_page_actions_and_evidence_without_a_verdict(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/next":
                    body = b"<html><head><title>Next</title></head><body>Next page</body></html>"
                elif self.path == "/api/ping":
                    body = b'{"ok":true}'
                else:
                    body = b'''<html><head><title>Task demo</title></head><body>
                    <label for="task">Task</label><input id="task" required>
                    <button id="add" onclick="document.querySelector('#items').textContent=document.querySelector('#task').value">Add task</button>
                    <ul id="items"></ul><a href="/next">Next page</a>
                    <script>console.error('fixture error');fetch('/api/ping')</script>
                    </body></html>'''
                self.send_response(200)
                self.send_header("Content-Type", "application/json" if self.path == "/api/ping" else "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def fixture_analyzer(request):
                controls = {c["label"]: c["control_id"] for c in request["page"]["controls"]}
                return {
                    "page_summary": "Task entry and navigation", "open_questions": [],
                    "proposed_checks": [{
                        "check_id": "add_task", "category": "functional", "objective": "Enter a task",
                        "steps": [
                            {"action": "fill", "control_id": controls["Task"], "value": "Example task"},
                            {"action": "click", "control_id": controls["Add task"], "value": None},
                        ],
                    }, {
                        "check_id": "navigate", "category": "navigation", "objective": "Follow the next link",
                        "steps": [{"action": "click", "control_id": controls["Next page"], "value": None}],
                    }],
                }

            with tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary)
                result = inspect_page(
                    f"http://127.0.0.1:{server.server_port}/", output,
                    analyzer=fixture_analyzer, execute_checks=True,
                )
                self.assertEqual(result["analysis_status"], "completed")
                self.assertTrue(all(item["execution_status"] == "completed" for item in result["executions"]))
                self.assertIn("Example task", result["executions"][0]["observation"]["text_excerpt"])
                self.assertEqual(result["executions"][1]["observation"]["title"], "Next")
                self.assertTrue(result["observation"]["network_responses"])
                self.assertTrue((output / "initial.png").exists())
                self.assertTrue((output / "check_1.png").exists())
                self.assertNotIn("verdict", result)
                self.assertEqual(json.loads((output / "inspection.json").read_text(encoding="utf-8"))["analysis_status"], "completed")
                url = f"http://127.0.0.1:{server.server_port}/"
                candidate = {"id": "task_input", "kind": "interaction", "selector": "#task",
                             "source_pages": [url], "priority_score": 5,
                             "execution_policy": "review_required", "risk_flags": ["unknown_input_effect"]}
                requests = []

                def focused_analyzer(request):
                    requests.append(request)
                    return fixture_analyzer(request)

                data = {"schema_version": 1, "start_url": url, "candidates": [candidate]}
                summary = inspect_preprocessed(data, output / "batch", analyzer=focused_analyzer, execute_checks=True)
                self.assertEqual(summary["ai_calls"], 1)
                self.assertEqual(requests[0]["candidate"]["mapping_status"], "matched")
                self.assertTrue(requests[0]["candidate"]["control_ids"])
                saved = json.loads(Path(summary["results"][0]["inspection_file"]).read_text(encoding="utf-8"))
                self.assertEqual(saved["candidate_id"], "task_input")
                self.assertEqual(saved["executions"], [])
                self.assertIn("execution_blocked_reason", saved)
                result = inspect_page(url, output / "reviewed", candidate=candidate,
                                      analyzer=focused_analyzer, execute_checks=True, allow_reviewed_actions=True)
                self.assertEqual(result["executions"][0]["candidate_id"], "task_input")
                candidate["selector"] = "#removed"
                summary = inspect_preprocessed(data, output / "stale", analyzer=focused_analyzer)
                self.assertEqual(summary["ai_calls"], 0)
                self.assertEqual(summary["results"][0]["analysis_status"], "skipped")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
