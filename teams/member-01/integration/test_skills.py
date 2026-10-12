"""Offline checks for registered planning skills, continuation bounds and cancellation.

Run: python -m integration.test_skills. No browser or paid API.
"""
import asyncio
import copy
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

from . import models, staged
from .test_performance import INITIAL, GOOD
from .test_staged import response, _rejects

SKILL = 'skill_fixture'
VERSION = 'skver_fixture'
SERVER = [
    {'type': 'server_tool_use', 'id': 'srv_1', 'name': 'bash_code_execution',
     'input': {'command': 'cat /skills/fixture/SKILL.md'}},
    {'type': 'bash_code_execution_tool_result', 'tool_use_id': 'srv_1',
     'content': {'type': 'bash_code_execution_result', 'return_code': 0, 'stdout': 'fixture', 'stderr': ''}},
]
PAUSED = {'role': 'assistant', 'content': SERVER, 'stop_reason': 'pause_turn',
          'container': {'id': 'container_fixture'}, 'model': 'fixture',
          'usage': {'input_tokens': 10, 'output_tokens': 2}}
FINAL = {**response('qa_test_plan', GOOD, 'tool_final'), 'model': 'fixture',
         'usage': {'input_tokens': 20, 'output_tokens': 3}}


def cli_checks():
    from . import __main__ as cli
    old_argv, old_env = sys.argv, cli.env_value
    cli.env_value = lambda name: {'ANTHROPIC_PLANNING_SKILL_ID': SKILL,
                                  'ANTHROPIC_PLANNING_SKILL_VERSION': VERSION}.get(name)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            base = ['integration', '--url', 'https://example.test/', '--direct', '--output', str(Path(tmp) / 'run')]
            sys.argv = base + ['--provider', 'anthropic', '--model', 'fixture']
            a = cli.parse_args()
            assert a.planning_skill_id == SKILL and a.planning_skill_version == VERSION
            sys.argv += ['--planning-skill-id', 'skill_override', '--planning-skill-version', 'latest']
            a = cli.parse_args()
            assert a.planning_skill_id == 'skill_override' and a.planning_skill_version == 'latest'
            for provider in ('mock', 'timely'):
                sys.argv = base + ['--provider', provider]
                a = cli.parse_args()
                assert a.planning_skill_id is None and a.planning_skill_version is None
    finally:
        sys.argv, cli.env_value = old_argv, old_env


def env(tmp, max_calls=5, max_rounds=5):
    m = models.HTTPModel('anthropic', model='fixture', skill_id=SKILL, skill_version=VERSION)
    rt = SimpleNamespace(model=m, calls=0, max_calls=max_calls, max_rounds=max_rounds, max_actions=4,
                         output=Path(tmp), usage=[], persist=lambda *a: None, run_id='r', site_requirements=None)
    (Path(tmp) / 'flows/f').mkdir(parents=True, exist_ok=True)
    ev = SimpleNamespace(collector=SimpleNamespace(_sanitize=lambda x: x))
    flow = {'flow_id': 'f', 'messages': [], 'rounds': 0, 'stage': 'planning', 'initial_url': 'https://example.test/'}
    return rt, ev, flow


async def checks():
    old_post, old_key = models._post, models.HTTPModel._key
    models.HTTPModel._key = lambda self: 'fixture-key'
    sent, replies = [], []

    async def fake(url, headers, payload, timeout, stream):
        sent.append(copy.deepcopy(payload))
        item = replies.pop(0)
        if item == 'wait':
            await asyncio.Event().wait()
        return json.dumps(item).encode()

    models._post = fake
    try:
        _rejects(lambda: models.HTTPModel(provider='timely', skill_id=SKILL))
        _rejects(lambda: models.HTTPModel(provider='anthropic', model='m', skill_id=' '))
        _rejects(lambda: models.HTTPModel(provider='anthropic', model='m', skill_id=SKILL, skill_version=''))
        for invalid in ({**PAUSED, 'container': None}, {**PAUSED, 'content': FINAL['content']}):
            try:
                models.validate_message(invalid)
            except models.ModelError:
                pass
            else:
                raise AssertionError('invalid skill continuation was accepted')

        with tempfile.TemporaryDirectory() as tmp:
            rt, ev, flow = env(tmp)
            replies[:] = [PAUSED, FINAL]
            _, plan, tid, attempts = await staged._plan(rt, ev, flow, INITIAL, 's0', 'https://example.test/')
            assert plan['schema_version'] == 'test_plan/2' and tid == 'tool_final' and attempts == 1
            assert rt.calls == flow['rounds'] == 2 and len(rt.usage) == 2
            assert [u['input_tokens'] for u in rt.usage] == [10, 20]
            assert all(u['skill_id'] == SKILL for u in rt.usage)
            assert len(flow['messages']) == 3  # one user and two responses, no duplicated continuation
            first, second = sent[-2:]
            assert first['container'] == {'skills': [{'type': 'custom', 'skill_id': SKILL, 'version': VERSION}]}
            assert second['container']['id'] == 'container_fixture'
            assert second['messages'][-1] == {'role': 'assistant', 'content': SERVER}
            assert second['tools'][-1] == models.CODE_EXECUTION_TOOL
            assert staged.SKILL_SYSTEM in first['system']
            stored = json.loads((Path(tmp) / 'flows/f/planning_continue_1_request.json').read_text())
            assert stored['container'] == second['container'] and stored['tools'] == second['tools']
            assert 'fixture-key' not in json.dumps(stored)

            # Even a shared model cannot enable code execution during execution or judgment.
            for tool_name in ('act', 'scenario_judgments', 'reproduction_judgment'):
                replies[:] = [{'role': 'assistant', 'content': [], 'stop_reason': 'end_turn'}]
                await rt.model.complete('s', [], [{'name': tool_name}])
                assert 'container' not in sent[-1] and sent[-1]['tools'] == [{'name': tool_name}]
                assert 'skill_id' not in rt.model.last_usage

            # A new page/repair starts a fresh provider container, not stale planning state.
            rt, ev, flow = env(tmp)
            replies[:] = [FINAL]
            await staged._plan(rt, ev, flow, INITIAL, 's0', 'https://example.test/')
            assert 'id' not in sent[-1]['container']

            for limit_name in ('max_calls', 'max_rounds'):
                rt, ev, flow = env(tmp, **{limit_name: 1})
                replies[:] = [PAUSED, FINAL]
                before = len(sent)
                try:
                    await staged._plan(rt, ev, flow, INITIAL, 's0', 'https://example.test/')
                    raise AssertionError('continuation exceeded the request budget')
                except staged.LimitReached as exc:
                    assert exc.status == limit_name and len(sent) == before + 1

            rt, ev, flow = env(tmp)
            replies[:] = [PAUSED, 'wait']
            before = len(sent)
            task = asyncio.create_task(staged._plan(rt, ev, flow, INITIAL, 's0', 'https://example.test/'))
            while len(sent) < before + 2:
                if task.done():
                    await task
                    raise AssertionError('planning ended before the pending continuation')
                await asyncio.sleep(0)
            task.cancel()
            try:
                await task
                raise AssertionError('cancellation must propagate')
            except asyncio.CancelledError:
                assert rt.calls == 2 and len(rt.usage) == 2
    finally:
        models._post, models.HTTPModel._key = old_post, old_key


if __name__ == '__main__':
    cli_checks()
    asyncio.run(checks())
    print('PASS planning skill transport/continuation/budgets/stage isolation/cancellation')
