"""Offline fixtures and boundary checks for the staged pipeline.

Run with: python -m integration.test_staged
No network, no browser, no paid API.
"""
import asyncio
import copy
import itertools
import json
import tempfile
from pathlib import Path

import jsonschema

from integration import plan_contract, staged

_IDS = itertools.count(1)


def response(name, args, request_id):
    """Native assistant message carrying a single tool_use block."""
    return {
        "role": "assistant",
        "content": [{"type": "tool_use", "id": request_id, "name": name, "input": args}],
        "stop_reason": "tool_use",
    }


def _first_text(message):
    content = message["content"]
    if isinstance(content, str):
        return content
    for block in content:
        if block.get("type") == "text":
            return block["text"]
    raise AssertionError("no text block in request")


def _parse_json(text):
    start = text.index("{")
    obj, _ = json.JSONDecoder().raw_decode(text[start:])
    return obj


def _controls(payload):
    obs = payload.get("observation") or {}
    page = obs.get("page") if isinstance(obs, dict) else None
    for source in (page, obs, payload.get("page"), payload):
        if isinstance(source, dict) and isinstance(source.get("controls"), list):
            return source["controls"]
    raise AssertionError("plan payload has no observed controls")


def _key(control):
    return control.get("element_key", control.get("key"))


class FixtureModel:
    target_text = "Increment"
    proposal = "Increment changes counter from 0 to 1"
    expected = "Increment changes counter from 0 to 1."
    scenario_id = "increment"

    def __init__(self, mode="normal"):
        assert mode in ("normal", "broken")
        self.mode = mode
        self.last_usage = {}
        self.requests = []
        self.stages = []
        self.plan_tool_use_id = None
        self.judge_calls = 0

    # ---- overridable hooks ----
    def force_candidate(self, record):
        return self.mode == "broken"

    def check_actual(self, actual):
        needle = "Count: 0" if self.mode == "broken" else "Count: 1"
        assert needle in actual, (needle, actual)

    def reproduction(self, payload):
        text = payload["replay"][-1]["after"]["supplement"]["untrusted_text"]
        if self.mode == "broken":
            assert "Count: 0" in text, text
            return {"verdict": "reproduced", "reason": "Counter stayed at Count: 0 after replayed click."}
        return {"verdict": "not_reproduced", "reason": "Counter advanced on replay."}

    # ---- stage handlers ----
    def qa_test_plan(self, payload):
        assert "task" in payload and "evidence" in payload and "limits" in payload, payload.keys()
        ev = payload["evidence"]
        assert {"url", "reason", "payload"} <= set(ev), ev.keys()
        matches = [c for c in _controls(ev["payload"]) if (c.get("text") or "").strip() == self.target_text]
        assert matches, f"no observed control with text {self.target_text!r}"
        return {"page_summary": "Local counter fixture page.",
                "proposed_checks": [self.proposal], "open_questions": [], "scenarios": [{
            "scenario_id": self.scenario_id, "proposal_index": 0, "title": self.target_text,
            "family": "functional", "expected": self.expected,
            "expected_source": "supplied fixture specification",
            "steps": [{"operation": "click", "element_key": _key(matches[0])}],
        }], "unplanned": []}

    def scenario_judgments(self, payload):
        self.judge_calls += 1
        if self.judge_calls == 1:
            assert self.stages[0] == 'qa_test_plan' and self.stages[-1] == 'scenario_judgments'
            assert all(s in ('qa_test_plan', 'act', 'scenario_judgments') for s in self.stages), self.stages
        judgments = []
        for rec in payload["scenarios"]:
            for act in rec.get("actions") or []:
                if isinstance(act, dict) and "plan_tool_use_id" in act:
                    assert act.get("tool_use_id"), act
                    assert act["plan_tool_use_id"] == self.plan_tool_use_id, act
            obs = (payload.get("observations") or {}).get(rec.get("end_snapshot_id")) or {}
            text = (obs.get("supplement") or {}).get("untrusted_text")
            conclusive = (rec.get("execution_status") == "completed" and not rec.get("policy_blocked")
                          and not rec.get("observation_errors"))
            actual = text or rec.get("failure_reason") or rec.get("error") or "execution did not complete"
            if not conclusive:
                verdict = "inconclusive"
            else:
                verdict = "candidate" if self.force_candidate(rec) else "passed"
                if rec.get("scenario_id") == "increment":
                    self.check_actual(actual)
            judgments.append({"scenario_id": rec["scenario_id"], "verdict": verdict, "actual": actual,
                              "snapshot_ids": list(rec.get("snapshot_ids") or []),
                              "action_ids": list(rec.get("action_ids") or [])})
        return {"judgments": judgments}

    def reproduction_verdict(self, payload):
        return self.reproduction(payload)

    async def complete(self, system, messages, tools):
        stage = tools[0]["name"]
        self.stages.append(stage)
        if stage == 'act':
            if len(messages) == 1:
                payload = _parse_json(_first_text(messages[0]))
                self.execution_scenario = payload['scenario']
            else:
                assert messages[-1]['role'] == 'user' and messages[-2]['role'] == 'assistant'
                results = messages[-1]['content']
                assert results[0]['tool_use_id'] == messages[-2]['content'][0]['id']
                payload = _parse_json(_first_text({'content': results[0]['content']}))
            cursor, current = payload['current_step_index'], payload['current']
            step = self.execution_scenario['steps'][cursor]
            args = {k: v for k, v in step.items() if k in ('operation', 'value', 'url', 'wait_ms')}
            if 'element_key' in step or 'target_description' in step:
                matches = [c for c in current['controls'] if (c.get('text') or '').strip() == self.target_text]
                args['element_key'] = _key(matches[0]) if matches else step['element_key']
            args.update(plan_step_index=cursor, purpose='planned', explanation='Execute the fixture plan.',
                        snapshot_id=current['snapshot_id'])
        else:
            assert len(messages) == 1, "planning and judgment contexts must be fresh"
            payload = _parse_json(_first_text(messages[0]))
            handler = getattr(self, stage, None)
            assert handler is not None and stage in ('qa_test_plan', 'scenario_judgments', 'reproduction_verdict'), stage
            args = handler(payload)
        self.requests.append({"system": copy.deepcopy(system), "messages": copy.deepcopy(messages),
                              "tools": [t["name"] for t in tools], "payload": copy.deepcopy(payload)})
        rid = f"toolu_fixture_{next(_IDS):05d}"
        if stage == "qa_test_plan":
            self.plan_tool_use_id = rid
        self.last_usage = {"input_tokens": len(_first_text(messages[0])), "output_tokens": len(json.dumps(args))}
        return response(stage, args, rid)


