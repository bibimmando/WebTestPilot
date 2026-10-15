import argparse
import asyncio
import importlib.metadata
import json
import platform
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from playwright.async_api import async_playwright
from browser_actions import origin, perform, safe_url
from collect_evidence import collect, now

ROOT = Path(__file__).resolve().parents[1]

async def run(plan, out):
    schema = json.loads((ROOT/'schemas/bug_candidate.schema.json').read_text(encoding='utf-8'))
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(plan)
    allowed = {origin(u) for u in plan['authorization']['origins']}
    if origin(plan['url']) not in allowed:
        raise ValueError('Initial URL outside authorized scope')
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    record = {'candidate_id':plan['id'], 'started_at':now(), 'mode':'actual',
              'execution_status':'NOT_STARTED', 'steps':[], 'artifacts':[],
              'environment':{'os':platform.platform(), 'playwright':importlib.metadata.version('playwright')},
              'limitations':['Fresh unauthenticated context; WebSockets/service workers blocked.',
                            'No raw text, headers, bodies or full accessibility tree collected.']}
    events = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            record['environment']['browser'] = browser.version
            env = plan.get('environment', {})
            context = await browser.new_context(viewport=env.get('viewport', {'width':1280,'height':720}),
                                                locale=env.get('locale','en-US'), service_workers='block')
            context.set_default_timeout(env.get('timeout_ms',5000))
            try:
                async def guard(route):
                    try:
                        permitted = origin(route.request.url) in allowed
                    except ValueError:
                        permitted = False
                    if permitted:
                        await route.continue_()
                    else:
                        events.append({'type':'blocked', 'url':safe_url(route.request.url)})
                        await route.abort()
                await context.route('**/*', guard)
                await context.route_web_socket('**/*', lambda ws: ws.close())
                context.on('response', lambda r: events.append({'type':'response','status':r.status,'url':safe_url(r.url)}))
                page = await context.new_page()
                page.on('console', lambda m: events.append({'type':'console','level':m.type}))
                page.on('pageerror', lambda _: events.append({'type':'pageerror'}))
                await perform(page, {'action':'goto','url':plan['url']}, allowed)
                record['artifacts'] += await collect(page, plan.get('observe',[]), out, 'initial', plan.get('evidence_options'))
                for i, step in enumerate(plan['scenario']):
                    event = {'index':i,'action':step['action'],'started_at':now(),'status':'STARTED'}
                    record['steps'].append(event)
                    try:
                        await perform(page, step, allowed)
                        event['status'] = 'COMPLETED'
                    except Exception as exc:
                        event.update(status='ERROR',error_type=type(exc).__name__,execution_certainty='unknown')
                        raise
                    finally:
                        event['finished_at'] = now()
                        record['artifacts'] += await collect(page, plan.get('observe',[]), out, f'step-{i:03}', plan.get('evidence_options'))
                record['execution_status'] = 'COMPLETED'
            finally:
                await context.close()
                await browser.close()
    except Exception as exc:
        record.update(execution_status='ERROR',error_type=type(exc).__name__)
    (out/'events.json').write_text(json.dumps(events, indent=2), encoding='utf-8')
    record['artifacts'].append({'id':'events','path':'events.json','type':'log','candidate_ids':[plan['id']]})
    for item in record['artifacts']:
        item['candidate_ids'] = [plan['id']]
    record['finished_at'] = now()
    (out/'execution.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return record

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan',required=True)
    ap.add_argument('--out',required=True)
    args = ap.parse_args()
    record = asyncio.run(run(json.loads(Path(args.plan).read_text(encoding='utf-8')),args.out))
    print(json.dumps({'execution_status':record['execution_status'],'out':args.out}))
    raise SystemExit(0 if record['execution_status']=='COMPLETED' else 1)
