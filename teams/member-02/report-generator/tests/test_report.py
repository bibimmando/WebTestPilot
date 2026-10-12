from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import contextlib
import io

from pypdf import PdfReader

from wtp_report.contract import SCHEMA, InputError, counts, sanitize, validate
from wtp_report.render import evidence_path, generate
from wtp_report.__main__ import main

ROOT = Path(__file__).resolve().parents[1]


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / "examples/demo/report_input.json").read_text(encoding="utf-8"))

    def test_counts_are_records_not_actions(self):
        validate(self.data)
        self.data["actions"].append({"action_id": "extra", "description": "extra", "execution": "executed", "inputs": []})
        self.assertEqual(counts(self.data), {"pages": 2, "checks": 3, "completed": 2,
                                          "incomplete": 1, "findings": 1, "confirmed": 0, "candidates": 1})

    def test_reject_duplicate_ids_and_broken_links(self):
        for mutation in (lambda d: d["checks"].append(deepcopy(d["checks"][0])),
                         lambda d: d["findings"][0]["action_ids"].append("missing"),
                         lambda d: d["evidence"][0]["finding_ids"].append("missing")):
            d = deepcopy(self.data)
            mutation(d)
            with self.assertRaises(InputError):
                validate(d)

    def test_reject_unknown_schema_and_extra_secret_fields(self):
        self.data["schema_version"] = "ai_input/1"
        with self.assertRaises(InputError):
            validate(self.data)
        self.data["schema_version"] = "wtp.report_input/0.1"
        self.data["api_key"] = "must-not-be-echoed"
        with self.assertRaises(InputError) as error:
            validate(self.data)
        self.assertNotIn("must-not-be-echoed", str(error.exception))

    def test_no_automatic_confirmation(self):
        self.data["findings"][0]["status"] = "confirmed"
        with self.assertRaises(InputError):
            validate(self.data)

    def test_reproduction_requires_separate_executed_records(self):
        replay = self.data["findings"][0]["reproduction"]
        replay.update(status="reproduced", action_ids=["action-help"])
        with self.assertRaises(InputError):
            validate(self.data)
        replay["action_ids"] = ["replay-help"]
        self.data["actions"].append({"action_id": "replay-help", "description": "Replay", "execution": "unknown", "inputs": []})
        with self.assertRaises(InputError):
            validate(self.data)
        self.data["actions"][-1]["execution"] = "executed"
        validate(self.data)
        self.assertEqual(counts(self.data)["findings"], 1)

    def test_secrets_and_urls_are_scrubbed_without_mutation(self):
        self.data["actions"][0]["inputs"] = [{"name": "password", "value": "fixture-secret", "sensitive": True}]
        self.data["findings"][0]["actual"] = "fixture-secret https://user:pass@example.invalid/path?session=abc#token"
        safe, scrub = sanitize(self.data)
        serialized = json.dumps(safe)
        for secret in ("fixture-secret", "user:pass", "session=abc", "#token"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(self.data["actions"][0]["inputs"][0]["value"], "fixture-secret")
        self.assertNotIn("abc", scrub("Cookie: a=abc; other=xyz"))
        self.assertNotIn("xyz", scrub("Cookie: a=abc; other=xyz"))
        self.assertNotIn("abc", scrub("Authorization: Bearer abc"))

    def test_short_secret_does_not_corrupt_statuses(self):
        self.data["actions"][0]["inputs"] = [{"name": "password", "value": "a", "sensitive": True}]
        safe, _ = sanitize(self.data)
        self.assertEqual(safe["findings"][0]["status"], "candidate")
        self.assertEqual(safe["findings"][0]["action_ids"], ["action-search", "action-help"])

    def test_evidence_traversal_and_remote_paths_blocked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for path in ("../secret.txt", "C:/secret.txt", "https://example.invalid/a.png", "\\\\server\\file", "/etc/passwd"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    evidence_path(root, path)

    def test_pdf_contains_korean_counts_unknowns_and_no_secret(self):
        self.data["run"]["ended_at"] = None
        self.data["unknown_reasons"]["/run/ended_at"] = "사용자 중지로 종료 시각 미수집"
        self.data["actions"][0]["inputs"] = [{"name": "password", "value": "secret-fixture-887", "sensitive": True}]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "report.pdf"
            result = generate(self.data, ROOT / "examples/demo", output)
            text = "\n".join(p.extract_text() for p in PdfReader(output).pages)
            self.assertIn("웹사이트 검사 결과 보고서", text)
            self.assertIn("사용자 중지로 종료 시각 미수집", text)
            self.assertIn("문제 후보", text)
            self.assertNotIn("secret-fixture-887", text)
            self.assertEqual(result["counts"]["confirmed"], 0)
            self.assertTrue(result["evidence_warnings"])

    def test_empty_partial_report_and_long_text_paginate(self):
        self.data.update(checks=[], actions=[], findings=[], evidence=[])
        self.data["run"]["termination_reason"] = "부분 결과 " * 1500
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "empty.pdf"
            result = generate(self.data, ROOT / "examples/demo", output)
            self.assertEqual(result["counts"]["findings"], 0)
            self.assertGreater(len(PdfReader(output).pages), 3)

    def test_missing_corrupt_and_unreviewed_evidence_keep_report(self):
        with tempfile.TemporaryDirectory() as temp:
            bundle = Path(temp) / "bundle"
            bundle.mkdir()
            (bundle / "bad.png").write_bytes(b"not an image")
            (bundle / "private.txt").write_text("do-not-publish-secret", encoding="utf-8")
            self.data["evidence"][0]["path"] = "bad.png"
            self.data["evidence"][1].update(path="private.txt", share_safe=False)
            result = generate(self.data, bundle, Path(temp) / "result.pdf")
            self.assertEqual(len(result["evidence_warnings"]), 3)
            text = "\n".join(p.extract_text() for p in PdfReader(Path(temp) / "result.pdf").pages)
            self.assertNotIn("do-not-publish-secret", text)

    def test_failure_preserves_existing_pdf_and_input(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "existing.pdf"
            output.write_bytes(b"original")
            self.data["schema_version"] = "bad"
            with self.assertRaises(InputError):
                generate(self.data, ROOT / "examples/demo", output)
            self.assertEqual(output.read_bytes(), b"original")

    def test_exported_schema_matches_runtime(self):
        schema = json.loads((ROOT / "report-input.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema, SCHEMA)

    def test_required_method_is_visible_when_reproduction_not_run(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "method.pdf"
            generate(self.data, ROOT / "examples/demo", output)
            text = "\n".join(page.extract_text() for page in PdfReader(output).pages)
            for label in ("재현 방법 (필수)", "시작 페이지", "시작 조건", "테스트 입력값",
                          "확인할 기대 결과", "최초 관찰 결과", "추가 재현 결과"):
                self.assertIn(label, text)

    def test_missing_method_warns_without_inventing_steps(self):
        self.data["findings"][0].update(preconditions=None, action_ids=[])
        self.data["unknown_reasons"]["/findings/0/preconditions"] = "초기 상태 기록 미수집"
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "missing.pdf"
            result = generate(self.data, ROOT / "examples/demo", output)
            text = "\n".join(page.extract_text() for page in PdfReader(output).pages)
            self.assertIn("재현 방법 보완 필요", text)
            self.assertIn("초기 상태 기록 미수집", text)
            self.assertEqual(len(result["reproduction_warnings"]), 1)

    def test_input_status_words_stay_literal_and_action_order_is_preserved(self):
        a = self.data["actions"][1]
        a["inputs"] = [{"name": "literal", "value": "failed", "sensitive": False}]
        self.data["actions"].append({"action_id": "second-step", "description": "SECOND-STEP",
                                     "execution": "executed", "inputs": []})
        a["description"] = "FIRST-STEP"
        self.data["findings"][0]["action_ids"] = [a["action_id"], "second-step"]
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "literal.pdf"
            generate(self.data, ROOT / "examples/demo", output)
            text = "\n".join(page.extract_text() for page in PdfReader(output).pages)
            self.assertIn("literal: failed", text)
            self.assertLess(text.index("FIRST-STEP"), text.index("SECOND-STEP"))

    def test_not_run_cannot_have_replay_actions(self):
        self.data["findings"][0]["reproduction"]["action_ids"] = ["action-route"]
        with self.assertRaises(InputError):
            validate(self.data)

    def test_confirmed_requires_initial_method(self):
        self.data["findings"][0].update(status="confirmed", preconditions=None)
        self.data["findings"][0]["reproduction"].update(status="reproduced", action_ids=["action-route"])
        with self.assertRaises(InputError):
            validate(self.data)

    def test_cli_invalid_input_preserves_files(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.json"
            output = Path(temp) / "existing.pdf"
            source.write_text('{"schema_version": "bad"}', encoding="utf-8")
            output.write_bytes(b"original")
            with contextlib.redirect_stderr(io.StringIO()):
                status = main(["--input", str(source), "--output", str(output)])
            self.assertEqual(status, 1)
            self.assertEqual(output.read_bytes(), b"original")
            self.assertEqual(source.read_text(), '{"schema_version": "bad"}')


if __name__ == "__main__":
    unittest.main()
