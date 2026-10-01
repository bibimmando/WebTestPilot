import pytest

from webtestpilot_crawler.engine_budget import (
    BudgetGuard,
    CheckpointError,
    FrontierTask,
    PriorityFrontier,
    dump_checkpoint,
    load_checkpoint,
)


# API 예산이 소진돼도 액션 예산은 남아 결정적 탐색을 계속할 수 있다.
def test_llm_degradation_does_not_stop_exploration():
    guard = BudgetGuard("small", clock=lambda: 0.0)
    guard.record_llm_call(0.8)
    assert not guard.planner_allowed()
    assert guard.oracle_allowed("high")
    assert not guard.oracle_allowed("medium")
    guard.record_llm_call(0.2)
    assert not guard.llm_allowed()
    assert not guard.exhausted()


# 점수 우선순위와 중복 제거가 체크포인트 복원 후에도 유지된다.
def test_frontier_checkpoint_restores_remaining_work():
    frontier = PriorityFrontier()
    first = FrontierTask("state-1", "click-modal", 1, {"blindspot": 1})
    second = FrontierTask("state-1", "plain-link", 1, {"novelty": 1})
    assert frontier.push(second)
    assert frontier.push(first)
    assert not frontier.push(first)
    guard = BudgetGuard("small", clock=lambda: 0.0)
    restored_guard, restored_frontier = load_checkpoint(
        dump_checkpoint(guard, frontier), clock=lambda: 0.0
    )
    assert restored_guard.actions == 0
    assert restored_frontier.pop().action_key == "click-modal"
    assert restored_frontier.pop().action_key == "plain-link"
    assert restored_frontier.pop() is None


# 손상된 체크포인트는 조용히 재개하지 않고 오류로 중단한다.
def test_checkpoint_rejects_invalid_counters():
    with pytest.raises(CheckpointError):
        load_checkpoint('{"version":1,"budget":{"profile":"small","actions":-1},"frontier":{}}')
