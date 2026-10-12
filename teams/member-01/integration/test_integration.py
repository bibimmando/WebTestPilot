"""Runnable contract and real MCP integration checks: python -m integration.test_integration."""
import asyncio
import json
import os
import pathlib
import tempfile
import threading
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
from playwright.async_api import async_playwright
from .preprocessor import crawl
from .mcp import MCPBridge, LocalMCPClient
from .models import to_openai_messages, parse_sse, openai_to_native, map_stop, validate_message, ModelError
from .runtime import Runtime


def response(name, args, request_id):
    return {'role': 'assistant', 'stop_reason': 'tool_use',
            'content': [{'type': 'tool_use', 'id': request_id, 'name': name, 'input': args}]}


from .test_staged import FixtureModel


class Handler(BaseHTTPRequestHandler):
    broken = False
    post_on_click = False
    posts = 0
    def log_message(self, *args): pass
    def do_POST(self):
        Handler.posts += 1
        self.send_response(200); self.end_headers()
    def do_GET(self):
        if self.path == '/robots.txt':
            content = 'User-agent: *\nDisallow: /blocked\n'
            mime = 'text/plain'
        else:
            script = '' if Handler.broken else "document.getElementById('count').textContent='Count: 1'"
            if Handler.post_on_click:
                script += ";fetch('/write',{method:'POST'})"
            content = f'''<!doctype html><html><head><title>Counter</title></head><body>
            <h1>Counter</h1><button id="increment" onclick="{script}">Increment</button>
            <output id="count">Count: 0</output><a href="/second">Second page</a>
            <a href="/blocked">Blocked page</a></body></html>'''
            mime = 'text/html'
        self.send_response(200); self.send_header('Content-Type', mime); self.end_headers(); self.wfile.write(content.encode())


def pure_checks():
    from . import models
    with tempfile.TemporaryDirectory(dir=ROOT/'.tools', prefix='env-check-') as directory:
        env_file = pathlib.Path(directory)/'.env'
        env_file.write_text('TIMELYGPT_API_KEY="fixture-${LITERAL}"\nANTHROPIC_API_KEY=fixture-claude\nUNRELATED=private\n', encoding='utf-8-sig')
        with patch.object(models, 'ENV_FILE', env_file), patch.dict(os.environ, {}, clear=True):
            assert models.HTTPModel('timely')._key() == 'fixture-${LITERAL}'
            assert models.HTTPModel('anthropic', model='fixture')._key() == 'fixture-claude'
            assert 'TIMELYGPT_API_KEY' not in os.environ and 'UNRELATED' not in os.environ
            os.environ['TIMELYGPT_API_KEY'] = 'environment-wins'
            assert models.HTTPModel('timely')._key() == 'environment-wins'
        env_file.write_text('TIMELYGPT_API_KEY=\n', encoding='utf-8')
        with patch.object(models, 'ENV_FILE', env_file), patch.dict(os.environ, {}, clear=True):
            try: models.HTTPModel('timely')._key()
            except ModelError: pass
            else: raise AssertionError('empty .env key accepted')
    print('PASS .env providers, literal values, environment precedence and empty-key rejection (no API call)')
    acc = parse_sse([
        'data: '+json.dumps({'model':'fixture','choices':[{'delta':{'tool_calls':[{'index':0,'id':'real-id','function':{'name':'act','arguments':'{"operation":'}}]}}]}),
        'data: '+json.dumps({'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'arguments':'"click"}'}}]},'finish_reason':'tool_calls'}]}),
        'data: [DONE]'])
    native = validate_message(openai_to_native(acc, map_stop(acc), {}, 'fixture'))
    assert native['content'][0]['id'] == 'real-id'
    converted = to_openai_messages('test', [{'role':'assistant','content':native['content']},
        {'role':'user','content':[{'type':'tool_result','tool_use_id':'real-id','content':[
            {'type':'text','text':'result'}, {'type':'image','source':{'type':'base64','media_type':'image/png','data':'AA=='}}]}]}])
    assert converted[2]['tool_call_id'] == 'real-id'
    assert converted[3]['content'][1]['type'] == 'image_url'
    try: validate_message({'role':'assistant','content':[],'stop_reason':'max_tokens'})
    except ModelError: pass
    else: raise AssertionError('truncated response accepted')


async def schema_checks():
    # Malformed arguments must count as a not-executed attempt, not escape the one-correction rule.
    root=ROOT/'output/integration-checks'
    root.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root,prefix='schema-') as directory:
        class Collector:
            _sanitize=staticmethod(lambda value:value)
        class Evidence:
            collector=Collector()
            last_snapshot={'snapshot_id':'s'}
            snapshots={'s':last_snapshot}
            def get_element(self,*args):return None
        class Page:url='http://127.0.0.1/'
        runtime=Runtime(None,None,directory)
        flow={'flow_id':'schema-flow','execution_unknown':False,'observation_incomplete':False,
              'actions':0,'snapshot_ids':['s'],'replaying':False,'steps':[],'attempts':{},
              'corrections':{},'pending_correction':None,'correction_failed':False,'status':'running'}
        first=await runtime.handle_tool('act',{'snapshot_id':'s','operation':'fill','value':17},'schema-first',Page(),Evidence(),flow)
        assert first[0]['execution']=='not_executed'
        second=await runtime.handle_tool('act',{'snapshot_id':'s','operation':'fill','value':'safe','element_key':'absent',
            'correction_of':first[0]['action_id']},'schema-second',Page(),Evidence(),flow)
        assert flow['correction_failed'] and len(flow['corrections'])==1
        third=await runtime.handle_tool('act',{'snapshot_id':'s','operation':'fill','value':'safe','element_key':'absent',
            'correction_of':second[0]['action_id']},'schema-third',Page(),Evidence(),flow)
        assert third[0]['execution']=='not_executed'
        assert third[0]['error']['message']=='failed correction closes action dispatch for this flow'
        print('PASS malformed schema: one correction, no correction chain')


