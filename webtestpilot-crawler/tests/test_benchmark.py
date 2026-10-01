import json

from webtestpilot_crawler.benchmark import build_token_counter, write_benchmark_reports
from webtestpilot_crawler.models import AIReviewCandidate, Finding, PageObservation


def test_heuristic_token_counter_is_available_without_an_api():
    counter, name = build_token_counter("heuristic")
    assert name == "heuristic_chars_div_4"
    assert counter("12345678") == 2


def test_benchmark_exports_three_inputs_and_comparison(tmp_path):
    observation = PageObservation(
        url="https://example.com/",
        normalized_url="https://example.com/",
        depth=0,
        title="Example",
        status_code=200,
        semantic={
            "headings": ["Example"],
            "links": [],
            "controls": [{"kind": "button", "label": "Open"}],
            "inputs": [],
            "dialogs": [],
        },
        text_excerpt="Example page",
        route="hybrid",
        findings=[Finding("broken_image", "medium", "confirmed", "https://example.com/")],
    )
    candidate = AIReviewCandidate(
        candidate_id="planning-1",
        kind="semantic_test_planning",
        url="https://example.com/",
        priority=50,
        reason="dynamic control",
        estimated_tokens=20,
        payload={"controls": [{"kind": "button", "label": "Open"}]},
    )
    captured = {
        id(observation): {
            "html": "<html>" + "x" * 2_000 + "</html>",
            "visible_text": "Example page",
            "network_activity": [{"url": "https://example.com/", "status": 200}],
        }
    }

    paths = write_benchmark_reports(
        tmp_path,
        observations=[observation],
        captured_pages=captured,
        ai_candidates=[candidate],
        tokenizer="heuristic",
    )
    metrics = json.loads(paths["token_comparison"].read_text(encoding="utf-8"))

    assert all(path.exists() for path in paths.values())
    assert metrics["tokenizer"] == "heuristic_chars_div_4"
    assert metrics["scope"]["routing_coverage_percent"] == 100.0
    assert metrics["inputs"]["raw_ai_first"]["tokens"] > metrics["inputs"]["hybrid"]["tokens"]
    assert metrics["reductions_percent"]["hybrid_vs_raw_tokens"] > 0
