"""WebTestPilot deterministic budget guard and priority frontier.

Standalone module: does not modify the existing crawler CLI or JSON schema.
Standard library only.
"""
from __future__ import annotations

import heapq
import json
import math
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping

CHECKPOINT_VERSION = 1
CHECKPOINT_INTERVAL = 50
SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}


class CheckpointError(ValueError):
    """Raised when checkpoint data is malformed."""


@dataclass(frozen=True)
class BudgetProfile:
    name: str
    max_actions: int
    max_depth: int
    max_seconds: float
    max_api_usd: float


PROFILES: dict[str, BudgetProfile] = {
    "ci": BudgetProfile("ci", 60, 4, 5 * 60.0, 0.0),
    "small": BudgetProfile("small", 200, 6, 10 * 60.0, 1.0),
    "medium": BudgetProfile("medium", 600, 8, 25 * 60.0, 3.0),
    "large": BudgetProfile("large", 1500, 10, 60 * 60.0, 10.0),
}


# 프로파일 이름으로 예산 프로파일을 조회한다.
def get_profile(name: str) -> BudgetProfile:
    try:
        return PROFILES[name]
    except KeyError:
        raise ValueError(f"unknown budget profile: {name!r}") from None


# 값이 유한한 음이 아닌 숫자인지 검사한다.
def _nonneg_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CheckpointError(f"{label} must be a number")
    if not math.isfinite(value) or value < 0:
        raise CheckpointError(f"{label} must be finite and >= 0")
    return float(value)


# 값이 음이 아닌 정수인지 검사한다.
def _nonneg_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CheckpointError(f"{label} must be a non-negative integer")
    return value


