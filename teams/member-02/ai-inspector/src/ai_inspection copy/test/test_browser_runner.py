from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading
import unittest

from src.ai_inspection.browser_runner import validate_steps, verify_steps


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
