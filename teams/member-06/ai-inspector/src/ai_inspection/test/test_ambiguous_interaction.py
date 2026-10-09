import json
from pathlib import Path
import tempfile
import unittest

from src.ai_inspection.evidence_inspector import inspect_hybrid_input


class AmbiguousInteractionTest(unittest.TestCase):
    def test_ambiguous_evidence_is_reviewed_without_losing_original_kind_or_payload(self):
        record = {"schema": "webtestpilot.hybrid-ai-input.v1", "input_id": "ambiguous-1",
                  "kind": "ambiguous_interaction", "url": "https://example.test/",
                  "payload": {"before": {"text": "same"}, "after": {"text": "same"},
                              "question": "Was the interaction effective?"}}
        response = {"evidence_summary": "Unclear outcome", "possible_explanations": ["No visible effect"],
                    "needs_additional_verification": True, "suggested_checks": ["Confirm expected behavior"]}
        requests = []
        def analyzer(request):
            requests.append(request)
            return response
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.jsonl"
            source.write_text(json.dumps(record), encoding="utf-8")
            before = source.read_bytes()
            result = inspect_hybrid_input(source, root / "output", analyzer=analyzer)
            self.assertEqual(result["results"][0]["analysis_status"], "completed")
            self.assertEqual(result["results"][0]["kind"], "ambiguous_interaction")
            self.assertEqual(requests[0]["work_type"], "evidence_review")
            self.assertEqual(requests[0]["evidence"]["payload"], record["payload"])
            self.assertIn("does not prove a bug", requests[0]["task"])
            self.assertEqual(source.read_bytes(), before)
