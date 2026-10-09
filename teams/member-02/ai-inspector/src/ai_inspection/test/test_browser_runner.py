from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading
import unittest

from src.ai_inspection.browser_runner import SharedPageObserver, validate_steps, verify_steps


class RunnerContractTest(unittest.TestCase):
    def test_authorization_before_browser_import(self):
        with self.assertRaises(ValueError):
            verify_steps("https://example.test/", Path("unused"), input_id="one", controls={}, steps=[])

    def test_unknown_control_script_and_excess_steps_rejected(self):
        for steps in ([{"action": "click", "control_id": "unknown"}],
                      [{"action": "evaluate", "control_id": "field"}],
                      [{"action": "press", "control_id": "field", "value": "F12"}],
                      [{"action": "click", "control_id": "field"}] * 11):
            with self.subTest(steps=steps), self.assertRaises(ValueError):
                validate_steps({"field": "#field"}, steps)


@unittest.skipUnless(os.environ.get("WEBTESTPILOT_BROWSER_TESTS") == "1", "Enable local browser test explicitly")
class RunnerBrowserTest(unittest.TestCase):
    def test_runtime_observes_and_executes_on_the_same_local_tab(self):
        import json
        from playwright.sync_api import sync_playwright
        from src.ai_inspection.browser_runner import _installed_browser
        from src.ai_inspection.inspection_runtime import RuntimeBinding, run_inspection
        from src.ai_inspection.mcp_executor import MCPExecutor
        with tempfile.TemporaryDirectory() as temporary, sync_playwright() as playwright:
            root = Path(temporary)
            browser = playwright.chromium.launch(headless=True, executable_path=_installed_browser())
            try:
                page = browser.new_page()
                url = "http://127.0.0.1/runtime-fixture"
                # Fulfill locally: no website or external network is contacted.
                page.route(url, lambda route: route.fulfill(body='''<title>Runtime fixture</title>
                    <button id="save" onclick="document.querySelector('#result').textContent='saved'">Save</button>
                    <div id="result">initial</div>''', content_type="text/html"))
                page.goto(url)
                source = root / "input.jsonl"
                source.write_text(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "local-tab",
                    "kind": "semantic_test_planning", "url": url, "payload": {}}), encoding="utf-8")
                plans = iter([{"decision": "act", "check_id": "save", "steps": [
                    {"action": "click", "control_id": "save", "value": ""}]},
                    {"decision": "finish", "check_id": "", "steps": []}])
                # A fake MCP dispatcher executes a real browser click, not a real MCP server.
                def call_tool(name, args):
                    page.locator(args["selector"]).click()
                    return {"isError": False}
                observer = SharedPageObserver(page, root / "evidence")
                executor = MCPExecutor(call_tool=call_tool, observe=observer, permission=lambda step: True,
                    action_bindings={"click": ("fixture_click", lambda step: {"selector": "#save"})})
                check = {"kind": "text_contains", "value": "saved", "source": "requirement", "evidence_ref": "fixture:save"}
                binding = RuntimeBinding(lambda request: next(plans), executor, {"save": "#save"},
                                         {"save": check}, (url,), lambda step: True)
                result = run_inspection(source, root / "output", runtime_factory=lambda context: binding)
                row = result["results"][0]
                self.assertEqual(row["execution_status"], "completed")
                self.assertEqual(row["judgments"][0]["status"], "passed")
                self.assertIn("initial", row["actions"][0]["before"]["text"])
                self.assertIn("saved", row["actions"][0]["after"]["text"])
                self.assertTrue(Path(row["actions"][0]["after"]["evidence"][0]["path"]).is_file())
                self.assertFalse(page.is_closed())
            finally:
                browser.close()

    def test_observer_uses_existing_page_and_records_viewport_and_truncation(self):
        from playwright.sync_api import sync_playwright
        from src.ai_inspection.browser_runner import _installed_browser
        with tempfile.TemporaryDirectory() as temporary, sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=_installed_browser())
            try:
                page = browser.new_page(viewport={"width": 390, "height": 844})
                page.set_content("<title>Shared</title><body>long observation text</body>")
                observer = SharedPageObserver(page, Path(temporary), max_text_characters=4)
                first = observer()
                second = observer()
                self.assertEqual(first["text"], "long")
                self.assertTrue(first["text_truncated"])
                self.assertEqual(first["viewport"]["width"], 390)
                self.assertEqual(first["url"], page.url)
                self.assertNotEqual(first["evidence"][0]["path"], second["evidence"][0]["path"])
                self.assertTrue(Path(first["evidence"][0]["path"]).is_file())
                self.assertFalse(page.is_closed())
            finally:
                browser.close()

    def test_local_actions_trace_and_post_block(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b'''<title>Demo</title><input id="field"><button id="add"
                  onclick="document.querySelector('#items').textContent=document.querySelector('#field').value;fetch('/save',{method:'POST'}).catch(()=>{})">Add</button><div id="items"></div>''')

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                result = verify_steps(f"http://127.0.0.1:{server.server_port}/", Path(temporary), input_id="one",
                                      controls={"field": "#field", "add": "#add"}, allow_actions=True,
                                      steps=[{"action": "fill", "control_id": "field", "value": "demo task"},
                                             {"action": "click", "control_id": "add"}])
                self.assertEqual(result["execution_status"], "completed")
                self.assertEqual(result["input_id"], "one")
                self.assertIn("demo task", result["observation"]["text_excerpt"])
                self.assertTrue(result["blocked_requests"])
                self.assertTrue(Path(result["observation"]["screenshot"]).is_file())
                self.assertNotIn("value", result["steps"][0])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
