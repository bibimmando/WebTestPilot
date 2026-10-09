import json
import os
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest
import contextlib
import io
from unittest.mock import Mock
from unittest.mock import patch
from concurrent.futures import TimeoutError as FutureTimeout

from src.ai_inspection.inspection_input import adapt_inspection_context
from src.ai_inspection.inspection_runtime import RuntimeLimits, run_inspection
from src.ai_inspection.playwright_mcp_runtime import ScriptedPlanner, create, select_checks
from src.ai_inspection.playwright_mcp_runtime import PlaywrightMCPExecutor
from src.ai_inspection.mcp_client import LocalMCPClient
from src.ai_inspection.ai_inspector import main


CHECK = {"kind": "text_contains", "value": "typed pilot", "source": "requirement",
         "evidence_ref": "fixture: Enter echoes the test field"}


class CatalogTest(unittest.TestCase):
    # 내장 CLI의 모의 모드는 API 키나 유료 Planner를 생성하지 않는다.
    def test_builtin_cli_mock_mode_never_constructs_claude(self):
        from src.ai_inspection.test.test_inspection_runtime import RuntimeTest
        helper = RuntimeTest()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = helper.write_input(root)
            binding, _ = helper.binding()
            plans = root / "plans.json"
            plans.write_text("[]", encoding="utf-8")
            with patch("src.ai_inspection.claude_client.ClaudePlanner") as paid, patch(
                    "src.ai_inspection.playwright_mcp_runtime.create", return_value=binding) as factory, contextlib.redirect_stdout(io.StringIO()):
                code = main(["--hybrid-input", str(source), "--execute", "--runtime-config", "reviewed.json",
                             "--mock-plan", str(plans), "--output-dir", str(root / "out")])
            paid.assert_not_called()
            self.assertEqual(code, 0)
            self.assertEqual(factory.call_args.kwargs["config_path"], Path("reviewed.json"))

    # 알 수 없는 버전의 도구 규격은 추측하여 실행하지 않는다.
    def test_missing_or_changed_schema_is_rejected(self):
        executor = PlaywrightMCPExecutor.__new__(PlaywrightMCPExecutor)
        executor.client = Mock(tools={"browser_click": {"inputSchema": {
            "properties": {"ref": {"type": "string"}}, "required": ["ref"]}}})
        with self.assertRaises(ValueError):
            executor._discover_actions()

    # 등록된 행동과 테스트 값만 허용하고 다른 모델 입력은 차단한다.
    def test_permission_does_not_accept_new_values_or_controls(self):
        executor = PlaywrightMCPExecutor.__new__(PlaywrightMCPExecutor)
        executor.permissions = {"field": {"actions": ["fill", "press"], "values": ["pilot", "Enter"]}}
        self.assertTrue(executor.permission({"action": "fill", "control_id": "field", "value": "pilot"}))
        for step in ({"action": "fill", "control_id": "field", "value": "private"},
                     {"action": "click", "control_id": "field", "value": ""},
                     {"action": "fill", "control_id": "missing", "value": "pilot"}):
            self.assertFalse(executor.permission(step))

    # 타임아웃에는 대기 작업을 취소하고 세션을 닫아 추가 호출을 막는다.
    def test_timeout_cancels_and_closes_session_without_raw_errors(self):
        client = LocalMCPClient.__new__(LocalMCPClient)
        client._closed, client.timeout = False, 1
        client.tools = {"test": {"inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}}
        client._session, client._loop = Mock(), Mock()
        client.close = Mock()
        future = Mock()
        future.result.side_effect = FutureTimeout()
        with patch("asyncio.run_coroutine_threadsafe", return_value=future):
            with self.assertRaises(TimeoutError):
                client.call_tool("test", {})
        future.cancel.assert_called_once()
        client.close.assert_called_once()

    # 새 검증 항목이나 비정상 인자는 실제 MCP 호출 전에 거절한다.
    def test_arguments_are_validated_against_discovered_schema(self):
        client = LocalMCPClient.__new__(LocalMCPClient)
        client._closed = False
        client.tools = {"test": {"inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}}
        with patch("asyncio.run_coroutine_threadsafe") as call:
            with self.assertRaises(Exception):
                client.call_tool("test", {"unapproved": True})
            call.assert_not_called()

    # 다른 입력 ID와 불명확한 제안은 실행 검사로 승격하지 않는다.
    def test_only_exact_approved_suggestions_are_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "analysis.jsonl"
            source.write_text(json.dumps({"input_id": "one", "analysis_status": "completed",
                "analysis": {"suggested_checks": ["review input", "run arbitrary code"]}}), encoding="utf-8")
            config = {"checks": {"input": CHECK}, "suggestion_bindings": {"review input": "input"}}
            self.assertEqual(select_checks(config, {"input_id": "one"}, source), {"input": CHECK})
            with self.assertRaises(ValueError):
                select_checks(config, {"input_id": "another"}, source)
            config["suggestion_bindings"] = {}
            self.assertEqual(select_checks(config, {"input_id": "one"}, source), {})

    # 종료 계획과 모의 계획은 유료 호출 없이 제공된다.
    def test_mock_planner_finishes_without_api(self):
        self.assertEqual(ScriptedPlanner([])({})["decision"], "finish")


class FixtureHandler(BaseHTTPRequestHandler):
    mutations = 0

    # 로컬 테스트 서버의 요청 로그에 입력값을 출력하지 않는다.
    def log_message(self, *args):
        pass

    # 클릭·입력·키 동작과 차단할 POST를 제공하는 격리된 화면이다.
    def do_GET(self):
        html = b'''<!doctype html><title>MCP fixture</title>
          <button id="click" type="button" onclick="document.querySelector('#clicked').textContent='clicked';fetch('/mutate',{method:'POST'})">Read demo</button>
          <p id="clicked">initial</p><input id="field" aria-label="Test input"
            onkeydown="if(event.key==='Enter')document.querySelector('#typed').textContent='typed '+this.value">
          <p id="typed">waiting</p><input id="secret" type="password">'''
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(html)))
        self.end_headers()
        self.wfile.write(html)

    # POST가 실제 서버에 도착하면 가드 회귀로 집계한다.
    def do_POST(self):
        type(self).mutations += 1
        self.send_response(204)
        self.end_headers()


@unittest.skipUnless(os.environ.get("WEBTESTPILOT_MCP_TESTS") == "1", "real MCP tests are opt-in")
class RealMCPTest(unittest.TestCase):
    # 실제 서버·브라우저에서 세 동작과 같은 탭 재관찰·정리를 확인한다.
    def test_real_click_fill_press_and_feedback(self):
        FixtureHandler.mutations = 0
        server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        repo = Path(__file__).resolve().parents[6]
        url = f"http://127.0.0.1:{server.server_port}/"
        try:
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                record = {"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "mcp-fixture",
                          "kind": "semantic_test_planning", "url": url, "payload": {}}
                source = root / "input.jsonl"
                source.write_text(json.dumps(record) + "\n", encoding="utf-8")
                config = {"mcp_command": os.environ.get("WEBTESTPILOT_MCP_NODE", "node"),
                          "mcp_args": [str(repo / ".tools/playwright-mcp/node_modules/@playwright/mcp/cli.js")],
                          "timeout": 20, "controls": {"click": "#click", "field": "#field"},
                          "permissions": {"click": {"actions": ["click"], "values": []},
                                          "field": {"actions": ["fill", "press"], "values": ["pilot", "Enter"]}},
                          "checks": {"echo": CHECK}}
                config_path = root / "runtime.json"
                config_path.write_text(json.dumps(config), encoding="utf-8")
                plans = [{"decision": "act", "check_id": "echo", "steps": [
                    {"action": "click", "control_id": "click", "value": ""},
                    {"action": "fill", "control_id": "field", "value": "pilot"},
                    {"action": "press", "control_id": "field", "value": "Enter"}]},
                    {"decision": "finish", "check_id": "", "steps": []}]
                planner = Mock(side_effect=plans)
                planner.last_usage = {}
                # 연결 오류는 테스트에서 직접 드러내며 일반 실행 오류에 숨기지 않는다.
                binding = create(context=adapt_inspection_context(record), planner=planner,
                                 output_dir=root / "out", config_path=config_path)
                result = run_inspection(source, root / "out", runtime_factory=lambda context: binding,
                                        limits=RuntimeLimits(max_seconds=90))
                row = result["results"][0]
                self.assertEqual(row["execution_status"], "completed", row)
                self.assertEqual(row["judgments"][0]["status"], "passed")
                self.assertEqual([action["receipt"]["tool_name"] for action in row["actions"]],
                                 ["browser_click", "browser_type", "browser_press_key"])
                self.assertIn("typed pilot", planner.call_args_list[1].args[0]["context"]["page_observation"]["text"])
                self.assertEqual(FixtureHandler.mutations, 0)
                self.assertTrue(row["actions"][-1]["receipt"]["blocked_requests"])
                self.assertTrue(binding.executor._closed)
                self.assertIsNotNone(binding.executor.process.poll())
                self.assertTrue((root / "out/inspection_results.jsonl").is_file())
                for action in row["actions"]:
                    self.assertTrue(Path(action["after"]["evidence"][0]["path"]).is_file())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
