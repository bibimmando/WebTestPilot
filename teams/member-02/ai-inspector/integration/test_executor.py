"""Real localhost MCP with scripted planner/executor/judge; no paid model calls."""
import asyncio
import copy
import json
import tempfile
import threading
import sys
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from jsonschema import Draft202012Validator
from playwright.async_api import async_playwright

from .mcp import LocalMCPClient, MCPBridge
from .models import ModelError, to_openai_messages
from .preprocessor import crawl
from .runtime import Runtime
from .test_staged import _parse_json, _first_text, _controls, _key, response

ROOT = Path(__file__).resolve().parent.parent


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == '/robots.txt':
            content, mime = 'User-agent: *\nAllow: /', 'text/plain'
        else:
            mime = 'text/html'
            content = '''<!doctype html><html><head><title>Adaptive fixture</title></head><body>
              <button id="open" onclick="reveal()">Open form</button><div id="slot"></div>
              <script>
                function reveal() {
                  document.querySelector('#slot').innerHTML = '<label for="email">Email</label>' +
                    '<input id="email" type="email"><button id="submit" type="button" onclick="check()">Submit</button>' +
                    '<output id="result">Not submitted</output>' +
                    '<div id="modal" style="position:fixed;inset:0;background:white;z-index:10">' +
                    '<button id="dismiss" onclick="this.parentElement.remove()">Dismiss notice</button></div>';
                }
                function check() { document.querySelector('#result').textContent =
                  document.querySelector('#email').value.includes('@') ? 'Accepted' : 'Invalid email'; }
              </script></body></html>'''
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.end_headers()
        self.wfile.write(content.encode())


class Model:
    def __init__(self, name):
        self.name, self.calls, self.last_usage = name, 0, {}

    def answer(self, name, args):
        self.calls += 1
        self.last_usage = {'provider': 'fixture', 'requested_model': self.name,
                           'returned_model': self.name, 'input_tokens': 1, 'output_tokens': 1}
        return response(name, args, '%s-%d' % (self.name, self.calls))


class Planner(Model):
    def __init__(self):
        super().__init__('planner')

    async def complete(self, system, messages, tools):
        assert len(messages) == 1 and [t['name'] for t in tools] == ['qa_test_plan']
        payload = _parse_json(_first_text(messages[0]))
        controls = _controls(payload['evidence']['payload'])
        assert not any(c['type'] == 'email' for c in controls), 'email must not exist at initial load'
        key = _key(next(c for c in controls if c['text'] == 'Open form'))
        return self.answer('qa_test_plan', {
            'page_summary': 'New form appears after clicking Open form.',
            'proposed_checks': ['Invalid email is rejected'], 'open_questions': [],
            'scenarios': [{'scenario_id': 'email', 'proposal_index': 0, 'title': 'Email validation',
                'family': 'input_validation', 'expected': 'Submitting invalid shows Invalid email.',
                'expected_source': 'supplied local fixture requirements', 'steps': [
                    {'operation': 'click', 'element_key': key},
                    {'operation': 'fill', 'target_description': 'Email field revealed by Open form', 'value': 'invalid'},
                    {'operation': 'click', 'target_description': 'Submit button in the revealed form'}]}],
            'unplanned': []})


