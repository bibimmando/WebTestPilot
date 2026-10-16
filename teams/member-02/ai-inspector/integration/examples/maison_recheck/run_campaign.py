"""Prepare by default; --execute runs paid models through the existing CLI/MCP."""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit, urlunsplit

HERE = Path(__file__).resolve().parent
INTEGRATION = HERE.parents[1]


def read_requirements(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path.suffix != '.md':
        raise ValueError('requirements must be a Markdown file inside the config directory')
    text = path.read_text(encoding='utf-8')
    if len(text) > 100_000:
        raise ValueError('requirements exceed the example input limit')
    return text


def prepare(config_path, *, target=None, limit=None, skip_followups=False):
    config_path = Path(config_path).resolve()
    config = json.loads(config_path.read_text(encoding='utf-8'))
    if config.get('schema_version') != 'inspection_campaign/1':
        raise ValueError('unsupported campaign configuration')
    origin = urlsplit(target or config['target'])
    if (origin.scheme not in ('http', 'https') or not origin.netloc or origin.username or origin.password
            or origin.query or origin.fragment or origin.path not in ('', '/')):
        raise ValueError('target must be an http(s) origin without credentials, path or query')
    base = urlunsplit((origin.scheme, origin.netloc, '', '', ''))
    if config.get('viewport') != {'width': 1280, 'height': 800}:
        raise ValueError('this recorded CLI campaign uses the fixed 1280x800 viewport')
    settings = config['settings']
    for field in ('model_timeout', 'max_tokens', 'max_actions', 'max_rounds', 'max_calls',
                  'per_seed_seconds', 'campaign_seconds', 'total_seconds'):
        value = settings[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError('invalid positive campaign limit: ' + field)
    if limit is not None and limit < 1:
        raise ValueError('limit must be positive')
    text = read_requirements(config_path.parent, config['requirements_file'])
    specs = []
    seeds = config['seeds'][:limit] if limit else config['seeds']
    for index, seed in enumerate(seeds, 1):
        parts = urlsplit(seed)
        if not seed.startswith('/') or seed.startswith('//') or parts.netloc or parts.scheme or parts.fragment:
            raise ValueError('seed must be an origin-relative path')
        label = f'{index:02d}_' + (parts.path.strip('/').replace('/', '_') or 'home')
        specs.append({'label': label, 'url': base + seed, 'group': 'main', 'requirements': text,
                      'seconds': settings['per_seed_seconds'], 'max_actions': settings['max_actions'],
                      'max_rounds': settings['max_rounds'], 'max_calls': settings['max_calls']})
    if not skip_followups:
        for index, followup in enumerate(config.get('followups', []), len(specs) + 1):
            seed = followup['seed']
            if not seed.startswith('/') or seed.startswith('//') or urlsplit(seed).netloc:
                raise ValueError('followup seed must be origin-relative')
            specs.append({'label': f'{index:02d}_followup_' + followup['name'], 'url': base + seed,
                'group': 'followup', 'requirements': read_requirements(config_path.parent, followup['requirements_file']),
                'seconds': followup['seconds'], 'max_actions': followup['max_actions'],
                'max_rounds': followup['max_rounds'], 'max_calls': followup['max_calls']})
    return config, specs


def command(spec, output, settings, seconds):
    args = ['integration', '--url', spec['url'], '--provider', 'anthropic',
        '--model', settings['model'], '--execution-model', settings['model'], '--judgment-model', settings['model'],
        '--model-effort', settings['effort'], '--model-max-tokens', str(settings['max_tokens']),
        '--model-timeout', str(settings['model_timeout']), '--requirements-file', str(output / 'inputs' / (spec['label'] + '.md')),
        '--browser-state-reset', '--max-pages', '1', '--max-actions', str(spec['max_actions']),
        '--max-rounds', str(spec['max_rounds']), '--max-calls', str(spec['max_calls']),
        '--max-runtime', str(round(seconds, 1)), '--output', str(output / spec['label'])]
    if spec['group'] == 'main':
        args += ['--campaign-state', str(output / 'campaign_state.json')]
    return args


async def run(config, specs, output, *, execute=False):
    output = Path(output).resolve()
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('output must be a new or empty directory')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'inputs').mkdir()
    settings = config['settings']
    manifest = {'schema_version': 'campaign_execution/1', 'status': 'prepared', 'paid_execution': execute,
        'model': settings['model'], 'settings': settings, 'viewport': config['viewport'],
        'allow_writes': False, 'browser_state_reset': True, 'server_reset': False,
        'ground_truth_sent_to_model': False, 'runs': [],
        'started_at_utc': datetime.now(timezone.utc).isoformat(),
        'source_sha256': {p.relative_to(INTEGRATION).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in INTEGRATION.rglob('*.py') if '__pycache__' not in p.parts and 'test' not in p.relative_to(INTEGRATION).parts}}
    for spec in specs:
        (output / 'inputs' / (spec['label'] + '.md')).write_text(spec['requirements'], encoding='utf-8')
        manifest['runs'].append({k: v for k, v in spec.items() if k != 'requirements'})
        manifest['runs'][-1].update(status='not_run', requirements_sha256=hashlib.sha256(spec['requirements'].encode()).hexdigest())
    def save():
        (output / 'campaign.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    save()
    if not execute:
        return manifest
    from ... import __main__ as cli
    from ...models import env_value
    if not env_value('ANTHROPIC_API_KEY'):
        raise ValueError('ANTHROPIC_API_KEY is required for --execute')
    previous = {key: os.environ.get(key) for key in ('ANTHROPIC_PLANNING_SKILL_ID', 'ANTHROPIC_PLANNING_SKILL_VERSION')}
    old_argv = sys.argv
    start = time.monotonic()
    # Recorded baseline used no custom planning skill.
    os.environ.update(ANTHROPIC_PLANNING_SKILL_ID='', ANTHROPIC_PLANNING_SKILL_VERSION='')
    manifest['status'] = 'running'
    try:
        for spec, row in zip(specs, manifest['runs']):
            elapsed = time.monotonic() - start
            remaining = settings['total_seconds'] - elapsed
            if spec['group'] == 'main':
                remaining = min(remaining, settings['campaign_seconds'] - elapsed)
            if remaining < 25:
                row.update(status='not_run', reason='campaign_time_limit')
                continue
            seconds = min(spec['seconds'], remaining - 10)
            row['status'] = 'running'
            save()
            print('START', spec['label'], flush=True)
            try:
                sys.argv = command(spec, output, settings, seconds)
                result, failed = await asyncio.wait_for(cli.run(cli.parse_args()), timeout=seconds + 8)
                row.update(status='completed_with_errors' if failed else 'completed', run_id=result.get('run_id'))
            except asyncio.CancelledError:
                row['status'] = 'cancelled'
                raise
            except Exception as exc:
                row.update(status='error', error_type=type(exc).__name__)
            finally:
                save()
            print('END', spec['label'], row['status'], flush=True)
        manifest['status'] = 'finished'
    finally:
        sys.argv = old_argv
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        manifest.update(finished_at_utc=datetime.now(timezone.utc).isoformat(), elapsed_seconds=round(time.monotonic() - start, 2))
        usage = [u for folder in output.iterdir() if folder.is_dir() and (folder / 'report.json').exists()
                 for u in json.loads((folder / 'report.json').read_text(encoding='utf-8')).get('usage', [])]
        manifest['usage'] = {'calls': len(usage), 'input_tokens': sum(u.get('input_tokens') or 0 for u in usage),
            'output_tokens': sum(u.get('output_tokens') or 0 for u in usage),
            'missing_usage_calls': sum(u.get('input_tokens') is None or u.get('output_tokens') is None for u in usage)}
        save()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=HERE / 'campaign_config.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--target', help='override the example target origin')
    parser.add_argument('--limit', type=int, help='limit main seeds; combine with --skip-followups for a short smoke run')
    parser.add_argument('--skip-followups', action='store_true')
    parser.add_argument('--execute', action='store_true', help='run paid API calls and real browser actions; default only prepares files')
    args = parser.parse_args()
    try:
        config, specs = prepare(args.config, target=args.target, limit=args.limit, skip_followups=args.skip_followups)
        result = asyncio.run(run(config, specs, args.output, execute=args.execute))
    except (ValueError, OSError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps({'status': result['status'], 'runs': len(result['runs']), 'paid_execution': args.execute}, ensure_ascii=False))


if __name__ == '__main__':
    main()