class ReplayModel(FixtureModel):
    """Reset regression fixture; verdicts are not benchmark bug verdicts."""
    target_text = "Continue"
    proposal = "generic regression probe"
    expected = "Record the local regression fixture post-click state."
    scenario_id = "regression"

    def __init__(self, mode="normal"):
        super().__init__(mode)
        self.judge_input = None

    def force_candidate(self, record):
        return self.judge_calls == 1

    def check_actual(self, actual):
        pass

    def reproduction(self, payload):
        self.judge_input = copy.deepcopy(payload)
        return {"verdict": "inconclusive", "reason": "Reset regression, not a benchmark bug verdict."}


# ---------------- pure boundary checks ----------------

def _rejects(fn, *args):
    try:
        fn(*args)
    except (jsonschema.ValidationError, ValueError):
        return True
    raise AssertionError(f"expected rejection: {args[0]!r}")


def pure_checks():
    initial = {"observation": {"page": {"url": "http://127.0.0.1:8000/", "snapshot_id": "s-initial"},
        "controls": [{"key": "b1", "type": "button"}, {"key": "e1", "type": "email"},
                     {"key": "p1", "type": "password"}],
        "links": [{"url": "http://127.0.0.1:8000/about"}, {"url": "mailto:a@example.test"}]}}
    proposals = ["Increment changes counter from 0 to 1", "Login with credentials"]

    def scen(steps, idx=0, sid="increment"):
        return {"scenario_id": sid, "proposal_index": idx, "title": "t", "family": "functional",
                "expected": "e", "expected_source": "supplied fixture specification", "steps": steps}

    click = {"operation": "click", "element_key": "b1"}
    skip1 = [{"proposal_index": 1, "reason": "needs credentials"}]
    valid = {"scenarios": [scen([click, {"operation": "fill", "element_key": "e1", "value": "a@example.test"}])],
             "unplanned": skip1}
    inputs = (proposals, initial, 4)
    frozen = copy.deepcopy((valid,) + inputs)

    out = plan_contract.validate_plan(valid, *inputs)
    assert out is not valid and out["scenarios"][0]["steps"] == valid["scenarios"][0]["steps"], out

    # The model-facing schema must express the same required fields as the executor.
    schema = plan_contract.PLAN_TOOL["input_schema"]
    for step in (
        {"operation": "press", "value": "Escape"},
        {"operation": "fill", "element_key": "e1"},
        {"operation": "click", "element_key": "b1", "value": "extra"},
        {"operation": "navigate", "url": "http://127.0.0.1:8000/about", "element_key": "b1"},
    ):
        _rejects(plan_contract.jsonschema.validate,
                 {"scenarios": [scen([step])], "unplanned": skip1}, schema)
    plan_contract.jsonschema.validate({"scenarios": [scen([
        {"operation": "press", "element_key": "b1", "value": "Escape", "wait_ms": 500}
    ])], "unplanned": skip1}, schema)

    bad_plans = [
        {"scenarios": [scen([{"operation": "click", "element_key": "zz"}])], "unplanned": skip1},
        {"scenarios": [scen([{"operation": "fill", "element_key": "p1", "value": "x"}])], "unplanned": skip1},
        {"scenarios": [scen([dict(click, extra=1)])], "unplanned": skip1},
        {"scenarios": [scen([click])], "unplanned": []},
        {"scenarios": [scen([click])], "unplanned": skip1 + [{"proposal_index": 0, "reason": "dup"}]},
        {"scenarios": [scen([{"operation": "navigate", "url": "https://foreign.example/"}])], "unplanned": skip1},
        {"scenarios": [scen([click] * 10)], "unplanned": skip1},
    ]
    for plan in bad_plans:
        _rejects(plan_contract.validate_plan, plan, *inputs)
    assert (valid,) + inputs == frozen, "validate_plan mutated its input"

    def rec(sid, status="completed"):
        return {"scenario_id": sid, "execution_status": status, "policy_blocked": False,
                "observation_errors": [], "family": "functional", "image": None,
                "snapshot_ids": [f"s-{sid}"], "action_ids": [f"a-{sid}"]}

    def jud(sid, verdict="passed", snap=None):
        return {"scenario_id": sid, "verdict": verdict, "actual": "x",
                "snapshot_ids": [snap or f"s-{sid}"], "action_ids": [f"a-{sid}"]}

    records = [rec("a"), rec("b")]
    staged._check_judgments([jud("a"), jud("b")], records)
    for judgments, recs in [
        ([jud("a", snap="s-b"), jud("b")], records),
        ([jud("a"), jud("a"), jud("b")], records),
        ([jud("a")], records),
        ([jud("a"), jud("b")], [rec("a"), rec("b", status="failed")]),
    ]:
        _rejects(staged._check_judgments, judgments, recs)


