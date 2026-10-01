import asyncio

import pytest

from webtestpilot_crawler.engine_safety import SafetyGuard


# safe 모드는 robots 정책을 읽기 전까지 사이트 접근을 거부한다.
def test_safe_guard_requires_robots_and_blocks_out_of_scope_targets():
    guard = SafetyGuard("https://example.test/")
    assert not guard.check_url("https://example.test/page").allowed
    guard.load_robots("https://example.test/robots.txt", "User-agent: *\nDisallow: /private\n")
    assert guard.check_url("https://example.test/page").allowed
    assert not guard.check_url("https://example.test/private").allowed
    assert not guard.allow_action({
        "url": "https://example.test/page", "kind": "click", "role": "link",
        "attributes": {"href": "https://other.test/page"},
    }).allowed
    assert not guard.check_url("https://example.test/__admin").allowed


# 안전 모드는 검색·로그인만 허용하고 일반 제출과 파괴적 동작을 막는다.
def test_safe_guard_action_policy():
    guard = SafetyGuard("https://example.test/")
    guard.load_robots("https://example.test/robots.txt", "User-agent: *\nAllow: /\n")
    base = {"url": "https://example.test/form", "kind": "submit"}
    assert guard.allow_action({**base, "label": "Search"}).allowed
    assert guard.allow_action({**base, "label": "Log in"}).allowed
    assert not guard.allow_action({**base, "label": "Send message"}).allowed
    assert not guard.allow_action({**base, "label": "Continue"}).allowed
    assert not guard.allow_action({"kind": "navigate"}).allowed


# 샌드박스에서도 평가 관리 경로는 접근할 수 없다.
def test_sandbox_still_enforces_scope_when_pacing():
    guard = SafetyGuard("http://localhost:8000/", mode="sandbox")
    with pytest.raises(ValueError):
        asyncio.run(guard.pace("http://localhost:8000/__eval"))
    assert not guard.allow_action({"url": "https://other.test/", "kind": "click"}).allowed