class Executor(Model):
    def __init__(self, mode='adaptive'):
        super().__init__('executor')
        self.mode, self.stale_sent = mode, False
        self.started = asyncio.Event()

    async def complete(self, system, messages, tools):
        assert {t['name'] for t in tools} == {'act', 'observe', 'stop_scenario'}
        # Every previous real tool_use receives exactly one result, including rejected calls.
        calls = [b['id'] for m in messages if m['role'] == 'assistant' for b in m['content'] if b['type'] == 'tool_use']
        replies = [b['tool_use_id'] for m in messages if m['role'] == 'user' for b in m['content'] if b['type'] == 'tool_result']
        assert Counter(calls) == Counter(replies)
        translated = to_openai_messages(system, messages)
        assert sum(m['role'] == 'tool' for m in translated) == len(replies)
        if len(messages) == 1:
            payload = _parse_json(_first_text(messages[0]))
            self.first_snapshot = payload['current']['snapshot_id']
        else:
            previous = messages[-1]['content'][0]
            payload = _parse_json(_first_text({'content': previous['content']}))
            if self.stale_sent and self.calls == 2 and self.mode == 'adaptive':
                assert previous['is_error'] and 'stale snapshot' in payload['result']['error']
        if self.calls == 1 and self.mode == 'provider_error':
            self.last_usage = {}
            raise ModelError('fixture provider error')
        if self.calls == 1 and self.mode == 'cancel':
            self.started.set()
            await asyncio.Event().wait()
        if self.mode == 'observe_loop':
            return self.answer('observe', {})
        if self.mode == 'multiple_tools':
            value = self.answer('observe', {})
            value['content'].append({'type': 'tool_use', 'id': 'parallel-observe', 'name': 'observe', 'input': {}})
            return value
        current, cursor = payload['current'], payload['current_step_index']
        controls = current['controls']
        args = {'plan_step_index': cursor, 'purpose': 'planned', 'explanation': 'Run frozen fixture step.',
                'snapshot_id': current['snapshot_id']}
        if cursor == 0:
            args.update(operation='click', element_key=_key(next(c for c in controls if c['text'] == 'Open form')))
            if self.mode == 'correction':
                if self.calls == 0:
                    args['element_key'] = 'missing-observed-key'
                else:
                    args['correction_of'] = payload['result']['correction_of']
        elif cursor == 1:
            email = next(c for c in controls if c['type'] == 'email')
            args.update(operation='fill', element_key=_key(email), value='invalid')
            if self.mode == 'adaptive' and not self.stale_sent:
                args['snapshot_id'] = self.first_snapshot
                self.stale_sent = True
            else:
                dismiss = next((c for c in controls if c['text'] == 'Dismiss notice'), None)
                if dismiss:
                    args.update(purpose='supporting', operation='click', element_key=_key(dismiss))
                    args.pop('value')
        else:
            args.update(operation='click', element_key=_key(next(c for c in controls if c['text'] == 'Submit')))
        if self.mode == 'skip_step':
            args['plan_step_index'] = 2
        elif self.mode == 'rewrite_operation':
            args.update(operation='fill', value='unexpected')
        elif self.mode == 'fake_finish':
            return self.answer('finish', {'verdict': 'passed'})
        return self.answer('act', args)


class Judge(Model):
    def __init__(self, expected_status, replay=False):
        super().__init__('judge')
        self.expected_status = expected_status
        self.replay = replay

    async def complete(self, system, messages, tools):
        if tools[0]['name'] == 'reproduction_verdict':
            assert self.replay and len(messages) == 1
            request = _parse_json(_first_text(messages[0]))
            assert len(request['replay']) == 4
            assert 'Invalid email' in request['replay'][-1]['after']['supplement']['untrusted_text']
            return self.answer('reproduction_verdict', {'verdict': 'reproduced', 'reason': 'Actual adapted sequence replayed.'})
        assert len(messages) == 1 and [t['name'] for t in tools] == ['scenario_judgments']
        payload = _parse_json(_first_text(messages[0]))
        assert payload['schema_version'] == 'judge_input/2'
        schema = json.loads((ROOT / 'integration/schemas/judge_input.v2.schema.json').read_text(encoding='utf-8'))
        Draft202012Validator(schema).validate(payload)
        record = payload['scenarios'][0]
        assert record['expected'] == 'Submitting invalid shows Invalid email.'
        assert record['expected_source'] == 'supplied local fixture requirements'
        assert record['execution_status'] == self.expected_status, record
        assert all(s['tool_use_id'] for s in record['steps'])
        assert all('explanation' not in s for s in record['steps'])
        if self.expected_status == 'completed':
            assert record['completed_plan_step_count'] == 3 and record['executed_action_count'] == 4
            assert [s['purpose'] for s in record['steps'] if s['execution'] == 'executed'] == ['planned', 'supporting', 'planned', 'planned']
            assert 'Invalid email' in payload['observations'][record['end_snapshot_id']]['supplement']['untrusted_text']
        return self.answer('scenario_judgments', {'judgments': [{
            'scenario_id': 'email', 'verdict': ('candidate' if self.replay else 'passed') if self.expected_status == 'completed' else 'inconclusive',
            'actual': 'Observed Invalid email.' if self.expected_status == 'completed' else 'Execution incomplete.',
            'snapshot_ids': record['snapshot_ids'], 'action_ids': [s['action_id'] for s in record['steps']
                if self.expected_status != 'completed' or s['execution'] == 'executed']}]})