async def image_failure_check():
    class Evidence:
        last_snapshot = {'snapshot_id': 'observed-initial'}
        class collector:
            _sanitize = staticmethod(lambda value: value)
    class Runtime:
        @staticmethod
        def observation(evidence, snapshot):
            return {'observation': {'page': {'snapshot_id': snapshot['snapshot_id']}}}
        @staticmethod
        def persist(*args):
            pass
        async def handle_tool(self, *args):
            raise RuntimeError('local image capture unavailable')
        async def act(self, *args):
            raise AssertionError('must stop actions after image observation failure')
    plan = {'scenarios': [
        {'scenario_id': 'visual', 'proposal_index': 0, 'title': 'Visual', 'family': 'ui',
         'expected': 'Visible UI', 'expected_source': 'fixture', 'steps': []},
        {'scenario_id': 'later', 'proposal_index': 1, 'title': 'Later', 'family': 'functional',
         'expected': 'Mutation', 'expected_source': 'fixture',
         'steps': [{'operation': 'click', 'element_key': 'button'}]},
    ]}
    flow = {'flow_id': 'image-flow', 'plan_tool_use_id': None, 'errors': []}
    with tempfile.TemporaryDirectory() as directory:
        runtime = Runtime()
        runtime.output = Path(directory)
        results, images = await staged._execute(runtime, None, Evidence(), flow, plan)
    assert results[0]['execution_status'] == 'incomplete'
    assert results[1]['execution_status'] == 'not_run' and not results[1]['action_ids']
    assert results[1]['snapshot_ids'] == ['observed-initial']
    assert flow['observation_incomplete'] and not images


if __name__ == "__main__":
    pure_checks()
    asyncio.run(image_failure_check())
    print("PASS staged plan and judgment trust boundaries")
