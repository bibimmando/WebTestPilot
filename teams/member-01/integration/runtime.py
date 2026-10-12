"""Shared evidence, MCP execution and recording for the staged QA pipeline."""
from __future__ import annotations

import asyncio
import base64
import copy
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError
from .preprocessor.crawl import normalize_url, same_origin
from .models import validate_message, ModelError
from .reset import maison_start, browser_start, preload_storage


def tool(name, description, properties, required=()):
    return {'name': name, 'description': description, 'input_schema': {
        'type': 'object', 'properties': properties, 'required': list(required), 'additionalProperties': False}}


STRING = {'type': 'string', 'maxLength': 4000}
REFS = {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 100, 'uniqueItems': True}
TOOLS = [
    tool('act', 'Execute one supported action on the latest observed page. Use only observed keys/URLs.', {
        'snapshot_id': STRING, 'operation': {'enum': ['click', 'fill', 'press', 'navigate']},
        'element_key': STRING, 'url': STRING, 'value': STRING, 'correction_of': STRING,
    }, ('snapshot_id', 'operation')),
    tool('observe', 'Collect a fresh page summary; request a real viewport image for visual questions.', {
        'include_image': {'type': 'boolean'}}),
    tool('finding', 'Record a judgment with real evidence references. Candidate means suspected, not confirmed.', {
        'family': {'enum': ['functional', 'input_validation', 'routing', 'ui']},
        'verdict': {'enum': ['passed', 'candidate', 'inconclusive']},
        'expected': STRING, 'expected_source': STRING, 'actual': STRING,
        'snapshot_ids': REFS, 'action_ids': REFS,
    }, ('family', 'verdict', 'expected', 'expected_source', 'actual', 'snapshot_ids', 'action_ids')),
    tool('reproduce', 'Replay the recorded candidate once, only with an approved initial condition.', {
        'finding_id': STRING}, ('finding_id',)),
]

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def uid(prefix):
    return prefix + '-' + uuid.uuid4().hex[:16]


class RequestError(ValueError):
    """Program-authored explanation safe to send back for one correction."""


