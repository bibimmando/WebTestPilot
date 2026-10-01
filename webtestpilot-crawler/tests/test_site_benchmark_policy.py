import asyncio
from types import SimpleNamespace

from scripts.benchmark_six_sites import BenchmarkCrawler, GuardedPage, RobotsPolicy
from webtestpilot_crawler.config import CrawlConfig


def test_robots_wildcards_and_specific_allow_rules():
    policy = RobotsPolicy(
        "User-agent: *\nDisallow: /questions/*?*rq=*\nDisallow: /rest/\nAllow: /rest/public/\n",
        "WebTestPilotCrawler",
    )
    assert policy.allows("https://example.test/questions")
    assert not policy.allows("https://example.test/questions/1?rq=2")
    assert not policy.allows("https://example.test/rest/private")
    assert policy.allows("https://example.test/rest/public/item")


def test_robots_selects_specific_user_agent_group():
    policy = RobotsPolicy(
        "User-agent: *\nDisallow: /\nUser-agent: WebTestPilotCrawler\nAllow: /public/\nDisallow: /private/\n",
        "WebTestPilotCrawler/0.1",
    )
    assert policy.allows("https://example.test/public/page")
    assert not policy.allows("https://example.test/private/page")


def test_policy_guard_blocks_foreign_documents_and_state_changing_requests():
    crawler = BenchmarkCrawler(CrawlConfig("https://example.test/"), RobotsPolicy("", "*"), "test")
    request = SimpleNamespace(
        url="https://other.test/", method="GET", is_navigation_request=lambda: True
    )
    assert crawler.request_denial(request) == "cross_origin_document"
    request.url = "https://example.test/data"
    request.method = "POST"
    assert crawler.request_denial(request) == "mutating_method"
    request.method = "GET"
    assert crawler.request_denial(request) == ""


def test_action_mutation_guard_keeps_its_own_blocked_request_evidence():
    crawler = BenchmarkCrawler(CrawlConfig("https://example.test/"), RobotsPolicy("", "*"), "test")
    callbacks = []
    calls = []

    class Page:
        async def route(self, pattern, handler):
            callbacks.append(handler)

    async def block_mutating_request(route, request):
        calls.append("core_guard")

    async def run():
        page = GuardedPage(Page(), crawler)
        await page.route("**/*", block_mutating_request)
        request = SimpleNamespace(
            url="https://example.test/save", method="POST", resource_type="fetch",
            is_navigation_request=lambda: False,
        )
        await callbacks[0](None, request)

    asyncio.run(run())
    assert calls == ["core_guard"]
    assert crawler.guard_events[0]["reason"] == "mutating_method"