async def live_checks():
    root = ROOT/'output/integration-checks'
    root.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    try:
        with tempfile.TemporaryDirectory(dir=root, prefix='run-') as directory:
            folder = pathlib.Path(directory)
            async with async_playwright() as pw:
                profile = folder/'profile'
                context = await pw.chromium.launch_persistent_context(str(profile), headless=True,
                    args=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'], service_workers='block')
                port = (profile/'DevToolsActivePort').read_text().splitlines()[0]
                client = await asyncio.to_thread(LocalMCPClient, 'node', [str(ROOT/'.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js'),
                    '--cdp-endpoint',f'http://127.0.0.1:{port}','--output-dir',str(folder/'mcp'),'--snapshot-mode','none'],timeout=20)
                bridge = MCPBridge(client)
                try:
                    for mode in ('normal','broken'):
                        Handler.broken = mode == 'broken'
                        output = folder/mode
                        model = FixtureModel(mode)
                        class PlannedBridge:
                            async def execute(self, *args):
                                flow = runtime.flow
                                assert (output/'flows'/flow['flow_id']/'test_plan.json').is_file()
                                if flow['stage'] == 'execution':
                                    assert flow['rounds'] == 2, 'execution action requires a model tool call'
                                return await bridge.execute(*args)
                        runtime = Runtime(model, PlannedBridge(), output, browser_state_reset=mode=='broken')
                        summary = await crawl(url, output, max_pages=2 if mode=='normal' else 1,max_runtime=90,
                            page_callback=runtime.inspect_page,shared_page=context.pages[0],allowed_methods=('GET','HEAD','OPTIONS'),
                            before_page=runtime.prepare_page)
                        assert not summary['callback_errors'],summary
                        assert not runtime.termination_error, runtime.flows
                        assert not context.pages[0].is_closed()
                        flow = runtime.flows[0]
                        assert flow['status']=='completed', flow['status']
                        if mode=='normal':
                            assert len(runtime.flows)==2
                            assert all(f['test_status']=='passed' for f in runtime.flows)
                        else:
                            finding = next(iter(flow['findings'].values()))
                            assert finding['status']=='confirmed',finding
                            assert finding['reproduction']['status']=='reproduced'
                            assert finding['reproduction']['attempts']==1
                            assert flow['test_status']=='failed'
                        report=json.loads((output/'report.json').read_text())
                        assert report['run_id']==runtime.run_id
                        assert report['pipeline']=='staged/3' and 'stages' in report['timings']
                        assert len(report['timings']['model_calls']) == runtime.calls
                        assert report['timings']['actions'].get('dispatch_s') is not None
                        initial=json.loads((output/'snapshots'/(flow['initial_snapshot_id']+'.json')).read_text())
                        assert initial['capture_mode']=='full' and initial['artifacts']['screenshot']
                        assert pathlib.Path(initial['artifacts']['screenshot']).is_file()
                        for attempt in flow['attempts'].values():
                            if attempt['execution']=='executed':
                                assert (output/'actions'/(attempt['action_id']+'.json')).is_file()
                                assert (output/'snapshots'/(attempt['after_snapshot_id']+'.json')).is_file()
                                for ref in ('before_snapshot_id','after_snapshot_id'):
                                    snap=json.loads((output/'snapshots'/(attempt[ref]+'.json')).read_text())
                                    assert snap['capture_mode']=='light' and snap['artifacts']['screenshot'] is None
                                    assert snap['artifacts']['skipped_reason']=='mid_action_light'
                                    assert (output/'ai_inputs'/(attempt[ref]+'.json')).is_file()
                                    assert any(e.get('locator_status')=='verified' for e in snap['elements'])
                                t=attempt['timings']
                                assert all(t[k] is not None for k in ('dispatch_s','settle_s','before_capture_s','after_capture_s')),t
                        print('PASS real MCP flow:',mode)
                    class VisualModel(FixtureModel):
                        scenario_id = 'visual'
                        def qa_test_plan(self, payload):
                            value = dict(super().qa_test_plan(payload))
                            value.update({'scenarios': [{'scenario_id': 'visual', 'proposal_index': 0,
                                'title': 'Counter viewport', 'family': 'ui',
                                'expected': 'Counter UI is visible.', 'expected_source': 'fixture requirement',
                                'steps': []}], 'unplanned': []})
                            return value
                    visual_model = VisualModel()
                    runtime = Runtime(visual_model, bridge, folder/'visual')
                    await crawl(url, folder/'visual', max_pages=1, max_runtime=60,
                                page_callback=runtime.inspect_page, shared_page=context.pages[0])
                    assert runtime.flows[0]['test_status'] == 'passed', runtime.flows[0]['errors']
                    assert runtime.flows[0]['actions'] == 0 and runtime.calls == 2
                    assert any(b['type'] == 'image' for b in visual_model.requests[-1]['messages'][0]['content'])
                    assert len(list((folder/'visual/images').glob('*.png'))) == 1
                    print('PASS UI plan: real viewport image -> independent judgment, no action needed')
                    # A tool can perform the action and then fail to acknowledge it.
                    # The engine must preserve uncertainty and never retry the mutation.
                    Handler.broken = False
                    class UnknownBridge:
                        calls = 0
                        async def execute(self,*args):
                            self.calls += 1
                            value = await bridge.execute(*args)
                            assert value['execution'] == 'executed'
                            value.update(execution='unknown', error={'code':'ack_lost','message':'unknown'})
                            return value
                    unknown = UnknownBridge()
                    runtime = Runtime(FixtureModel(),unknown,folder/'unknown')
                    await crawl(url,folder/'unknown',max_pages=1,max_runtime=60,
                                page_callback=runtime.inspect_page,shared_page=context.pages[0])
                    assert unknown.calls==1 and runtime.calls==3
                    assert runtime.flows[0]['status']=='unknown_execution'
                    assert runtime.flows[0]['test_status']=='not_run'
                    assert await context.pages[0].locator('#count').inner_text()=='Count: 1'
                    print('PASS unknown execution: no automatic retry')
                    Handler.post_on_click = True
                    runtime = Runtime(FixtureModel(),bridge,folder/'policy')
                    await crawl(url,folder/'policy',max_pages=1,max_runtime=60,
                                page_callback=runtime.inspect_page,shared_page=context.pages[0],
                                allowed_methods=('GET','HEAD','OPTIONS'))
                    assert Handler.posts==0
                    assert next(iter(runtime.flows[0]['attempts'].values()))['policy_blocked']
                    assert runtime.flows[0]['test_status']=='not_run'
                    print('PASS read-only request policy: blocked request is not an application verdict')
                    Handler.post_on_click = False
                    runtime = Runtime(FixtureModel(),bridge,folder/'capture-failure')
                    async def broken_capture_callback(page,snapshot,evidence):
                        original = evidence.collector.snapshot
                        async def capture(trigger='initial_load',*args,**kw):
                            if trigger=='after_action':raise RuntimeError('fixture capture failure')
                            return await original(trigger,*args,**kw)
                        evidence.collector.snapshot = capture
                        return await runtime.inspect_page(page,snapshot,evidence)
                    await crawl(url,folder/'capture-failure',max_pages=1,max_runtime=60,
                                page_callback=broken_capture_callback,shared_page=context.pages[0])
                    attempt=next(iter(runtime.flows[0]['attempts'].values()))
                    assert attempt['execution']=='executed' and attempt['observation_status']=='incomplete'
                    assert runtime.flows[0]['actions']==1 and runtime.flows[0]['test_status']=='not_run'
                    assert await context.pages[0].locator('#count').inner_text()=='Count: 1'
                    print('PASS observation failure: action is executed, no repeat')
                    started=asyncio.Event()
                    class CancelBridge:
                        async def execute(self,*args):
                            value=await bridge.execute(*args)
                            assert value['execution']=='executed'
                            started.set()
                            await asyncio.Event().wait()
                    runtime=Runtime(FixtureModel(),CancelBridge(),folder/'cancelled')
                    task=asyncio.create_task(crawl(url,folder/'cancelled',max_pages=1,max_runtime=60,
                        page_callback=runtime.inspect_page,shared_page=context.pages[0]))
                    await asyncio.wait_for(started.wait(),30)
                    task.cancel()
                    try:await task
                    except asyncio.CancelledError:pass
                    else:raise AssertionError('cancellation swallowed')
                    assert runtime.flows[0]['status']=='cancelled'
                    assert (folder/'cancelled/report.json').is_file()
                    assert (folder/'cancelled/run_summary.json').is_file()
                    assert await context.pages[0].locator('#count').inner_text()=='Count: 1'
                    print('PASS cancellation: partial evidence and report persisted')
                finally:
                    await asyncio.to_thread(client.close)
                    await context.close()
    finally:
        server.shutdown();server.server_close()


def main():
    pure_checks()
    asyncio.run(schema_checks())
    asyncio.run(live_checks())
    print('PASS translation, ID/evidence links, two-page FIFO, one correction, one real replay')


if __name__=='__main__': main()