class Runtime:
    def __init__(self, model, bridge, output, *, max_rounds=12, max_actions=20,
                 max_calls=60, allow_writes=False, site_requirements='', browser_state_reset=False, maison_reset=False,
                 execution_model=None, judgment_model=None):
        for n in (max_rounds, max_actions, max_calls):
            if isinstance(n, bool) or not isinstance(n, int) or n < 1:
                raise ValueError('inspection limits must be positive integers')
        self.model, self.bridge, self.output = model, bridge, Path(output)
        self.execution_model = execution_model if execution_model is not None else model
        self.judgment_model = judgment_model if judgment_model is not None else model
        self.max_rounds, self.max_actions, self.max_calls = max_rounds, max_actions, max_calls
        self.allow_writes, self.site_requirements = allow_writes, site_requirements or ''
        self.browser_state_reset = browser_state_reset
        self.maison_reset, self._prepared_start = maison_reset, None
        self.run_id, self.calls, self.usage, self.flows = uid('run'), 0, [], []
        self.flow = None
        self.termination_error = None

    async def prepare_page(self, page, url):
        self._prepared_start = None
        if self.maison_reset:
            self._prepared_start = await maison_start(page, url)
            return await preload_storage(page, url)
        elif self.browser_state_reset and not self.allow_writes:
            self._prepared_start = await browser_start(page, url)

    def persist(self, evidence, flow):
        safe = evidence.collector._sanitize
        folder = self.output / 'flows' / flow['flow_id']
        # Browser state and replay inputs remain private in memory.
        public = {k: v for k, v in flow.items() if k not in ('messages', 'steps', '_start', '_stage_t')}
        public['steps'] = [{k: v for k, v in step.items() if k != 'value'} for step in flow['steps']]
        write_json(folder / 'flow.json', safe(public))
        transcript = copy.deepcopy(flow['messages'])
        for message in transcript:
            for block in message.get('content', []):
                parts = block.get('content', []) if block.get('type') == 'tool_result' else [block]
                if isinstance(parts, list):
                    for part in parts:
                        if part.get('type') == 'image':
                            part['source'] = {'type': 'omitted', 'reason': 'see image.path references in scenario_results'}
        write_json(folder / 'messages.json', safe(transcript))
        write_json(folder / 'findings.json', safe(list(flow['findings'].values())))
        stages, actions, model_calls = {}, {}, []
        for item in self.flows:
            timings = item.get('timings') or {}
            for key, value in timings.get('stages', {}).items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    stages[key] = round(stages.get(key, 0) + value, 4)
            model_calls.extend({'flow_id': item['flow_id'], **call} for call in timings.get('model_calls', []))
            for attempt in item.get('attempts', {}).values():
                for key, value in (attempt.get('timings') or {}).items():
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        actions[key] = round(actions.get(key, 0) + value, 4)
        write_json(self.output / 'report.json', safe({
            'schema_version': 'inspection_report/1', 'pipeline': 'staged/3', 'run_id': self.run_id, 'calls': self.calls,
            'timings': {'stages': stages, 'actions': actions, 'model_calls': model_calls,
                        'model_total_s': round(sum(c['seconds'] for c in model_calls), 4)},
            'usage': self.usage, 'flows': [{k: f[k] for k in ('flow_id', 'initial_snapshot_id', 'status', 'test_status')}
                                        for f in self.flows],
            'findings': [f for item in self.flows for f in item['findings'].values()],
        }))

    def append_execution(self, evidence, flow, result):
        safe = evidence.collector._sanitize(result)
        folder = self.output / 'flows' / flow['flow_id']
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / 'execution_results.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(safe, ensure_ascii=False) + '\n')
        flow['attempts'][result['action_id']] = safe

    def observation(self, evidence, snapshot):
        sid = snapshot['snapshot_id']
        return {
            'observation': evidence.get_ai_input(sid),
            'supplement': {'snapshot_id': sid, 'untrusted_text': snapshot.get('text', '')[:6000],
                           'env': snapshot.get('env', {}), 'readiness': snapshot.get('readiness', {}),
                           'action_context': copy.deepcopy(snapshot.get('action_context') or {}),
                           'policy_blocks': [e for e in snapshot.get('events', []) if e.get('type') == 'policy_block']},
        }

    async def inspect_page(self, page, initial_snapshot, evidence):
        from .staged import inspect_page
        return await inspect_page(self, page, initial_snapshot, evidence)

    async def handle_tool(self, name, args, request_id, page, evidence, flow):
        definition = next((t for t in TOOLS if t['name'] == name), None)
        if definition is None:
            raise ValueError('unknown inspection tool')
        if name == 'act':
            return await self.act(args, request_id, page, evidence, flow), []
        Draft202012Validator(definition['input_schema']).validate(args)
        if name == 'observe':
            # A real viewport PNG is captured below; skip the duplicate full-page PNG only then.
            snapshot = await evidence.take_snapshot('inspection_observe', evidence.last_snapshot['snapshot_id'],
                                                    light=True)
            flow['snapshot_ids'].append(snapshot['snapshot_id'])
            result, images = self.observation(evidence, snapshot), []
            if args.get('include_image'):
                image_path = self.output / 'images' / (snapshot['snapshot_id'] + '.png')
                image_path.parent.mkdir(parents=True, exist_ok=True)
                data = await page.screenshot(path=str(image_path), full_page=False)
                scroll = await page.evaluate('() => ({x: scrollX, y: scrollY})')
                relative = str(image_path.relative_to(self.output))
                result['image'] = {'path': relative, 'snapshot_id': snapshot['snapshot_id'],
                                   'viewport': page.viewport_size, 'scroll': scroll, 'full_page': False,
                                   'association': 'temporal_after_snapshot',
                                   'captured_at': datetime.now(timezone.utc).isoformat()}
                flow['image_refs'][snapshot['snapshot_id']] = result['image']
                images = [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png',
                                                      'data': base64.b64encode(data).decode()}}]
            return result, images
        if name == 'finding':
            if not args['snapshot_ids'] or not set(args['snapshot_ids']).issubset(flow['snapshot_ids']):
                raise ValueError('finding snapshot references are invalid')
            if not set(args['action_ids']).issubset(flow['attempts']):
                raise ValueError('finding action references are invalid')
            if not all(args[k].strip() for k in ('expected', 'expected_source', 'actual')):
                raise ValueError('finding requires actual and expected evidence')
            if args['verdict'] != 'inconclusive':
                if any(flow['attempts'][a]['execution'] != 'executed' or
                       flow['attempts'][a]['observation_status'] != 'available' for a in args['action_ids']):
                    raise ValueError('incomplete execution cannot support a conclusive finding')
                if any(flow['attempts'][a].get('policy_blocked') for a in args['action_ids']):
                    raise ValueError('program restrictions require an inconclusive judgment')
                if not args['action_ids'] and not (args['family'] == 'ui' and any(s in flow['image_refs'] for s in args['snapshot_ids'])):
                    raise ValueError('finding requires actual action or UI image evidence')
            finding = dict(args, schema_version='finding/1', finding_id=uid('finding'), run_id=self.run_id,
                           flow_id=flow['flow_id'], status=args['verdict'], reproduction={'status': 'not_attempted'})
            flow['findings'][finding['finding_id']] = finding
            return finding, []
        from .reproduction import reproduce
        return await reproduce(self, page, evidence, flow, args['finding_id']), []

    async def act(self, args, request_id, page, evidence, flow):
        aid = uid('action')
        result = {'schema_version': 'execution_result/1', 'run_id': self.run_id, 'flow_id': flow['flow_id'],
                  'action_id': aid, 'tool_use_id': request_id, 'phase': 'reproduction' if flow['replaying'] else 'inspection',
                  'correction_of': args.get('correction_of'), 'execution': 'not_executed',
                  'operation': args.get('operation'),
                  'observation_status': 'incomplete', 'error': None, 'before_snapshot_id': None,
                  'after_snapshot_id': None, 'event_ids': [], 'resource_ids': [],
                  'timings': {'dispatch_s': None, 'settle_s': None, 'before_capture_s': None, 'after_capture_s': None}}
        result.update(scenario_id=flow.get('active_scenario_id'), step_index=flow.get('active_step_index'),
                      plan_tool_use_id=flow.get('plan_tool_use_id'))
        record = None
        try:
            if flow['execution_unknown'] or flow['observation_incomplete']:
                raise RequestError('flow cannot dispatch another action after incomplete execution or observation')
            if flow['actions'] >= self.max_actions:
                flow['status'] = 'max_actions'
                raise RequestError('action limit reached')
            flow['actions'] += 1
            Draft202012Validator(TOOLS[0]['input_schema']).validate(args)
            sid, op, key = args['snapshot_id'], args['operation'], args.get('element_key')
            if sid != evidence.last_snapshot['snapshot_id'] or sid not in flow['snapshot_ids']:
                raise RequestError('stale snapshot: observe before acting')
            correction = args.get('correction_of')
            result['operation'] = op
            if flow['correction_failed']:
                raise RequestError('failed correction closes action dispatch for this flow')
            if flow['pending_correction'] and correction != flow['pending_correction']:
                raise RequestError('link the one correction to the unresolved request')
            if correction:
                old = flow['attempts'].get(correction)
                if not old or old['execution'] != 'not_executed' or old.get('correction_of') or flow['corrections'].get(correction):
                    raise RequestError('correction is unavailable')
                if old.get('operation') in ('click', 'fill', 'press', 'navigate') and old.get('operation') != op:
                    raise RequestError('correction must retain operation')
                flow['corrections'][correction] = aid
            value = args.get('value')
            if op == 'navigate':
                target = normalize_url(args.get('url', ''))
                observed = set()
                for s in flow['snapshot_ids']:
                    captured = evidence.private_links.get(s, {})
                    for link in captured.get('links', []):
                        try:
                            observed.add(normalize_url(link.get('url'), captured.get('url', page.url)))
                        except (ValueError, TypeError):
                            continue  # mailto/tel/javascript are not navigable HTTP URLs.
                if not same_origin(target, flow['initial_url']) or target not in observed:
                    raise RequestError('navigation requires an observed same-origin URL')
                value, key = target, None
            else:
                detail = evidence.get_element(key, sid)
                if not detail or detail.get('locator_status') != 'verified':
                    raise RequestError('target must have a verified current locator')
            async with evidence.action(action_id=aid, kind=op, target_key=key, light=True) as record:
                detail = evidence.get_element(key, record['before_snapshot_id']) if key else None
                t0 = time.perf_counter()
                try:
                    dispatched = await self.bridge.execute(page, detail, op, value)
                finally:
                    result['timings']['dispatch_s'] = round(time.perf_counter() - t0, 4)
                result.update(dispatched)
                if dispatched['execution'] == 'executed':
                    t1 = time.perf_counter()
                    try:
                        await page.wait_for_load_state('domcontentloaded', timeout=3000)
                        ready = evidence.collector.ready_selector
                        if ready:
                            await page.locator(ready).wait_for(state='visible', timeout=3000)
                        else:
                            await page.wait_for_timeout(100)
                        if flow.get('settle_wait_ms', 0):
                            await page.wait_for_timeout(flow['settle_wait_ms'])
                    except Exception:
                        result['settle_error'] = 'readiness_unverified'
                    finally:
                        result['timings']['settle_s'] = round(time.perf_counter() - t1, 4)
            if record['after_snapshot_id'] and not record.get('capture_error') and not result.get('settle_error'):
                result['observation_status'] = 'available'
        except asyncio.CancelledError:
            result['error'] = 'cancelled'
            if record is not None and result['execution'] == 'not_executed':
                result['execution'] = 'unknown'
            raise
        except Exception as exc:
            result['error'] = {'code': type(exc).__name__, 'message': str(exc) if isinstance(exc, RequestError) else 'action incomplete'}
            if record is not None and result['execution'] == 'not_executed' and record.get('operator_error'):
                result['execution'] = 'unknown'
        finally:
            if record:
                for field in ('before_snapshot_id', 'after_snapshot_id', 'diff', 'event_ids', 'resource_ids', 'capture_error', 'operator_error'):
                    result[field] = record.get(field)
                for field in ('before_capture_s', 'after_capture_s'):
                    result['timings'][field] = record.get(field)
                for field in ('before_snapshot_id', 'after_snapshot_id'):
                    ref = result[field]
                    if ref and ref in evidence.snapshots:
                        if ref not in flow['snapshot_ids']:
                            flow['snapshot_ids'].append(ref)
                        result['before' if field.startswith('before') else 'after'] = self.observation(evidence, evidence.snapshots[ref])
                after = evidence.snapshots.get(result['after_snapshot_id'], {})
                result['policy_blocked'] = any(e.get('type') == 'policy_block' and e.get('action_id') == aid
                                               for e in after.get('events', []))
            if result['execution'] == 'unknown':
                flow['execution_unknown'] = True
            if result['execution'] == 'executed' and result['observation_status'] != 'available':
                flow['observation_incomplete'] = True
            if result['execution'] == 'not_executed':
                if args.get('correction_of') or flow['pending_correction']:
                    flow['correction_failed'] = True
                flow['pending_correction'] = aid
            else:
                flow['pending_correction'] = None
            step = {**args, 'action_id': aid, 'execution': result['execution'],
                    'before_snapshot_id': result['before_snapshot_id'], 'after_snapshot_id': result['after_snapshot_id'],
                    'phase': result['phase'], 'scenario_id': result['scenario_id'],
                    'step_index': result['step_index'], 'plan_tool_use_id': result['plan_tool_use_id'],
                    'wait_ms': flow.get('settle_wait_ms', 0)}
            flow['steps'].append(step)
            self.append_execution(evidence, flow, result)
        # Full MCP output is kept locally; the model gets the compact real observation instead.
        return {k: v for k, v in result.items() if k != 'result'}
