import asyncio
import json

from webtestpilot_crawler.engine_budget import BudgetGuard, BudgetProfile
from webtestpilot_crawler.engine_explore import (
    ActionSpec,
    ExploreCoordinator,
    Observation,
    SurfacePage,
)
from webtestpilot_crawler.engine_safety import SafetyGuard
from webtestpilot_crawler.engine_verify import Candidate, VerificationPipeline


class FakeBrowser:
    def __init__(self):
        self.executed = []

    # 테스트용 사전 점검 결과를 반환한다.
    async def preflight(self, start_url):
        return {"robots_txt": "User-agent: *\nAllow: /\n"}

    # 테스트용 익명 세션을 반환한다.
    async def ensure_session(self):
        return {"role": "anon"}

    # 시작 상태 한 개를 반환한다.
    async def surface_sweep(self, start_url):
        return [SurfacePage(start_url, "/", "s1")]

    # 템플릿 설명 한 개를 반환한다.
    async def understand_template(self, page):
        return {"template": page.url_template}

    # 기록 가능한 다음 상태를 반환한다.
    async def execute(self, state_key, action):
        self.executed.append(action.action_key)
        return Observation("s2", action.url, "/next", new_state=True)


class Extractor:
    def __init__(self, action):
        self.action = action

    # 시작 상태에만 액션 한 개를 제공한다.
    def actions(self, obs, understanding):
        return [self.action] if obs.state_key == "s1" else []


# 실제 브라우저 없이도 P0-P3 단계와 액션 증거 로그를 검증한다.
def test_exploration_runs_ordered_phases_and_executes_safe_action(tmp_path):
    url = "http://localhost:8123/"
    browser = FakeBrowser()
    action = ActionSpec("go-next", "navigate", "/next", url)
    coordinator = ExploreCoordinator(url, "small", browser, Extractor(action), tmp_path)
    coordinator.safety = SafetyGuard(url, mode="sandbox")
    result = asyncio.run(coordinator.run())
    events = [json.loads(line) for line in (tmp_path / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert browser.executed == ["go-next"]
    assert result.actions_executed == 1
    assert result.states_seen == 2
    assert [event["phase"] for event in events if event["kind"] == "phase_start"] == ["P0", "P1", "P2", "P3"]
    assert any(event["kind"] == "action" and event["action_id"] for event in events)


# 외부 URL은 브라우저 실행 전에 거부한다.
def test_exploration_blocks_out_of_scope_action(tmp_path):
    url = "http://localhost:8123/"
    browser = FakeBrowser()
    action = ActionSpec("external", "navigate", "external", "https://other.test/")
    coordinator = ExploreCoordinator(url, "small", browser, Extractor(action), tmp_path,
                                     safety=SafetyGuard(url, mode="sandbox"))
    result = asyncio.run(coordinator.run())
    assert browser.executed == []
    assert result.actions_executed == 0
    assert "action_blocked" in (tmp_path / "events.jsonl").read_text(encoding="utf-8")


# 느린 Planner는 실행 루프가 기다리지 않고 종료 시 취소한다.
def test_exploration_does_not_wait_for_slow_planner(tmp_path):
    class SlowPlanner:
        # 완료되지 않는 조언 호출을 흉내 낸다.
        async def advise(self, digest):
            await asyncio.sleep(30)

    class BranchBrowser(FakeBrowser):
        # 첫 액션 뒤 다섯 갈래를 발견한다.
        async def execute(self, state_key, action):
            self.executed.append(action.action_key)
            actions = tuple(ActionSpec(f"branch-{n}", "navigate", str(n), "http://localhost:8123/") for n in range(5))
            return Observation("s2", action.url, "/next", new_state=True, actions=actions)

    url = "http://localhost:8123/"
    coordinator = ExploreCoordinator(url, "small", BranchBrowser(),
                                     Extractor(ActionSpec("first", "navigate", "next", url)),
                                     tmp_path, planner=SlowPlanner(), safety=SafetyGuard(url, mode="sandbox"))
    coordinator.guard = BudgetGuard(BudgetProfile("one", 1, 6, 60, 1))
    result = asyncio.run(asyncio.wait_for(coordinator.run(), timeout=2))
    assert result.actions_executed == 1
    assert result.stop_reason == "budget_exhausted"


# 탐색 중 후보가 생기면 검증 워커가 받아 재현 3/3 뒤 보고서를 만든다.
def test_exploration_feeds_verification_pipeline(tmp_path):
    class CandidateBrowser(FakeBrowser):
        # 관찰 근거와 버그 후보를 함께 반환한다.
        async def execute(self, state_key, action):
            self.executed.append(action.action_key)
            candidate = Candidate("bug-1", "api|500", "high", action.url, (action.action_key,),
                                  "500", "200", ("event-1",))
            return Observation("s2", action.url, "/next", new_state=True,
                               evidence_ids=("event-1",), candidates=(candidate,))

    class Reproducer:
        # 독립 재현 세 번의 증거 ID를 반환한다.
        async def replay(self, candidate, attempt):
            return True, [f"replay-{attempt}"]

    url = "http://localhost:8123/"
    verifier = VerificationPipeline(tmp_path, Reproducer(), [])
    coordinator = ExploreCoordinator(url, "small", CandidateBrowser(),
                                     Extractor(ActionSpec("go-next", "navigate", "next", url)),
                                     tmp_path, safety=SafetyGuard(url, mode="sandbox"), verifier=verifier)
    result = asyncio.run(coordinator.run())
    report = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert result.candidates == 1
    assert report["bugs"][0]["reproduced"] == "3/3"
    assert '"phase":"P6"' in (tmp_path / "events.jsonl").read_text(encoding="utf-8").replace(" ", "")
