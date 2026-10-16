import base64
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from src.ai_inspection.judgment.input_contract import ROOT, observation_pair, validate_input
from src.ai_inspection.judgment.images import load_images
from src.ai_inspection.judgment.judge import export_judgment, judge, main, prepare_request
from src.ai_inspection.judgment.response_contract import validate_response


class JudgmentTest(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((ROOT / "examples/judge_input.v2.example.json").read_text(encoding="utf-8-sig"))
        self.reply = json.loads((ROOT / "examples/scenario_judgments.example.json").read_text(encoding="utf-8-sig"))

    def test_four_synthetic_cases_and_independent_model_request(self):
        original = deepcopy(self.payload)
        adapter = Mock(return_value=self.reply)
        result = judge(self.payload, model=adapter)
        self.assertEqual([item["verdict"] for item in result["judgments"]], ["candidate", "inconclusive", "passed", "inconclusive"])
        request = adapter.call_args.args[0]
        self.assertEqual(request["tool_choice"]["name"], "scenario_judgments")
        self.assertEqual(len(request["messages"]), 1)
        self.assertEqual(self.payload, original)
        step = self.payload["scenarios"][0]["steps"][0]
        self.assertTrue(all(observation_pair(self.payload, step)))
        empty = deepcopy(self.payload)
        empty["scenarios"] = []
        adapter.reset_mock()
        self.assertEqual(judge(empty, model=adapter), {"judgments": []})
        adapter.assert_not_called()

    def test_missing_observation_duplicate_scenario_and_foreign_step_fail_before_model(self):
        for change in ("missing", "duplicate", "foreign"):
            payload = deepcopy(self.payload)
            if change == "missing":
                payload["observations"].pop(payload["scenarios"][0]["snapshot_ids"][0])
            elif change == "duplicate":
                payload["scenarios"][1]["scenario_id"] = payload["scenarios"][0]["scenario_id"]
            else:
                payload["scenarios"][0]["steps"][0]["after_snapshot_id"] = "snapshot-route-after"
            adapter = Mock()
            with self.subTest(change=change), self.assertRaises(ValueError):
                judge(payload, model=adapter)
            adapter.assert_not_called()

    def test_response_ownership_missing_duplicate_and_unknown_are_rejected(self):
        _, images = prepare_request(self.payload)
        variants = []
        reply = deepcopy(self.reply)
        reply["judgments"][0]["snapshot_ids"] = ["snapshot-route-after"]
        variants.append(reply)
        variants.append({"judgments": self.reply["judgments"][:-1]})
        variants.append({"judgments": [self.reply["judgments"][0]] * 4})
        reply = deepcopy(self.reply)
        reply["judgments"][0]["scenario_id"] = "invented"
        variants.append(reply)
        reply = deepcopy(self.reply)
        reply["judgments"][0]["snapshot_ids"] = []
        variants.append(reply)
        for reply in variants:
            with self.assertRaises(ValueError):
                validate_response(reply, self.payload, images)

    def test_blocked_unknown_and_missing_before_evidence_cannot_be_conclusive(self):
        for change in ("blocked", "unknown", "missing_before", "incomplete"):
            payload = deepcopy(self.payload)
            scenario = payload["scenarios"][0]
            if change == "blocked":
                scenario["policy_blocked"] = True
            elif change == "unknown":
                scenario["steps"][0]["execution"] = "unknown"
            elif change == "missing_before":
                scenario["steps"][0]["before_snapshot_id"] = None
            else:
                scenario["execution_status"] = "incomplete"
            _, images = prepare_request(payload)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_response(self.reply, payload, images)
            reply = deepcopy(self.reply)
            reply["judgments"][0]["verdict"] = "inconclusive"
            validate_response(reply, payload, images)

    def test_ui_requires_actual_bytes_and_image_citation_and_path_is_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "image.png"
            path.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM9sAAAAASUVORK5CYII="))
            payload = deepcopy(self.payload)
            scenario = payload["scenarios"][-1]
            scenario["execution_status"] = "completed"
            scenario["policy_blocked"] = False
            scenario["image"] = {"path": str(path), "snapshot_id": scenario["snapshot_ids"][0]}
            # Schema may allow additional image metadata; validate against supplied input contract.
            request, images = prepare_request(payload, run_root=root)
            self.assertEqual(images[scenario["scenario_id"]]["status"], "available")
            self.assertTrue(any(block["type"] == "image" for block in request["messages"][0]["content"]))
            reply = deepcopy(self.reply)
            reply["judgments"][-1]["verdict"] = "passed"
            validate_response(reply, payload, images)
            _, missing = prepare_request(payload)
            with self.assertRaises(ValueError):
                validate_response(reply, payload, missing)
            payload["scenarios"][-1]["image"]["path"] = "../outside.png"
            _, missing = load_images(payload, root)
            self.assertEqual(missing[scenario["scenario_id"]]["reason"], "image_outside_run_root")
            payload["scenarios"][-1]["image"]["path"] = str(path)
            _, missing = load_images(payload, root, max_bytes=1)
            self.assertEqual(missing[scenario["scenario_id"]]["reason"], "image_size_limit")

    def test_offline_export_no_api_and_error_replaces_previous_response(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = ROOT / "examples/judge_input.v2.example.json"
            summary = export_judgment(source, root, mock_response=ROOT / "examples/scenario_judgments.example.json")
            self.assertEqual(summary["status"], "completed")
            self.assertEqual(summary["model_calls"], 0)
            self.assertEqual(json.loads((root / "judgment_response.json").read_text(encoding="utf-8")), self.reply)
            adapter = Mock(return_value={"judgments": []})
            adapter.last_usage = {"input_tokens": 5}
            with self.assertRaises(ValueError):
                export_judgment(source, root, model=adapter)
            summary = json.loads((root / "judgment_run.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "error")
            self.assertEqual(summary["usage"], {"input_tokens": 5})
            self.assertEqual(json.loads((root / "judgment_response.json").read_text(encoding="utf-8")), {"status": "not_run"})

    def test_source_overwrite_and_input_version_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "judgment_request.json"
            source.write_text(json.dumps(self.payload), encoding="utf-8")
            with self.assertRaises(ValueError):
                export_judgment(source, root)
            payload = deepcopy(self.payload)
            payload["schema_version"] = "judge_input/1"
            with self.assertRaises(ValueError):
                validate_input(payload)
