import unittest

from src.preprocessing.ranker import rank
from src.preprocessing.result_summary import summarize


ORIGIN = "https://example.test"


def endpoint(method, pattern, *, origin=ORIGIN, discoveries=None, legacy_score=None):
    item = {
        "method": method,
        "origin": origin,
        "url_pattern": pattern,
        "parameter_schema": {},
        "source_pages": [ORIGIN + "/"],
        "discovery_methods": discoveries or ["static_link"],
    }
    if legacy_score is not None:
        item["priority_score"] = legacy_score
    return item


class RankerTest(unittest.TestCase):
    def test_browser_rendered_input_becomes_candidate(self):
        data = {
            "start_url": ORIGIN + "/",
            "endpoints": [endpoint("GET", "/")],
            "forms": [],
            "dynamic_candidates": [{
                "label": "Search Query", "selector": "#searchQuery input",
                "source_page": ORIGIN + "/", "action_hint": "user_input",
                "reason": "browser_rendered_control", "input_type": "text",
            }],
        }
        ranked = rank(data)
        self.assertEqual(ranked["metrics"]["selected_candidates"], 1)
        self.assertEqual(ranked["candidates"][0]["function_hint"], "search")
        self.assertIn("user_editable_rendered_input:+4", ranked["candidates"][0]["priority_reasons"])

    def fixture(self):
        return {
            "start_url": ORIGIN + "/",
            "endpoints": [
                endpoint("POST", "/apply", discoveries=["form"]),
                endpoint("POST", "/info", discoveries=["form"], legacy_score=99),
                endpoint("GET", "/search?q={string}"),
                endpoint("GET", "/external", origin="https://other.test"),
            ],
            "forms": [
                {
                    "source_page": ORIGIN + "/",
                    "action": ORIGIN + "/apply",
                    "method": "POST",
                    "fields": [
                        {"name": "__VIEWSTATE", "type": "hidden", "framework_field": True, "user_editable": False},
                        {"name": "email", "type": "email", "label": "이메일", "required": True, "user_editable": True},
                        {"name": "attachment", "type": "file", "user_editable": True, "constraints": {"accept": ".pdf"}},
                    ],
                },
                {
                    "source_page": ORIGIN + "/",
                    "action": ORIGIN + "/info",
                    "method": "POST",
                    "fields": [{"name": "__VIEWSTATE", "type": "hidden", "framework_field": True, "user_editable": False}],
                },
            ],
            "dynamic_candidates": [
                {"label": "상세 보기", "selector": "#detail", "source_page": ORIGIN + "/", "ui_state_hint": "modal", "action_hint": "interaction_candidate", "static_href": ORIGIN + "/detail"},
                {"label": "상세 보기", "selector": "#detail", "source_page": ORIGIN + "/another", "ui_state_hint": "modal", "action_hint": "interaction_candidate"},
                {"label": "닫기", "selector": "#close", "source_page": ORIGIN + "/", "action_hint": "interaction_candidate"},
                {"label": "제출", "selector": "#submit", "source_page": ORIGIN + "/", "action_hint": "form_submit"},
                {"label": "검색", "selector": "#disabled", "source_page": ORIGIN + "/", "disabled": True},
            ],
        }

    def test_ranking_uses_evidence_and_filters_noise(self):
        ranked = rank(self.fixture(), max_candidates=20, min_score=2)
        candidates = ranked["candidates"]
        self.assertEqual(ranked["metrics"]["skipped_external_endpoints"], 1)
        self.assertEqual(ranked["metrics"]["interaction_candidates"], 2)
        self.assertEqual(len(candidates), 3)
        by_pattern = {item.get("url_pattern"): item for item in candidates}
        self.assertGreater(by_pattern["/apply"]["priority_score"], by_pattern["/search?q={string}"]["priority_score"])
        self.assertEqual(by_pattern["/apply"]["user_input_count"], 2)
        self.assertEqual(by_pattern["/apply"]["execution_policy"], "review_required")
        self.assertNotIn("/info", by_pattern)  # Legacy score 99 must not be reused.
        modal = next(item for item in candidates if item["kind"] == "interaction")
        self.assertEqual(modal["occurrences"], 2)
        self.assertEqual(modal["source_page_count"], 2)
        summary = summarize(ranked)
        self.assertIn("상위 후보", summary)
        self.assertIn("요청: POST https://example.test/apply", summary)
        self.assertIn("입력:", summary)
        self.assertIn("선택자: #detail", summary)
        self.assertIn("정적 링크 후보: GET https://example.test/detail", summary)

    def test_legacy_crawler_result_without_origin(self):
        data = self.fixture()
        for item in data["endpoints"]:
            item.pop("origin")
        ranked = rank(data, max_candidates=20, min_score=2)
        self.assertGreater(ranked["metrics"]["legacy_origin_unknown"], 0)
        apply = next(item for item in ranked["candidates"] if item.get("url_pattern") == "/apply")
        self.assertEqual(apply["user_input_count"], 2)
        self.assertFalse(apply["origin_known"])

    def test_function_family_limit_keeps_distinct_functions(self):
        data = self.fixture()
        data["endpoints"].extend([
            endpoint("GET", "/search?page={integer}"),
            endpoint("GET", "/search?category={string}"),
        ])
        ranked = rank(data, max_candidates=20, min_score=2, max_per_family=2)
        search = [item for item in ranked["candidates"] if item.get("url_pattern", "").startswith("/search?")]
        self.assertEqual(len(search), 2)
        self.assertGreaterEqual(ranked["metrics"]["skipped_by_family_limit"], 1)
        self.assertTrue(any(item.get("url_pattern") == "/apply" for item in ranked["candidates"]))


if __name__ == "__main__":
    unittest.main()
