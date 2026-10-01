from webtestpilot_crawler.crawler import _cookie_metadata
from webtestpilot_crawler.detectors import classify_route, detect_action_issues, detect_page_issues
from webtestpilot_crawler.models import ActionResult, Finding, PageObservation
from webtestpilot_crawler.url_normalizer import normalize_url, same_origin


def _action_result(**overrides):
    values = {
        "action_id": "click-1",
        "kind": "click",
        "label": "Open",
        "status": "executed",
        "before_url": "https://example.com/",
        "after_url": "https://example.com/",
        "before_fingerprint": "before",
        "after_fingerprint": "before",
    }
    values.update(overrides)
    return ActionResult(**values)


def test_cookie_metadata_never_keeps_secret_value():
    sanitized = _cookie_metadata(
        [{"name": "session", "value": "SECRET", "domain": "example.com", "httpOnly": True}]
    )
    assert sanitized == [{"name": "session", "domain": "example.com", "httpOnly": True}]


def test_action_execution_error_becomes_a_reviewable_finding():
    findings = detect_action_issues(_action_result(status="error", error="TimeoutError: locator"))
    assert [item.kind for item in findings] == ["interaction_execution_error"]
    assert findings[0].evidence["error"].startswith("TimeoutError")


def test_confirmed_static_issue_does_not_hide_dynamic_review_route():
    observation = PageObservation(url="https://example.com", normalized_url="https://example.com", depth=0)
    observation.dynamic_signal_count = 1
    observation.findings = [
        Finding("broken_image", "medium", "confirmed", "https://example.com")
    ]
    route, reason = classify_route(observation)
    assert route == "hybrid"
    assert "dynamic controls" in reason


def test_main_document_http_error_is_not_reported_twice_as_a_resource_error():
    observation = PageObservation(
        url="https://example.com/missing",
        normalized_url="https://example.com/missing",
        depth=0,
        status_code=404,
        response_errors=[
            {"url": "https://example.com/missing", "status": 404, "resource_type": "document"}
        ],
    )
    assert [item.kind for item in detect_page_issues(observation)] == ["http_error"]


def test_successful_network_activity_is_an_observable_action_outcome():
    result = _action_result(network_activity=[{"url": "https://example.com/data", "status": 200}])
    assert not result.ambiguous


def test_malformed_port_is_rejected_without_crashing():
    malformed = "http://example.com:not-a-port/path"
    assert normalize_url(malformed) is None
    assert not same_origin("http://example.com", malformed)
