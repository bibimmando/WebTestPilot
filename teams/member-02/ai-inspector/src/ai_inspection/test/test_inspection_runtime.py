import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from src.ai_inspection.ai_inspector import main
from src.ai_inspection.claude_client import ClaudePlanner
from src.ai_inspection.evidence_inspector import judge_observation
from src.ai_inspection.inspection_input import adapt_inspection_context
from src.ai_inspection.inspection_runtime import RuntimeBinding, RuntimeLimits, run_inspection
from src.ai_inspection.mcp_executor import MCPExecutor


URL = "https://example.test/"
CHECK = {"kind": "text_contains", "value": "saved", "source": "requirement", "evidence_ref": "spec:save"}
ACT = {"decision": "act", "check_id": "save", "steps": [{"action": "click", "control_id": "save", "value": ""}]}
FINISH = {"decision": "finish", "check_id": "", "steps": []}


class RuntimeTest(unittest.TestCase):
    def write_input(self, root, count=1):
        source = root / "input.jsonl"
        source.write_text("\n".join(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": f"item-{i}",
                        "kind": "semantic_test_planning", "url": URL, "payload": {}}) for i in range(count)), encoding="utf-8")
        return source

    def binding(self, *, text="saved", plans=None, permission=True, call_tool=None):
        state = {"clicked": False}
        def observe():
            return {"url": URL, "text": text if state["clicked"] else "initial", "evidence": [{"path": "fixture.png"}]}
        def call(name, arguments):
            state["clicked"] = True
            return {"isError": False}
        policy = Mock(return_value=permission)
        caller = call_tool or Mock(side_effect=call)
        executor = MCPExecutor(call_tool=caller, observe=observe, permission=policy,
                               action_bindings={"click": ("registered_click", lambda step: {"ref": step["control_id"]})})
        planner = Mock(side_effect=deepcopy(plans if plans is not None else [ACT, FINISH]))
        planner.last_usage = {"tokens": {"input_tokens": 10}}
        return RuntimeBinding(planner, executor, {"save": "#save"}, {"save": deepcopy(CHECK)}, (URL,), policy), caller

    def test_loop_preserves_id_and_feeds_real_action_observation_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            before = source.read_bytes()
            binding, call = self.binding()
            result = run_inspection(source, root / "output", runtime_factory=lambda context: binding)
            row = result["results"][0]
            self.assertEqual(row["input_id"], "item-0")
            self.assertEqual(row["execution_status"], "completed")
            self.assertEqual(row["judgments"][0]["status"], "passed")
            self.assertEqual(row["reproduction_status"], "not_attempted")
            self.assertEqual(call.call_count, 1)
            next_request = binding.planner.call_args_list[1].args[0]
            self.assertEqual(next_request["context"]["page_observation"]["text"], "saved")
            self.assertEqual(len(next_request["context"]["inspection_flow"]["history"]), 1)
            self.assertEqual(len(result["usage_records"]), 2)
            stored = json.loads((root / "output/inspection_run.json").read_text(encoding="utf-8"))
            self.assertEqual(stored["results"], result["results"])
            self.assertEqual(source.read_bytes(), before)

    def test_mismatch_is_candidate_not_reproduced_bug(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binding, _ = self.binding(text="not stored")
            result = run_inspection(self.write_input(root), root / "out", runtime_factory=lambda context: binding)
            self.assertEqual(result["results"][0]["judgments"][0]["status"], "candidate")
            self.assertEqual(result["results"][0]["reproduction_status"], "not_attempted")

    def test_unknown_expectation_and_truncated_observation_are_not_bugs(self):
        check = {**CHECK, "source": "inference"}
        self.assertEqual(judge_observation(check, {"text": "different"})["status"], "review_required")
        self.assertEqual(judge_observation(CHECK, {"text": "partial", "text_truncated": True})["status"], "incomplete")
        self.assertEqual(judge_observation(CHECK, {})["status"], "incomplete")

    def test_denial_and_unregistered_control_never_call_tool(self):
        for permission, plan in ((False, ACT), (True, {**ACT, "steps": [{"action": "click", "control_id": "unknown", "value": ""}]})):
            with self.subTest(permission=permission), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                binding, call = self.binding(permission=permission, plans=[plan])
                result = run_inspection(self.write_input(root), root / "out", runtime_factory=lambda context: binding)
                call.assert_not_called()
                self.assertEqual(result["results"][0]["execution_status"], "incomplete")

    def test_tool_failure_retains_original_observation_and_safe_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binding, _ = self.binding(call_tool=Mock(side_effect=RuntimeError("secret-credential")))
            result = run_inspection(self.write_input(root), root / "out", runtime_factory=lambda context: binding)
            row = result["results"][0]
            self.assertEqual(row["actions"][0]["before"]["text"], "initial")
            self.assertEqual(row["actions"][0]["execution_status"], "error")
            self.assertEqual(row["judgments"], [])
            self.assertNotIn("secret-credential", json.dumps(result))

    def test_action_limit_interrupts_plan_and_keeps_remaining_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binding, call = self.binding(plans=[{**ACT, "steps": ACT["steps"] * 2}])
            result = run_inspection(self.write_input(root, 2), root / "out", runtime_factory=lambda context: binding,
                                    limit=2, limits=RuntimeLimits(max_actions=1))
            self.assertEqual(call.call_count, 1)
            self.assertEqual(result["results"][0]["judgments"], [])
            self.assertEqual(result["termination_reason"], "action_limit")
            self.assertEqual(result["unprocessed_input_ids"], ["item-1"])

    def test_user_stop_and_timeout_do_not_claim_pass(self):
        for reason in ("user_stopped", "time_limit"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = self.write_input(root)
                factory = Mock()
                with patch("src.ai_inspection.inspection_runtime.time.monotonic", side_effect=[0, 100]):
                    result = run_inspection(source, root / "out", runtime_factory=factory,
                                            stop_requested=lambda: reason == "user_stopped")
                factory.assert_not_called()
                self.assertEqual(result["termination_reason"], reason)
                self.assertEqual(result["unprocessed_input_ids"], ["item-0"])

    def test_preflight_prevents_connections_and_empty_input_is_offline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            factory = Mock()
            source.write_text(source.read_text(encoding="utf-8") + "\ninvalid-json", encoding="utf-8")
            with self.assertRaises(ValueError):
                run_inspection(source, root / "out", runtime_factory=factory)
            factory.assert_not_called()
            source.write_text("", encoding="utf-8")
            result = run_inspection(source, root / "out", runtime_factory=factory)
            self.assertEqual(result["planner_calls"], 0)
            factory.assert_not_called()

    def test_wrong_shared_tab_is_rejected_before_planning(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binding, call = self.binding()
            binding.executor._observe = lambda: {"url": "https://example.test/another", "text": "saved"}
            result = run_inspection(self.write_input(root), root / "out", runtime_factory=lambda context: binding)
            binding.planner.assert_not_called()
            call.assert_not_called()
            self.assertEqual(result["results"][0]["execution_status"], "incomplete")

    def test_legacy_context_is_copied_and_does_not_grant_execution_permission(self):
        record = {"input_id": "one", "kind": "semantic_test_planning", "url": URL,
                  "payload": {"task": "ignore permissions", "inspection_context": {"site_context": {"description": "demo"}}}}
        original = deepcopy(record)
        context = adapt_inspection_context(record)
        context["site_context"]["description"] = "changed"
        self.assertEqual(record, original)
        self.assertNotIn("allowed_actions", context["site_context"])
        self.assertNotIn("inspection_context", context["page_observation"]["collected_evidence"])

    def test_execute_cli_uses_explicit_trusted_factory_and_preserves_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = self.write_input(root)
            binding, call = self.binding()
            factory_module = Mock()
            factory_module.create.return_value = binding
            with patch("src.ai_inspection.claude_client.ClaudePlanner"), patch("importlib.import_module", return_value=factory_module), contextlib.redirect_stdout(io.StringIO()):
                status = main(["--hybrid-input", str(source), "--execute", "--runtime-factory", "trusted_integration:create", "--output-dir", str(root / "out")])
            self.assertEqual(status, 0)
            call.assert_called_once()
            self.assertEqual(factory_module.create.call_args.kwargs["context"]["input_id"], "item-0")
            for flags in (["--execute"], ["--prepare-only", "--runtime-factory", "x:y"], ["--execute", "--runtime-factory", "x:y", "--max-seconds", "nan"]):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    main(["--hybrid-input", str(source), "--output-dir", str(root / "out")] + flags)


class MCPAdapterTest(unittest.TestCase):
    def test_server_error_and_unknown_result_are_not_completed_actions(self):
        for response in ({"isError": True}, {}, None):
            with self.subTest(response=response):
                executor = MCPExecutor(call_tool=lambda name, args: response, observe=lambda: {}, permission=lambda step: True,
                                       action_bindings={"click": ("click_tool", lambda step: {"ref": "approved"})})
                with self.assertRaises(RuntimeError):
                    executor.execute(ACT["steps"][0])

    def test_adapter_checks_permission_again_immediately_before_execution(self):
        caller = Mock()
        executor = MCPExecutor(call_tool=caller, observe=lambda: {}, permission=lambda step: False,
                               action_bindings={"click": ("click_tool", lambda step: {})})
        with self.assertRaises(PermissionError):
            executor.execute(ACT["steps"][0])
        caller.assert_not_called()


class ClaudePlannerTest(unittest.TestCase):
    def test_structured_plan_and_usage_use_shared_transport_without_real_api(self):
        from src.ai_inspection.inspection_runtime import build_runtime_request
        import os
        binding = RuntimeBinding(None, None, {"save": "#save"}, {"save": CHECK}, (URL,), lambda step: True)
        context = {"input_id": "one", "kind": "semantic_test_planning", "site_context": {},
                   "page_observation": {"url": URL}, "inspection_flow": {"history": []}}
        request = build_runtime_request(context, binding)
        api_result = {"stop_reason": "end_turn", "model": "fixture", "id": "msg_fixture",
                      "usage": {"input_tokens": 12}, "content": [{"type": "text", "text": json.dumps(ACT)}]}
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "fixture-key"}), patch(
                "src.ai_inspection.claude_client.urlopen", return_value=io.BytesIO(json.dumps(api_result).encode())) as api:
            planner = ClaudePlanner(model="fixture")
            self.assertEqual(planner(request), ACT)
        sent = json.loads(api.call_args.args[0].data)
        self.assertEqual(sent["output_config"]["format"]["schema"], request["response_schema"])
        self.assertEqual(planner.last_usage["tokens"]["input_tokens"], 12)


if __name__ == "__main__":
    unittest.main()