class BudgetGuard:
    """Tracks action/depth/time/API limits with staged LLM degradation."""

    # 프로파일과 시계 함수로 예산 가드를 초기화한다.
    def __init__(self, profile: str | BudgetProfile = "medium",
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.profile = get_profile(profile) if isinstance(profile, str) else profile
        self._clock = clock
        self._started = clock()
        self._elapsed_offset = 0.0
        self.actions = 0
        self.api_usd = 0.0
        self.llm_calls = 0

    # 경과 시간을 초 단위로 반환한다(복원된 오프셋 포함).
    def elapsed(self) -> float:
        return self._elapsed_offset + max(0.0, self._clock() - self._started)

    # API 사용 비율을 반환한다. 상한 0이면 항상 소진으로 본다.
    def api_ratio(self) -> float:
        if self.profile.max_api_usd <= 0:
            return 1.0
        return self.api_usd / self.profile.max_api_usd

    # 80% 미만일 때만 Planner 사용을 허용한다.
    def planner_allowed(self) -> bool:
        return self.api_ratio() < 0.8

    # 100% 미만일 때만 LLM 호출을 허용한다.
    def llm_allowed(self) -> bool:
        return self.api_ratio() < 1.0

    # 심각도에 따라 Oracle(LLM) 사용 가능 여부를 판단한다.
    def oracle_allowed(self, severity: str) -> bool:
        if not self.llm_allowed():
            return False
        if self.api_ratio() >= 0.8:
            return SEVERITY_ORDER.get(severity.lower(), -1) >= SEVERITY_ORDER["high"]
        return True

    # 현재 강등 단계를 문자열로 반환한다.
    def degradation_level(self) -> str:
        ratio = self.api_ratio()
        if ratio >= 1.0:
            return "no_llm"
        if ratio >= 0.8:
            return "rules_only"
        return "normal"

    # 깊이가 프로파일 상한 이내인지 확인한다.
    def depth_allowed(self, depth: int) -> bool:
        return 0 <= depth <= self.profile.max_depth

    # 액션 1회를 기록하고 체크포인트 시점이면 True를 반환한다.
    def record_action(self) -> bool:
        self.actions += 1
        return self.actions % CHECKPOINT_INTERVAL == 0

    # LLM 호출 비용을 기록한다. 허용되지 않은 호출은 거부한다.
    def record_llm_call(self, cost_usd: float) -> None:
        if not math.isfinite(cost_usd) or cost_usd < 0:
            raise ValueError("cost_usd must be finite and >= 0")
        if not self.llm_allowed():
            raise RuntimeError("LLM budget exhausted; call rejected")
        self.llm_calls += 1
        self.api_usd += cost_usd

    # 결정적 탐색 예산(액션·시간)이 소진됐는지 확인한다. API는 포함하지 않는다.
    def exhausted(self) -> bool:
        return (self.actions >= self.profile.max_actions
                or self.elapsed() >= self.profile.max_seconds)

    # 카운터를 JSON 호환 딕셔너리로 직렬화한다.
    def to_dict(self) -> dict[str, Any]:
        return {"profile": self.profile.name, "actions": self.actions,
                "api_usd": round(self.api_usd, 6), "llm_calls": self.llm_calls,
                "elapsed": round(self.elapsed(), 3)}

    # 딕셔너리에서 카운터를 검증하며 복원한다.
    @classmethod
    def from_dict(cls, data: Any, clock: Callable[[], float] = time.monotonic) -> "BudgetGuard":
        if not isinstance(data, dict):
            raise CheckpointError("budget must be an object")
        name = data.get("profile")
        if name not in PROFILES:
            raise CheckpointError(f"invalid budget profile: {name!r}")
        guard = cls(name, clock)
        guard.actions = _nonneg_int(data.get("actions"), "budget.actions")
        guard.api_usd = _nonneg_number(data.get("api_usd"), "budget.api_usd")
        guard.llm_calls = _nonneg_int(data.get("llm_calls"), "budget.llm_calls")
        guard._elapsed_offset = _nonneg_number(data.get("elapsed"), "budget.elapsed")
        return guard


DEFAULT_WEIGHTS: dict[str, float] = {
    "novelty": 1.0, "blindspot": 1.5, "feature_value": 1.2, "risk": 0.8,
    "test_gap": 1.0, "replay_cost": -0.5, "redundancy": -1.0,
}


@dataclass(frozen=True)
class FrontierTask:
    state_key: str
    action_key: str
    depth: int = 0
    features: Mapping[str, float] = field(default_factory=dict)

    # 중복 판정용 고유 키를 반환한다.
    @property
    def key(self) -> tuple[str, str]:
        return (self.state_key, self.action_key)

    # 작업을 JSON 호환 딕셔너리로 변환한다.
    def to_dict(self) -> dict[str, Any]:
        return {"state_key": self.state_key, "action_key": self.action_key,
                "depth": self.depth, "features": dict(sorted(self.features.items()))}

    # 딕셔너리에서 작업을 검증하며 생성한다.
    @classmethod
    def from_dict(cls, data: Any) -> "FrontierTask":
        if not isinstance(data, dict):
            raise CheckpointError("task must be an object")
        sk, ak = data.get("state_key"), data.get("action_key")
        if not isinstance(sk, str) or not sk or not isinstance(ak, str) or not ak:
            raise CheckpointError("task keys must be non-empty strings")
        feats = data.get("features", {})
        if not isinstance(feats, dict):
            raise CheckpointError("task.features must be an object")
        clean: dict[str, float] = {}
        for k, v in feats.items():
            if k not in DEFAULT_WEIGHTS:
                raise CheckpointError(f"unknown feature: {k!r}")
            clean[k] = _nonneg_number(v, f"feature {k}")
        return cls(sk, ak, _nonneg_int(data.get("depth", 0), "task.depth"), clean)


# 가중치를 검증하고 기본값과 병합한다.
def validate_weights(weights: Mapping[str, float] | None) -> dict[str, float]:
    merged = dict(DEFAULT_WEIGHTS)
    for k, v in (weights or {}).items():
        if k not in DEFAULT_WEIGHTS:
            raise ValueError(f"unknown weight: {k!r}")
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"weight {k!r} must be a finite number")
        merged[k] = float(v)
    return merged


