"""Real localhost MCP + deterministic models; transport verification, not AI accuracy."""
import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading

from playwright.async_api import async_playwright

from integration.mcp import LocalMCPClient, MCPBridge
from integration.preprocessor import crawl
from integration.runtime import Runtime
from integration.test_staged import FixtureModel, _parse_json, _first_text, _controls, _key, response


MEMBER = Path(__file__).resolve().parents[2]


class Handler(BaseHTTPRequestHandler):
    broken = False
    def log_message(self, *args):
        pass
    def do_GET(self):
        if self.path == '/robots.txt':
            body, mime = 'User-agent: *\nAllow: /', 'text/plain'
        elif self.path == '/product':
            behavior = '' if self.broken else "sessionStorage.setItem('bag','1');"
            body = ('<!doctype html><title>Bag fixture product</title><h1>Fixture item</h1>'
                    f'<button onclick="{behavior}document.querySelector(\'output\').textContent=\'Added\'">Add to Bag</button>'
                    '<output></output><button>Close notification</button><a href="/cart">Bag</a>')
            mime = 'text/html'
        elif self.path == '/cart':
            body = ('<!doctype html><title>Bag fixture</title><h1>Bag</h1><output>Bag: 0</output>'
                    '<script>document.querySelector("output").textContent="Bag: "+(sessionStorage.getItem("bag")||"0")</script>')
            mime = 'text/html'
        else:
            behavior = '' if self.broken else "document.querySelector('output').textContent='Count: 1'"
            button_text = '' if self.path == '/unnamed' else 'Increment'
            body = ('<!doctype html><title>Quality fixture</title><h1>Visible title</h1>'
                    f'<button onclick="{behavior}">{button_text}</button><output>Count: 0</output>')
            mime = 'text/html'
        data = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class QualityModel(FixtureModel):
    """Attach fixed criterion assessments to existing real-evidence fixture answers."""
    def __init__(self, mode, ui=False):
        super().__init__(mode)
        self.ui = ui

    def qa_test_plan(self, payload):
        plan = super().qa_test_plan(payload)
        if self.ui:
            sc = plan['scenarios'][0]
            sc.update(scenario_id='ui_initial', family='ui', title='Initial UI fixture',
                      expected='Title is unobscured in the initial viewport.', steps=[])
        return plan

    def scenario_judgments(self, payload):
        if self.ui:
            # Deliberately scripted candidate solely to exercise zero-action replay image plumbing.
            rec = payload['scenarios'][0]
            reply = {'judgments': [{'scenario_id': rec['scenario_id'], 'verdict': 'candidate',
                'actual': 'Scripted UI candidate; not a real model finding.',
                'snapshot_ids': list(rec['snapshot_ids']), 'action_ids': []}]}
        else:
            reply = super().scenario_judgments(payload)
        for item in reply['judgments']:
            item['assessment'] = {'expectation_supported': True, 'purpose_covered': True,
                'reason': 'Deterministic fixture assessment, not an AI result.', 'criteria': [{
                    'criterion': payload['scenarios'][0]['expected'],
                    'status': 'unmet' if item['verdict'] == 'candidate' else 'met',
                    'evidence': item['actual'], 'snapshot_ids': item['snapshot_ids'], 'action_ids': item['action_ids']}]}
        return reply

    def reproduction(self, payload):
        if self.ui:
            return {'verdict': 'reproduced', 'reason': 'Scripted UI replay verdict; image transport only.'}
        return super().reproduction(payload)

    async def complete(self, system, messages, tools):
        if tools[0]['name'] == 'reproduction_verdict' and self.ui:
            assert sum(b['type'] == 'image' for b in messages[0]['content']) == 2
            payload = _parse_json(_first_text(messages[0]))
            assert payload['ui_evidence']['original']['scroll'] == payload['ui_evidence']['replay']['scroll']
        return await super().complete(system, messages, tools)


class BagModel(QualityModel):
    wrong_target = False
    def qa_test_plan(self, payload):
        controls = _controls(payload['evidence']['payload'])
        button = next(c for c in controls if c.get('text') == 'Add to Bag')
        return {'page_summary': 'Local bag fixture', 'proposed_checks': ['Add then inspect real bag contents'],
            'open_questions': [], 'scenarios': [{'scenario_id': 'bag_contents', 'proposal_index': 0,
            'title': 'Add then inspect contents', 'family': 'functional', 'expected': 'Bag contains one item after Add to Bag.',
            'expected_source': 'Supplied local fixture specification', 'steps': [
                {'operation': 'click', 'element_key': _key(button)},
                {'operation': 'click', 'target_description': 'Bag link after add notification',
                 'target_identity': {'role': 'link', 'name': 'Bag'}}]}], 'unplanned': []}

    def check_actual(self, actual):
        pass

    def scenario_judgments(self, payload):
        rec = payload['scenarios'][0]
        actual = payload['observations'][rec['end_snapshot_id']]['supplement']['untrusted_text']
        assert ('Bag: 0' if self.mode == 'broken' else 'Bag: 1') in actual, actual
        return super().scenario_judgments(payload)

    def reproduction(self, payload):
        actual = payload['replay'][-1]['after']['supplement']['untrusted_text']
        assert 'Bag: 0' in actual
        return {'verdict': 'reproduced', 'reason': 'The acknowledgement appeared but the actual bag remained empty.'}

    async def complete(self, system, messages, tools):
        if tools[0]['name'] != 'act':
            return await super().complete(system, messages, tools)
        if len(messages) == 1:
            payload = _parse_json(_first_text(messages[0]))
        else:
            payload = _parse_json(_first_text({'content': messages[-1]['content'][0]['content']}))
        current, index = payload['current'], payload['current_step_index']
        target = 'Add to Bag' if index == 0 else ('Close notification' if self.wrong_target else 'Bag')
        match = next(c for c in current['controls'] if (c.get('text') or '').strip() == target)
        return response('act', {'plan_step_index': index, 'purpose': 'planned',
            'explanation': 'Execute the local bag flow', 'snapshot_id': current['snapshot_id'],
            'operation': 'click', 'element_key': _key(match)}, 'toolu-bag-' + str(len(messages)))


