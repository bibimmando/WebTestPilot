import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen

from src.ai_inspection.playwright_mcp_runtime import action_arguments, load_config, PlaywrightMCPExecutor
from src.ai_inspection.inspection_runtime import RuntimeBinding, run_inspection


class MCPConfigTest(unittest.TestCase):
    def test_remote_endpoint_and_unregistered_permission_rejected(self):
        config = {"cdp_endpoint": "http://127.0.0.1:9222", "controls": {"save": "#save"},
                  "checks": {"save": {"kind": "text_contains", "value": "saved", "source": "requirement", "evidence_ref": "fixture"}},
                  "allowed_origins": ["http://localhost:8080"], "permissions": {"save": ["click"]}}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "config.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            self.assertEqual(load_config(path), config)
            for changes in ({"cdp_endpoint": "http://example.com:9222"}, {"permissions": {"unknown": ["click"]}}):
                path.write_text(json.dumps({**config, **changes}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_config(path)

    def test_action_values_are_literals_and_arbitrary_code_rejected(self):
        value = '\"); process.exit(); //'
        arguments = action_arguments("#field", {"action": "fill", "control_id": "field", "value": value})
        self.assertEqual(arguments["text"], value)
        self.assertNotIn("code", arguments)
        with self.assertRaises(ValueError):
            action_arguments("#field", {"action": "evaluate", "control_id": "field", "value": "alert(1)"})


@unittest.skipUnless(os.environ.get("WEBTESTPILOT_MCP_TESTS") == "1", "Enable real local MCP test explicitly")
class RealMCPTest(unittest.TestCase):
    def test_real_stdio_mcp_same_tab_actions_evidence_and_judgment(self):
        from src.ai_inspection.browser_runner import _installed_browser

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'''<title>Local MCP fixture</title><input id="field"><button id="save"
                    onclick="document.querySelector('#result').textContent='saved:'+document.querySelector('#field').value">Save</button>
                    <div id="result">initial</div>'''
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cdp_port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{server.server_port}/"
        endpoint = f"http://127.0.0.1:{cdp_port}"
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                executable = _installed_browser()
                if not executable:
                    self.fail("Install Chrome or Edge for the real MCP test")
                browser = subprocess.Popen([executable, "--headless=new", "--no-first-run", "--no-default-browser-check",
                    "--disable-background-networking", f"--remote-debugging-port={cdp_port}",
                    "--remote-debugging-address=127.0.0.1", f"--user-data-dir={root / 'profile'}", url],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                try:
                    for _ in range(100):
                        try:
                            with urlopen(endpoint + "/json/version", timeout=0.2):
                                break
                        except OSError:
                            time.sleep(0.1)
                    else:
                        self.fail("Local CDP browser did not start")
                    config = {"cdp_endpoint": endpoint, "controls": {"field": "#field", "save": "#save"},
                        "checks": {"save": {"kind": "text_contains", "value": "saved:hello", "source": "requirement", "evidence_ref": "fixture:save"}},
                        "allowed_origins": [url], "permissions": {"field": ["fill", "press"], "save": ["click"]}}
                    plans = iter([{"decision": "act", "check_id": "save", "steps": [
                        {"action": "fill", "control_id": "field", "value": "hello"},
                        {"action": "press", "control_id": "field", "value": "Tab"},
                        {"action": "click", "control_id": "save", "value": ""}]},
                        {"decision": "finish", "check_id": "", "steps": []}])
                    source = root / "input.jsonl"
                    source.write_text(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "real-mcp-local",
                        "kind": "semantic_test_planning", "url": url, "payload": {}}), encoding="utf-8")
                    server_js = Path("tmp/playwright_mcp/node_modules/@playwright/mcp/cli.js").resolve()
                    def factory(context):
                        executor = PlaywrightMCPExecutor(config, root / "output", command=shutil.which("node"),
                                                        server_args=[str(server_js)])
                        # Refused before any MCP action, even if caller bypasses runtime validation.
                        with self.assertRaises(PermissionError):
                            executor.execute({"action": "fill", "control_id": "save", "value": "denied"})
                        with self.assertRaises(ValueError):
                            executor.execute({"action": "press", "control_id": "field", "value": "Enter"})
                        return RuntimeBinding(lambda request: next(plans), executor, config["controls"], config["checks"],
                                              (url,), executor._permission)
                    result = run_inspection(source, root / "output", runtime_factory=factory)
                    self.assertEqual(result["results"][0]["execution_status"], "completed", result)
                    self.assertEqual(result["action_count"], 3)
                    self.assertEqual(result["results"][0]["judgments"][0]["status"], "passed")
                    for action in result["results"][0]["actions"]:
                        self.assertTrue(Path(action["before"]["evidence"][0]["path"]).is_file())
                        self.assertTrue(Path(action["after"]["evidence"][0]["path"]).is_file())
                    # Connector cleanup must leave the owner's browser alive.
                    with urlopen(endpoint + "/json/version", timeout=2) as response:
                        self.assertEqual(response.status, 200)
                finally:
                    browser.terminate()
                    browser.wait(timeout=10)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)
