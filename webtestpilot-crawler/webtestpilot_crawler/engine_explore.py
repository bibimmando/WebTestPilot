"""WebTestPilot P0-P3 exploration coordinator (standard library only)."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from .engine_budget import BudgetGuard, FrontierTask, PriorityFrontier, record_action_with_checkpoint
from .engine_safety import SafetyGuard
from .engine_verify import Candidate, VerificationPipeline

CHECKPOINT_EVERY = 50
STAGNATION_K = 40
BRANCHING_MIN = 5


@dataclass(frozen=True)
class ActionSpec:
    action_key: str
    kind: str
    target: str
    url: str
    features: Mapping[str, float] = field(default_factory=dict)
    label: str = ""
    role: str = ""
    attributes: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Observation:
    state_key: str
    url: str
    url_template: str
    new_state: bool = False
    new_feature: bool = False
    new_candidates: int = 0
    actions: tuple[ActionSpec, ...] = ()
    error: str | None = None
    evidence_ids: tuple[str, ...] = ()
    candidates: tuple[Candidate, ...] = ()


@dataclass(frozen=True)
class SurfacePage:
    url: str
    url_template: str
    state_key: str


@dataclass(frozen=True)
class PlannerAdvice:
    boosts: Mapping[str, float] = field(default_factory=dict)
    goals: tuple[tuple[str, ActionSpec], ...] = ()
    stop: bool = False


@dataclass
class ExploreEvent:
    phase: str
    kind: str
    action_id: str
    ts: float
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class ExploreResult:
    actions_executed: int = 0
    states_seen: int = 0
    templates_understood: int = 0
    candidates: int = 0
    stop_reason: str = ""


@runtime_checkable
class BrowserAdapter(Protocol):
    # 범위·robots·접속·봇 차단을 확인한다
    async def preflight(self, start_url: str) -> Mapping[str, Any]: ...

    # 로그인 세션(storageState)을 확보한다
    async def ensure_session(self) -> Mapping[str, Any]: ...

    # 링크·sitemap·폼을 수집해 표면 페이지를 돌려준다
    async def surface_sweep(self, start_url: str) -> Sequence[SurfacePage]: ...

    # 템플릿 하나를 이해해 기능 지도 항목을 돌려준다
    async def understand_template(self, page: SurfacePage) -> Mapping[str, Any]: ...

    # 액션을 실행하고 정착 후 관측을 돌려준다
    async def execute(self, state_key: str, action: ActionSpec) -> Observation: ...


class ActionExtractor(Protocol):
    # 상태에서 실행 가능한 액션 목록을 추출한다
    def actions(self, obs: Observation, understanding: Mapping[str, Any] | None) -> Sequence[ActionSpec]: ...


class Planner(Protocol):
    # 그래프 요약을 받아 비동기로 조언을 만든다
    async def advise(self, digest: Mapping[str, Any]) -> PlannerAdvice: ...


class EventLog:
    # 이벤트 로그 파일 경로를 준비한다
    def __init__(self, run_dir: Path) -> None:
        run_dir.mkdir(parents=True, exist_ok=True)
        self.path = run_dir / "events.jsonl"

    # 이벤트 한 줄을 JSONL로 추가한다
    def append(self, event: ExploreEvent) -> None:
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(event), ensure_ascii=False, default=str) + "\n")


class ExploreCoordinator:
    # 협력 객체와 실행 상태를 초기화한다
    def __init__(self, start_url: str, profile: str, browser: BrowserAdapter, extractor: ActionExtractor,
                 run_dir: Path, planner: Planner | None = None, safety: SafetyGuard | None = None,
                 verifier: VerificationPipeline | None = None) -> None:
        self.start_url = start_url
        self.browser = browser
        self.extractor = extractor
        self.planner = planner
        self.verifier = verifier
        self.guard = BudgetGuard(profile)
        self.frontier = PriorityFrontier()
        self.safety = safety or SafetyGuard(start_url)
        self.log = EventLog(Path(run_dir))
        self.result = ExploreResult()
        self.understanding: dict[str, Mapping[str, Any]] = {}
        self.specs: dict[tuple[str, str], ActionSpec] = {}
        self.states: set[str] = set()
        self.pending: set[asyncio.Task[PlannerAdvice]] = set()
        self.boosts: dict[str, float] = {}
        self.since_progress = 0
        self.planner_stop = False

    # 페이즈/액션 이벤트를 기록한다
    def emit(self, phase: str, kind: str, action_id: str | None = None, **data: Any) -> str:
        aid = action_id or uuid.uuid4().hex[:12]
        self.log.append(ExploreEvent(phase, kind, aid, time.time(), data))
        return aid

    # P0-P3 전체를 순서대로 실행한다
    async def run(self) -> ExploreResult:
        try:
            await self.p0_preflight()
            pages = await self.p1_surface()
            await self.p2_understand(pages)
            self.seed(pages)
            if self.verifier is not None:
                self.emit("P4", "phase_start")
                self.emit("P5", "phase_start")
                self.verifier.start()
            await self.p3_explore()
            if self.verifier is not None:
                self.emit("P6", "phase_start")
                report = await self.verifier.close()
                self.emit("P4", "phase_end")
                self.emit("P5", "phase_end")
                self.emit("P6", "phase_end", report=str(report))
        except BaseException:
            if self.verifier is not None:
                await self.verifier.cancel()
            raise
        finally:
            await self.shutdown()
        return self.result

    # P0: 사전 점검과 인증을 수행한다
    async def p0_preflight(self) -> None:
        aid = self.emit("P0", "phase_start")
        info = await self.browser.preflight(self.start_url)
        robots_txt = info.get("robots_txt")
        if isinstance(robots_txt, str):
            self.safety.load_robots(self.start_url, robots_txt)
        decision = self.safety.check_url(self.start_url)
        if not decision.allowed:
            raise RuntimeError(f"preflight rejected start URL: {decision.reason}")
        session = await self.browser.ensure_session()
        self.emit("P0", "phase_end", aid, robots_loaded=robots_txt is not None,
                  session_keys=sorted(session.keys()))

    # P1: 표면 스윕으로 범위 내 페이지를 모은다
    async def p1_surface(self) -> list[SurfacePage]:
        aid = self.emit("P1", "phase_start")
        pages = [p for p in await self.browser.surface_sweep(self.start_url) if self.safety.check_url(p.url).allowed]
        self.states.update(p.state_key for p in pages)
        self.result.states_seen = len(self.states)
        self.emit("P1", "phase_end", aid, pages=len(pages))
        return pages

    # P2: 고유 템플릿마다 한 번만 이해한다
    async def p2_understand(self, pages: Sequence[SurfacePage]) -> None:
        aid = self.emit("P2", "phase_start")
        for page in pages:
            if page.url_template in self.understanding:
                continue
            try:
                self.understanding[page.url_template] = await self.browser.understand_template(page)
            except Exception as exc:  # noqa: BLE001
                self.understanding[page.url_template] = {}
                self.emit("P2", "understand_error", template=page.url_template, error=repr(exc))
        self.result.templates_understood = len(self.understanding)
        self.emit("P2", "phase_end", aid, templates=len(self.understanding))

    # 표면 페이지로 프런티어를 초기화한다
    def seed(self, pages: Sequence[SurfacePage]) -> None:
        for page in pages:
            obs = Observation(page.state_key, page.url, page.url_template)
            self.push_actions(obs, depth=1)

    # 관측에서 액션을 추출해 프런티어에 넣고 개수를 반환한다
    def push_actions(self, obs: Observation, depth: int) -> int:
        acts = list(obs.actions) or list(self.extractor.actions(obs, self.understanding.get(obs.url_template)))
        added = 0
        for act in acts:
            key = (obs.state_key, act.action_key)
            if key in self.specs:
                continue
            self.specs[key] = act
            feats = dict(act.features)
            if act.action_key in self.boosts:
                feats["feature_value"] = feats.get("feature_value", 0) + self.boosts[act.action_key]
            self.frontier.push(FrontierTask(obs.state_key, act.action_key, depth, feats))
            added += 1
        return added

    # 완료된 플래너 조언을 반영한다
    def absorb_advice(self) -> None:
        for task in [t for t in self.pending if t.done()]:
            self.pending.discard(task)
            if task.cancelled():
                continue
            exc = task.exception()
            if exc is not None:
                self.emit("P3", "planner_error", error=repr(exc))
                continue
            advice = task.result()
            for action_key, amount in advice.boosts.items():
                if isinstance(amount, (int, float)) and amount > 0:
                    self.boosts[action_key] = self.boosts.get(action_key, 0) + amount
                    self.frontier.boost_action(action_key, amount)
            for state_key, goal in advice.goals:
                key = (state_key, goal.action_key)
                if state_key in self.states and key not in self.specs:
                    self.specs[key] = goal
                    self.frontier.push(FrontierTask(state_key, goal.action_key, 1, dict(goal.features)))
            if advice.stop and not advice.goals:
                self.planner_stop = True
            self.emit("P3", "planner_advice", goals=len(advice.goals), boosts=len(advice.boosts))

    # 플래너 호출을 기다리지 않고 예약한다
    def schedule_planner(self, reason: str) -> None:
        if self.planner is None or len(self.pending) >= 2 or not self.guard.planner_allowed():
            return
        digest = {"reason": reason, "states": len(self.states), "templates": sorted(self.understanding),
                  "actions": self.result.actions_executed, "candidates": self.result.candidates}
        self.pending.add(asyncio.create_task(self.planner.advise(digest)))
        self.emit("P3", "planner_scheduled", reason=reason)

    # 예산 소진 여부를 안전하게 확인한다
    def exhausted(self) -> bool:
        fn = getattr(self.guard, "exhausted", None)
        return bool(fn()) if callable(fn) else False

    # 프런티어에서 다음 작업을 꺼낸다
    def pop(self) -> FrontierTask | None:
        try:
            return self.frontier.pop()
        except (IndexError, KeyError):
            return None

    # P3: 예산이나 프런티어가 다할 때까지 탐색한다
    async def p3_explore(self) -> None:
        pid = self.emit("P3", "phase_start")
        reason = "frontier_empty"
        while True:
            self.absorb_advice()
            if self.exhausted():
                reason = "budget_exhausted"
                break
            if self.planner_stop:
                reason = "stagnation"
                break
            task = self.pop()
            if task is None:
                if self.pending:
                    await asyncio.wait(self.pending, timeout=5, return_when=asyncio.FIRST_COMPLETED)
                    continue
                break
            await self.step(task)
            if self.since_progress >= STAGNATION_K:
                if self.planner is None:
                    reason = "stagnation"
                    break
                self.schedule_planner("stagnation")
                self.since_progress = 0
        self.result.stop_reason = reason
        self.emit("P3", "phase_end", pid, reason=reason, actions=self.result.actions_executed)

    # 단일 액션을 안전 검사 후 실행하고 기록한다
    async def step(self, task: FrontierTask) -> None:
        spec = self.specs.get((task.state_key, task.action_key))
        aid = uuid.uuid4().hex[:12]
        if spec is None or not self.guard.depth_allowed(task.depth):
            return
        mapping = {"action_key": spec.action_key, "kind": spec.kind, "target": spec.target,
                   "url": spec.url, "label": spec.label, "role": spec.role,
                   "attributes": dict(spec.attributes)}
        decision = self.safety.allow_action(mapping)
        if not decision.allowed:
            self.emit("P3", "action_blocked", aid, reason=decision.reason, action=mapping)
            return
        await self.safety.pace(spec.url)
        started = time.monotonic()
        try:
            obs = await self.browser.execute(task.state_key, spec)
        except Exception as exc:  # noqa: BLE001
            obs = Observation(task.state_key, spec.url, "", error=repr(exc))
        self.result.actions_executed += 1
        self.result.candidates += max(obs.new_candidates, len(obs.candidates))
        if self.verifier is not None:
            self.verifier.add_evidence(obs.evidence_ids)
            for candidate in obs.candidates:
                await self.verifier.submit(candidate)
        fresh = obs.state_key not in self.states
        self.states.add(obs.state_key)
        self.result.states_seen = len(self.states)
        progress = fresh or obs.new_state or obs.new_feature or obs.new_candidates > 0
        self.since_progress = 0 if progress else self.since_progress + 1
        added = 0
        if obs.error is None and self.safety.check_url(obs.url).allowed:
            if obs.url_template and obs.url_template not in self.understanding:
                page = SurfacePage(obs.url, obs.url_template, obs.state_key)
                try:
                    self.understanding[obs.url_template] = await self.browser.understand_template(page)
                except Exception as exc:
                    self.understanding[obs.url_template] = {}
                    self.emit("P3", "understand_error", template=obs.url_template, error=repr(exc))
                self.result.templates_understood = len(self.understanding)
                self.schedule_planner("new_template")
            added = self.push_actions(obs, task.depth + 1)
        self.emit("P3", "action", aid, action=mapping, from_state=task.state_key, to_state=obs.state_key,
                  depth=task.depth, new_state=fresh, added=added, error=obs.error,
                  ms=round((time.monotonic() - started) * 1000))
        if added >= BRANCHING_MIN:
            self.schedule_planner("branching")
        checkpoint = record_action_with_checkpoint(self.guard, self.frontier)
        if checkpoint is not None:
            path = self.log.path.parent / "checkpoint.json"
            temporary = path.with_suffix(".tmp")
            temporary.write_text(checkpoint, encoding="utf-8")
            temporary.replace(path)
            self.emit("P3", "checkpoint", aid, actions=self.result.actions_executed, states=len(self.states))

    # 대기 중인 플래너 작업을 취소하고 정리한다
    async def shutdown(self) -> None:
        for task in self.pending:
            task.cancel()
        if self.pending:
            await asyncio.gather(*self.pending, return_exceptions=True)
        cancelled = len(self.pending)
        self.pending.clear()
        self.emit("P3", "shutdown", cancelled_planner=cancelled, reason=self.result.stop_reason)
