from webtestpilot_crawler.config import CrawlConfig, CrawlLimits
from webtestpilot_crawler.models import AIReviewCandidate, CrawlTask
from webtestpilot_crawler.priority import AIReviewQueue, PriorityFrontier
from webtestpilot_crawler.scope import ScopeGuard


def test_frontier_keeps_breadth_before_information_value():
    frontier = PriorityFrontier()
    frontier.push(CrawlTask("https://example.test/deep", 2), information_value=99)
    frontier.push(CrawlTask("https://example.test/shallow", 1), information_value=0)
    assert frontier.pop().url.endswith("/shallow")


def test_ai_queue_prefers_value_per_estimated_token():
    queue = AIReviewQueue(max_size=1)
    queue.push(AIReviewCandidate("large", "x", "https://a", 100, "", 1000, {}))
    queue.push(AIReviewCandidate("small", "x", "https://a", 50, "", 100, {}))
    assert [item.candidate_id for item in queue.ordered()] == ["small"]


def test_ai_queue_suppresses_site_wide_duplicate_candidates():
    queue = AIReviewQueue(max_size=10)
    first = AIReviewCandidate("first", "x", "https://a/1", 50, "", 10, {}, "same")
    second = AIReviewCandidate("second", "x", "https://a/2", 50, "", 10, {}, "same")
    assert queue.push(first)
    assert not queue.push(second)
    assert queue.duplicates_suppressed == 1
    assert [item.candidate_id for item in queue.ordered()] == ["first"]


def test_frontier_prefers_less_visited_category_at_same_depth():
    frontier = PriorityFrontier()
    frontier.push(CrawlTask("https://example.test/a/1", 1, category="/a"))
    frontier.push(CrawlTask("https://example.test/a/2", 1, category="/a"))
    frontier.push(CrawlTask("https://example.test/b/1", 1, category="/b"))
    assert frontier.pop().url.endswith("/a/1")
    assert frontier.pop().url.endswith("/b/1")


def test_scope_caps_calendar_variants():
    config = CrawlConfig(
        "https://example.test/",
        limits=CrawlLimits(max_variants_per_path_family=2),
    )
    scope = ScopeGuard(config)
    for url in ("https://example.test/calendar/2026", "https://example.test/calendar/2027"):
        assert scope.allow_url(url, 1)[0]
        scope.register_visit(url)
    allowed, reason = scope.allow_url("https://example.test/calendar/2028", 1)
    assert not allowed
    assert reason == "path_family_variant_limit"


def test_scope_rejects_external_and_destructive_paths():
    scope = ScopeGuard(CrawlConfig("https://example.test/"))
    assert scope.allow_url("https://other.test/", 1)[1] == "external_origin"
    assert scope.allow_url("https://example.test/delete/42", 1)[1] == "blocked_path"
