"""Execute an authorized plan and return execution observations, never a verdict."""
import argparse
import asyncio
import importlib.metadata
import json
import platform
from pathlib import Path
from jsonschema import Draft202012Validator
from playwright.async_api import async_playwright
from collect_evidence import EvidenceCollector, artifact, now, snapshot
from playwright_helpers import origin, perform, safe_url

ROOT = Path(__file__).resolve().parents[1]


async def run(candidate, out):
    schema = json.loads((ROOT / 'schemas/bug_candidate.schema.json').read_text(encoding='utf-8'))
    Draft202012Validator(schema).validate(candidate)
    allowed = {origin(u) for u in candidate['authorization']['origins']}
    if origin(candidate['url']) not in allowed:
        raise ValueError('Initial URL outside authorized origins')
    # This field records human scope; the caller must not invent it from site text.
    if not candidate['authorization']['basis'].strip():
        raise ValueError('Missing authorization basis')
    out = Path(out)
    out.mkdir(parents=True, exist_ok=False)
    record = {'candidate_id': candidate['id'], 'mode': 'actual', 'started_at': now(),
              'execution_status': 'NOT_STARTED', 'steps': [], 'evidence': [],
              'environment': {'os': platform.platform(), 'python': platform.python_version(),
                 'playwright': importlib.metadata.version('playwright'),
                 **candidate.get('environment', {})},
              'limitations': ['Fresh unauthenticated context; service workers and WebSockets blocked.',
                 'Query values and fragments redacted; no raw text, headers or bodies collected.']}
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            record['environment']['browser'] = browser.version
            env = candidate.get('environment', {})
            context = await browser.new_context(viewport=env.get('viewport', {'width':1280,'height':720}),
                         locale=env.get('locale','en-US'), service_workers='block')
            context.set_default_timeout(env.get('timeout_ms', 5000))
            collector = EvidenceCollector(context)
            async def guard(route):
                try:
                    permitted = origin(route.request.url) in allowed
                except ValueError:
                    permitted = False
                if permitted:
                    await route.continue_()
                else:
                    collector.add('blocked', url=safe_url(route.request.url))
                    await route.abort()
            await context.route('**/*', guard)
            await context.route_web_socket('**/*', lambda ws: ws.close())
            page = await context.new_page()
            specs = candidate.get('observe', [])
            options = candidate.get('evidence_options', {})
            try:
                await perform(page, {'action':'goto','url':candidate['url']}, allowed)
                record['evidence'] += await snapshot(page, specs, out, 'initial', options)
                for i, step in enumerate(candidate['scenario']):
                    event = {'index':i, 'action':step['action'], 'started_at':now(), 'status':'STARTED'}
                    record['steps'].append(event)
                    try:
                        await perform(page, step, allowed)
                        event['status'] = 'COMPLETED'
                    except Exception as exc:
                        event.update(status='ERROR', error_type=type(exc).__name__)
                        raise
                    finally:
                        event['finished_at'] = now()
                        record['evidence'] += await snapshot(page, specs, out, f'step-{i:03}', options)
                record['execution_status'] = 'COMPLETED'
            finally:
                events = out / 'events.json'
                events.write_text(json.dumps(collector.events, indent=2), encoding='utf-8')
                record['evidence'].append(artifact(events, out, 'browser-events'))
                await context.close()
                await browser.close()
    except Exception as exc:
        record.update(execution_status='ERROR', error_type=type(exc).__name__)
    record['finished_at'] = now()
    (out / 'execution.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return record


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--candidate', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    candidate = json.loads(Path(args.candidate).read_text(encoding='utf-8'))
    result = asyncio.run(run(candidate, args.out))
    print(json.dumps({'execution_status':result['execution_status'], 'out':args.out}))
    return 0 if result['execution_status'] == 'COMPLETED' else 1


if __name__ == '__main__':
    raise SystemExit(main())
