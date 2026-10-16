"""Offline regression checks for combined planning, bounded repair, compact judgment, not_run policy.

Run with: python -m integration.test_performance
"""
import asyncio
import tempfile
from pathlib import Path
from types import SimpleNamespace

import jsonschema

from integration import plan_contract, staged
from integration.test_staged import response, _rejects

U = "http://127.0.0.1:8000/"
INITIAL = {"observation": {"page": {"url": U, "snapshot_id": "s0"},
                           "controls": [{"key": "b1", "type": "button"}], "links": []},
           "supplement": {}, "site_requirements": None, "permissions": {}, "limits": {}}
GOOD = {"page_summary": "p", "proposed_checks": ["c"], "open_questions": [],
        "scenarios": [], "unplanned": [{"proposal_index": 0, "reason": "r"}]}
BAD = dict(GOOD, unplanned=[{"proposal_index": 0, "reason": "r", "extra": 1}])


class Model:
    def __init__(self, replies):
        self.replies, self.last_usage, self.stages = list(replies), {}, []

    async def complete(self, system, messages, tools):
        assert len(messages) == 1 and tools[0]["name"] == "qa_test_plan"
        self.stages.append(messages[0]["content"][0]["text"])
        return response("qa_test_plan", self.replies.pop(0), "toolu_%d" % len(self.stages))


def _env(replies, tmp):
    rt = SimpleNamespace(model=Model(replies), calls=0, max_calls=5, max_rounds=5, max_actions=4,
                         output=Path(tmp), usage=[], persist=lambda *a: None, run_id="r",
                         site_requirements=None)
    (Path(tmp) / "flows" / "f").mkdir(parents=True, exist_ok=True)
    ev = SimpleNamespace(collector=SimpleNamespace(_sanitize=lambda x: x))
    return rt, ev, {"flow_id": "f", "messages": [], "rounds": 0, "stage": "planning", "initial_url": U}


async def planning_checks():
    schema = plan_contract.PLANNING_TOOL["input_schema"]
    jsonschema.validate(GOOD, schema)
    _rejects(jsonschema.validate, BAD, schema)
    overlap = {"scenarios": [{"scenario_id": "a", "proposal_index": 0, "title": "t", "family": "ui",
               "expected": "e", "expected_source": "s", "steps": []}], "unplanned": GOOD["unplanned"]}
    _rejects(plan_contract.validate_plan, overlap, ["c"], INITIAL, 4)
    with tempfile.TemporaryDirectory() as tmp:
        rt, ev, flow = _env([BAD, GOOD], tmp)
        _, plan, tid, attempts = await staged._plan(rt, ev, flow, INITIAL, "s0", U)
        assert attempts == 2 and rt.calls == 2 and tid == "toolu_2" and plan["unplanned"]
        assert "rejected_response_untrusted" in rt.model.stages[1]
        rt, ev, flow = _env([BAD, BAD, GOOD], tmp)
        try:
            await staged._plan(rt, ev, flow, INITIAL, "s0", U)
            raise AssertionError("second failure must raise")
        except staged.ResponseError:
            assert rt.calls == 2 and len(flow["timings"]["model_calls"]) == 2


async def compact_and_policy_checks():
    def rec(sid, status, snaps, image=None):
        return {"scenario_id": sid, "family": "ui", "expected": "e", "expected_source": "s",
                "execution_status": status, "attempted_step_count": 0, "failure_reason": "not run: x",
                "snapshot_ids": snaps, "action_ids": [], "steps": [], "image": image,
                "start_snapshot_id": snaps[0], "end_snapshot_id": snaps[-1],
                "start_observation": {"big": 1}, "end_observation": {"big": 1}}
    snaps = {"s0": {"events": ["e"]}, "s1": {}}
    rt = SimpleNamespace(run_id="r", site_requirements=None,
                         observation=lambda ev, s: {"observation": {"id": id(s)}})
    ev = SimpleNamespace(snapshots=snaps)
    flow = {"flow_id": "f", "initial_url": U}
    recs = [rec("a", "completed", ["s0", "s1"], {"snapshot_id": "s1"}), rec("b", "completed", ["s1"])]
    out = staged._compact_judge_input(rt, ev, flow, recs, [])
    assert sorted(out["observations"]) == ["s0", "s1"] and out["observations"]["s0"]["events"] == ["e"]
    assert all("start_observation" not in s for s in out["scenarios"])
    assert out["scenarios"][0]["image"]["snapshot_id"] == "s1"
    try:
        staged._compact_judge_input(rt, ev, flow, [rec("c", "completed", ["missing"])], [])
        raise AssertionError("missing reference must raise")
    except staged.ResponseError:
        pass
    seen = []

    async def handle_tool(name, args, *rest):
        seen.append((name, args))
        return {"finding_id": "f1"}, []
    entry = await staged._record_policy_inconclusive(SimpleNamespace(handle_tool=handle_tool), None, None, {},
                                                     rec("d", "not_run", ["s0"]))
    assert entry["judgment_source"] == "program_policy" and entry["verdict"] == "inconclusive"
    assert seen[0][1]["snapshot_ids"] == ["s0"] and seen[0][1]["action_ids"] == []
    assert seen[0][1]["actual"].startswith("실행되지 않음: ")
    f = {"stage": "setup"}
    staged._enter(f, "planning")
    staged._enter(f, "done")
    assert "planning" in f["timings"]["stages"]


async def model_option_checks():
    import json, os
    from integration import models
    for kw in ({"effort": "high"}, {"provider": "anthropic", "model": "m", "effort": "max"}):
        _rejects(lambda options: models.HTTPModel(**options), kw)
    sent = []
    reply = {"role": "assistant", "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn",
             "model": "m", "usage": {"input_tokens": 1, "output_tokens": 5,
                                      "output_tokens_details": {"thinking_tokens": 3}}}

    async def fake(url, headers, payload, timeout, stream):
        sent.append(payload)
        if stream:
            return ['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}', "data: [DONE]"]
        return json.dumps(reply).encode()
    saved = {k: os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "TIMELYGPT_API_KEY")}
    old, models._post = models._post, fake
    try:
        os.environ.update(ANTHROPIC_API_KEY="test", TIMELYGPT_API_KEY="test")
        m = models.HTTPModel(provider="anthropic", model="m", max_tokens=12000, effort="high")
        await m.complete("s", [{"role": "user", "content": "hi"}], [])
        p = sent[-1]
        assert p["output_config"] == {"effort": "high"} and p["max_tokens"] == 12000
        assert "thinking" not in p and "tool_choice" not in p
        assert m.last_usage["effort"] == "high" and m.last_usage["thinking_tokens"] == 3
        m = models.HTTPModel(provider="anthropic", model="m")
        await m.complete("s", [{"role": "user", "content": "hi"}], [])
        assert "output_config" not in sent[-1] and sent[-1]["max_tokens"] == 4000 and "effort" not in m.last_usage
        m = models.HTTPModel()
        await m.complete("s", [{"role": "user", "content": "hi"}], [])
        assert "output_config" not in sent[-1] and sent[-1]["max_tokens"] == 4000 and "effort" not in m.last_usage
    finally:
        models._post = old
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    asyncio.run(model_option_checks())
    asyncio.run(planning_checks())
    asyncio.run(compact_and_policy_checks())
    print("PASS performance planning/repair/compact/not_run guards")