async def live_checks(modes=None):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = 'http://127.0.0.1:%d/' % server.server_port
    try:
        with tempfile.TemporaryDirectory(dir=ROOT / '.tools', prefix='executor-check-') as directory:
            root = Path(directory)
            async with async_playwright() as pw:
                profile = root / 'profile'
                context = await pw.chromium.launch_persistent_context(str(profile), headless=True,
                    args=['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'], service_workers='block')
                port = (profile / 'DevToolsActivePort').read_text().splitlines()[0]
                client = await asyncio.to_thread(LocalMCPClient, 'node', [
                    str(ROOT / '.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js'),
                    '--cdp-endpoint', 'http://127.0.0.1:' + port, '--snapshot-mode', 'none',
                    '--output-dir', str(root / 'mcp')], timeout=20)
                bridge = MCPBridge(client)
                try:
                    for mode in modes or ('adaptive', 'replay', 'correction', 'skip_step', 'rewrite_operation', 'fake_finish', 'multiple_tools',
                                          'observe_loop', 'provider_error', 'budget', 'cancel'):
                        planner, executor = Planner(), Executor(mode)
                        judge = Judge('completed' if mode in ('adaptive', 'replay', 'correction') else 'incomplete', replay=mode == 'replay')
                        output = root / mode
                        runtime = Runtime(planner, bridge, output, execution_model=executor, judgment_model=judge,
                            browser_state_reset=mode == 'replay',
                            max_actions=8, max_rounds=12, max_calls=3 if mode == 'budget' else 12)
                        task = asyncio.create_task(crawl(url, output, max_pages=1, max_runtime=60,
                            shared_page=context.pages[0], page_callback=runtime.inspect_page,
                            before_page=runtime.prepare_page))
                        if mode == 'cancel':
                            await asyncio.wait_for(executor.started.wait(), 30)
                            task.cancel()
                            try:
                                await task
                            except asyncio.CancelledError:
                                pass
                            else:
                                raise AssertionError('cancellation swallowed')
                            assert judge.calls == 0 and runtime.flows[0]['status'] == 'cancelled'
                        else:
                            summary = await task
                            assert not summary['callback_errors'] and not runtime.termination_error, (
                                mode, summary['callback_errors'], runtime.termination_error, runtime.flows[0]['errors'])
                            assert planner.calls == 1 and judge.calls == (2 if mode == 'replay' else 1), (
                                mode, planner.calls, judge.calls, [f['reproduction'] for f in runtime.flows[0]['findings'].values()])
                            assert runtime.flows[0]['test_status'] == ('passed' if mode in ('adaptive', 'correction') else 'failed' if mode == 'replay' else 'not_run')
                        flow = runtime.flows[0]
                        folder = output / 'flows' / flow['flow_id']
                        records = json.loads((folder / 'scenario_results.json').read_text(encoding='utf-8'))['scenarios']
                        assert records[0]['expected'] == 'Submitting invalid shows Invalid email.'
                        transcript = json.loads((folder / 'messages.json').read_text(encoding='utf-8'))
                        uses = [b['id'] for m in transcript if m['stage'] == 'execution' and m['role'] == 'assistant'
                                for b in m['content'] if b['type'] == 'tool_use']
                        replies = [b['tool_use_id'] for m in transcript if m['stage'] == 'execution' and m['role'] == 'user'
                                   for b in m['content'] if b['type'] == 'tool_result']
                        assert Counter(uses) == Counter(replies)
                        if mode == 'adaptive':
                            assert runtime.calls == 7 and flow['actions'] == 4
                            assert all(a['driver'] == 'mcp' and a['mcp_tool'] in ('browser_click', 'browser_type')
                                       for a in flow['attempts'].values())
                            assert [u['requested_model'] for u in runtime.usage] == ['planner'] + ['executor'] * 5 + ['judge']
                        elif mode == 'replay':
                            finding = next(iter(flow['findings'].values()))
                            assert finding['status'] == 'confirmed' and finding['reproduction']['status'] == 'reproduced'
                            assert executor.calls == 4 and judge.calls == 2, 'replay uses recorded actions and judge model only'
                        elif mode == 'correction':
                            assert len(flow['corrections']) == 1 and not flow['correction_failed']
                            assert len(flow['attempts']) == 5 and records[0]['completed_plan_step_count'] == 3
                        elif mode == 'multiple_tools':
                            assert not flow['attempts'] and executor.calls == 1
                        elif mode in ('skip_step', 'rewrite_operation', 'fake_finish', 'observe_loop'):
                            assert not flow['attempts']
                            assert executor.calls == (3 if mode == 'observe_loop' else 2)
                        elif mode == 'budget':
                            assert executor.calls == 1 and runtime.calls == 3
                            assert records[0]['completed_plan_step_count'] == 1
                        elif mode in ('provider_error', 'cancel'):
                            assert len(flow['attempts']) == 1 and records[0]['execution_status'] == 'incomplete'
                        print('PASS execution agent:', mode)
                finally:
                    await asyncio.to_thread(client.close)
                    await context.close()
    finally:
        await asyncio.to_thread(server.shutdown)
        server.server_close()


if __name__ == '__main__':
    asyncio.run(live_checks(sys.argv[1:] or None))
