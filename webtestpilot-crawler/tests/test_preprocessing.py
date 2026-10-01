from webtestpilot_crawler.detectors import classify_route
from webtestpilot_crawler.models import ActionCandidate, ActionResult, Finding, PageObservation
from webtestpilot_crawler.preprocessing import apply_common_ui_filter, cluster_findings


def _page(index: int) -> PageObservation:
    action = ActionCandidate(f"search-{index}", f"#search-{index}", "click", "Search")
    result = ActionResult(
        action_id=action.action_id,
        kind="click",
        label="Search",
        status="executed",
        before_url=f"https://example.test/{index}",
        after_url=f"https://example.test/{index}",
        before_fingerprint="same",
        after_fingerprint="same",
    )
    return PageObservation(
        url=f"https://example.test/{index}",
        normalized_url=f"https://example.test/{index}",
        depth=1,
        actions=[action],
        action_results=[result],
        semantic={"inputs": [{"type": "search", "label": "Search", "placeholder": "Search"}]},
        dynamic_signal_count=2,
    )


def test_common_ui_no_longer_routes_every_page_to_ai():
    pages = [_page(index) for index in range(3)]
    stats = apply_common_ui_filter(pages)
    assert stats["suppressed_action_occurrences"] == 3
    assert stats["suppressed_input_occurrences"] == 3
    assert all(page.dynamic_signal_count == 0 for page in pages)
    assert all(classify_route(page)[0] == "crawler" for page in pages)


def test_repeated_errors_are_grouped_under_one_root_cause():
    pages = [_page(index) for index in range(2)]
    for index, page in enumerate(pages):
        page.findings = [
            Finding(
                "javascript_exception",
                "high",
                "confirmed",
                page.url,
                {"messages": [f"Widget failed for id {1000 + index}"]},
            )
        ]
    roots = cluster_findings(pages)
    assert len(roots) == 1
    assert roots[0]["occurrences"] == 2
    assert pages[0].findings[0].root_cause_id == pages[1].findings[0].root_cause_id