class PriorityFrontier:
    """Deterministic max-score frontier with stable tie-breaking and dedup."""

    # 가중치로 빈 frontier를 초기화한다.
    def __init__(self, weights: Mapping[str, float] | None = None) -> None:
        self.weights = validate_weights(weights)
        self._heap: list[tuple[float, str, str, int, FrontierTask]] = []
        self._seen: set[tuple[str, str]] = set()
        self._pending: set[tuple[str, str]] = set()
        self._seq = 0

    # 작업 특성에 가중치를 적용해 점수를 계산한다.
    def score(self, task: FrontierTask) -> float:
        return round(sum(self.weights[k] * float(v) for k, v in task.features.items()
                         if k in self.weights), 9)

    # 작업을 추가한다. 이미 본 (state, action)은 무시하고 False를 반환한다.
    def push(self, task: FrontierTask) -> bool:
        if task.key in self._seen:
            return False
        self._seen.add(task.key)
        self._pending.add(task.key)
        # 동점은 state_key, action_key, 삽입 순서로 결정적 정렬
        heapq.heappush(self._heap, (-self.score(task), task.state_key,
                                    task.action_key, self._seq, task))
        self._seq += 1
        return True

    # 여러 작업을 추가하고 실제 추가된 개수를 반환한다.
    def extend(self, tasks: Iterable[FrontierTask]) -> int:
        return sum(1 for t in tasks if self.push(t))

    # 도착한 Planner 조언을 대기 중인 액션 점수에 반영한다.
    def boost_action(self, action_key: str, amount: float) -> int:
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("boost amount must be finite and >= 0")
        changed = 0
        updated = []
        for _, state_key, key, seq, task in self._heap:
            if key == action_key:
                features = dict(task.features)
                features["feature_value"] = features.get("feature_value", 0) + amount
                task = FrontierTask(task.state_key, task.action_key, task.depth, features)
                changed += 1
            updated.append((-self.score(task), state_key, key, seq, task))
        self._heap = updated
        heapq.heapify(self._heap)
        return changed

    # 점수가 가장 높은 작업을 꺼낸다. 비어 있으면 None.
    def pop(self) -> FrontierTask | None:
        if not self._heap:
            return None
        task = heapq.heappop(self._heap)[-1]
        self._pending.discard(task.key)
        return task

    # 남은 작업 수를 반환한다.
    def __len__(self) -> int:
        return len(self._heap)

    # frontier를 우선순위 순서의 딕셔너리로 직렬화한다.
    def to_dict(self) -> dict[str, Any]:
        ordered = sorted(self._heap)
        return {"weights": dict(self.weights),
                "pending": [e[-1].to_dict() for e in ordered],
                "seen": sorted([list(k) for k in self._seen - self._pending])}

    # 딕셔너리에서 frontier를 검증하며 복원한다.
    @classmethod
    def from_dict(cls, data: Any) -> "PriorityFrontier":
        if not isinstance(data, dict):
            raise CheckpointError("frontier must be an object")
        try:
            fr = cls(data.get("weights"))
        except ValueError as exc:
            raise CheckpointError(str(exc)) from None
        pending, seen = data.get("pending"), data.get("seen", [])
        if not isinstance(pending, list) or not isinstance(seen, list):
            raise CheckpointError("frontier.pending/seen must be lists")
        for item in pending:
            if not fr.push(FrontierTask.from_dict(item)):
                raise CheckpointError("duplicate pending task in checkpoint")
        for pair in seen:
            if (not isinstance(pair, list) or len(pair) != 2
                    or not all(isinstance(x, str) and x for x in pair)):
                raise CheckpointError("frontier.seen entries must be [state, action]")
            fr._seen.add((pair[0], pair[1]))
        return fr


# 예산과 frontier를 체크포인트 JSON 문자열로 직렬화한다.
def dump_checkpoint(guard: BudgetGuard, frontier: PriorityFrontier) -> str:
    payload = {"version": CHECKPOINT_VERSION, "budget": guard.to_dict(),
               "frontier": frontier.to_dict()}
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False)


# 체크포인트 JSON 문자열을 검증하고 예산과 frontier를 복원한다.
def load_checkpoint(text: str, clock: Callable[[], float] = time.monotonic
                    ) -> tuple[BudgetGuard, PriorityFrontier]:
    try:
        data = json.loads(text, parse_constant=lambda c: (_ for _ in ()).throw(
            CheckpointError(f"invalid constant {c}")))
    except json.JSONDecodeError as exc:
        raise CheckpointError(f"invalid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise CheckpointError("checkpoint must be an object")
    if data.get("version") != CHECKPOINT_VERSION:
        raise CheckpointError(f"unsupported checkpoint version: {data.get('version')!r}")
    return (BudgetGuard.from_dict(data.get("budget"), clock),
            PriorityFrontier.from_dict(data.get("frontier")))


# 액션을 기록하고 50 액션마다 체크포인트 문자열을 반환한다.
def record_action_with_checkpoint(guard: BudgetGuard, frontier: PriorityFrontier) -> str | None:
    return dump_checkpoint(guard, frontier) if guard.record_action() else None