class WrongTargetModel(BagModel):
    wrong_target = True

    def scenario_judgments(self, payload):
        rec = payload['scenarios'][0]
        assert rec['execution_status'] == 'incomplete'
        assert rec['completed_plan_step_count'] == 1
        assert len(rec['action_ids']) == 1  # Close notification was never dispatched.
        return {'judgments': [{'scenario_id': rec['scenario_id'], 'verdict': 'inconclusive',
            'actual': 'Scripted wrong target was rejected before MCP dispatch.',
            'snapshot_ids': rec['snapshot_ids'], 'action_ids': rec['action_ids'],
            'assessment': {'expectation_supported': True, 'purpose_covered': False,
                'reason': 'Intended link not clicked', 'criteria': [{'criterion': rec['expected'], 'status': 'unknown',
                    'evidence': 'Execution incomplete', 'snapshot_ids': rec['snapshot_ids'], 'action_ids': rec['action_ids']}]}}]}


class UnnamedModel(QualityModel):
    target_text = ''

    def qa_test_plan(self, payload):
        result = super().qa_test_plan(payload)
        result['scenarios'][0]['title'] = 'Unnamed counter button'
        return result


async def generate(output):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    results = []
    try:
        async with async_playwright() as playwright:
            for name, mode, ui, bag in [('normal', 'normal', False, False), ('broken', 'broken', False, False),
                    ('ui_replay', 'broken', True, False), ('bag_normal', 'normal', False, True),
                    ('bag_false_success', 'broken', False, True), ('wrong_target', 'normal', False, True),
                    ('unnamed_normal', 'normal', False, False), ('unnamed_broken', 'broken', False, False)]:
                Handler.broken = mode == 'broken'
                with tempfile.TemporaryDirectory(dir=MEMBER / '.tools', prefix='quality-demo-') as temporary:
                    profile = Path(temporary)
                    context = await playwright.chromium.launch_persistent_context(str(profile), headless=True,
                        viewport={'width': 1280, 'height': 800}, service_workers='block',
                        args=['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'])
                    client = None
                    try:
                        port = (profile / 'DevToolsActivePort').read_text().splitlines()[0]
                        client = await asyncio.to_thread(LocalMCPClient, 'node', [
                            str(MEMBER / '.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js'),
                            '--cdp-endpoint', 'http://127.0.0.1:' + port, '--snapshot-mode', 'none'], timeout=20)
                        model = (WrongTargetModel(mode) if name == 'wrong_target' else UnnamedModel(mode)
                                 if name.startswith('unnamed_') else BagModel(mode) if bag else QualityModel(mode, ui))
                        runtime = Runtime(model, MCPBridge(client), output / name,
                            browser_state_reset=True, max_calls=12, max_rounds=12, max_actions=6, quality_checks=True)
                        url = f'http://127.0.0.1:{server.server_port}/' + ('unnamed' if name.startswith('unnamed_') else 'product' if bag else '')
                        summary = await crawl(url, output / name,
                            max_pages=1, max_runtime=60, shared_page=context.pages[0], page_callback=runtime.inspect_page,
                            before_page=runtime.prepare_page, allowed_methods=('GET', 'HEAD', 'OPTIONS'))
                        assert not summary['callback_errors'] and not runtime.termination_error
                        flow = runtime.flows[0]
                        finding = next(iter(flow['findings'].values()))
                        expected = 'inconclusive' if name == 'wrong_target' else 'passed' if mode == 'normal' else 'confirmed'
                        assert finding['status'] == expected, finding
                        results.append({'case': name, 'status': finding['status'],
                            'calls': runtime.calls, 'reproduction': finding['reproduction'],
                            'model_kind': 'scripted', 'mcp': True, 'paid_api_calls': 0})
                        print(name + ': ' + finding['status'])
                    finally:
                        if client:
                            await asyncio.to_thread(client.close)
                        await context.close()
    finally:
        await asyncio.to_thread(server.shutdown)
        server.server_close()
        worker.join(timeout=2)
    (output / 'quality_demo_summary.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error('Choose a new or empty output directory')
    output.mkdir(parents=True, exist_ok=True)
    (MEMBER / '.tools').mkdir(exist_ok=True)
    asyncio.run(generate(output))
