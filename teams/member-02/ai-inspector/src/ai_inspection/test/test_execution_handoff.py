import json
from pathlib import Path
import tempfile
import unittest

from src.ai_inspection.execution_handoff import export_execution_plans, read_jsonl


class HandoffTest(unittest.TestCase):
    def fixture(self, root, planning=False):
        source, analysis = root / "input.jsonl", root / "ai_results.jsonl"
        kind = "semantic_test_planning" if planning else "ambiguous_interaction"
        source.write_text(json.dumps({"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "one",
            "kind": kind, "url": "https://example.test/cart", "payload": {"action": {"kind": "click"}}}), encoding="utf-8")
        fields = ({"page_summary": "page", "proposed_checks": ["Check cart"], "open_questions": []} if planning else
                  {"evidence_summary": "No visible change", "possible_explanations": [],
                   "needs_additional_verification": True, "suggested_checks": ["Click again", "Check requirements"]})
        analysis.write_text(json.dumps({"input_id": "one", "kind": kind, "analysis_status": "completed",
            "work_type": "test_planning" if planning else "evidence_review", "analysis": fields}), encoding="utf-8")
        return source, analysis

    def test_drafts_do_not_invent_actions_or_expectations_and_keep_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, analysis = self.fixture(root)
            original = [source.read_bytes(), analysis.read_bytes()]
            summary = export_execution_plans(source, analysis, root / "out")
            rows = read_jsonl(root / "out/execution_plans.jsonl")
            self.assertEqual(summary["ready_count"], 0)
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(row["steps"] == [] and row["handoff_status"] == "needs_information" for row in rows))
            self.assertTrue(all("expected_behavior" not in row for row in rows))
            self.assertEqual(original, [source.read_bytes(), analysis.read_bytes()])
            export_execution_plans(source, analysis, root / "other")
            self.assertEqual(rows, read_jsonl(root / "other/execution_plans.jsonl"))

    def test_reviewed_actions_only_make_the_selected_plan_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, analysis = self.fixture(root)
            export_execution_plans(source, analysis, root / "out")
            plan = read_jsonl(root / "out/execution_plans.jsonl")[0]
            review = {"plan_id": plan["plan_id"], "preconditions": ["Restore original cart state"],
                      "steps": [{"action": "click", "control_id": "control-5", "value": ""}],
                      "collect_evidence": ["action_completion", "execution_errors"], "execution_kind": "reproduction"}
            path = root / "review.jsonl"
            path.write_text(json.dumps(review), encoding="utf-8")
            summary = export_execution_plans(source, analysis, root / "out", reviewed_plans=path)
            self.assertEqual(summary["ready_count"], 1)
            rows = read_jsonl(root / "out/execution_plans.jsonl")
            self.assertEqual(rows[0]["handoff_status"], "ready_for_handoff")
            self.assertEqual(rows[1]["handoff_status"], "needs_information")
            review["steps"][0]["action"] = "evaluate"
            path.write_text(json.dumps(review), encoding="utf-8")
            before = (root / "out/execution_plans.jsonl").read_bytes()
            with self.assertRaises(ValueError):
                export_execution_plans(source, analysis, root / "out", reviewed_plans=path)
            self.assertEqual(before, (root / "out/execution_plans.jsonl").read_bytes())

    def test_planning_proposals_and_failed_analyses_are_distinguished(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, analysis = self.fixture(root, planning=True)
            export_execution_plans(source, analysis, root / "out")
            row = read_jsonl(root / "out/execution_plans.jsonl")[0]
            self.assertEqual(row["source_proposal"]["field"], "proposed_checks")
            result = read_jsonl(analysis)[0]
            result.update(analysis_status="error")
            analysis.write_text(json.dumps(result), encoding="utf-8")
            summary = export_execution_plans(source, analysis, root / "out")
            self.assertEqual(summary["plan_count"], 0)
            self.assertEqual(len(summary["skipped"]), 1)

    def test_unknown_source_and_overwrite_are_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, analysis = self.fixture(root)
            source.rename(root / "execution_plans.jsonl")
            with self.assertRaises(ValueError):
                export_execution_plans(root / "execution_plans.jsonl", analysis, root)
            result = read_jsonl(analysis)[0]
            result["input_id"] = "unknown"
            analysis.write_text(json.dumps(result), encoding="utf-8")
            with self.assertRaises(ValueError):
                export_execution_plans(root / "execution_plans.jsonl", analysis, root / "out")
            self.assertFalse((root / "out").exists())
