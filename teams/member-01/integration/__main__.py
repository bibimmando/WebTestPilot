import argparse, asyncio, json, math, re, shutil, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
from .preprocessor import crawl  # noqa: E402
from .models import HTTPModel, ScriptedModel, env_value  # noqa: E402
from .runtime import Runtime  # noqa: E402
from .mcp import MCPBridge, LocalMCPClient, DirectBridge  # noqa: E402

MOCK_SCRIPT = [
    {'stop_reason': 'tool_use', 'content': [{'type': 'tool_use', 'id': 'mock-proposals',
      'name': 'qa_test_plan', 'input': {'page_summary': 'Mock: no AI judgment.',
      'proposed_checks': [], 'open_questions': [], 'scenarios': [], 'unplanned': []}}]},
]


def parse_args():
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    ap = argparse.ArgumentParser(prog='integration')
    ap.add_argument('--url', required=True)
    ap.add_argument('--output', default=f'output/integration-{ts}')
    ap.add_argument('--provider', choices=('timely', 'anthropic', 'mock'), default='mock')
    ap.add_argument('--model')
    ap.add_argument('--planning-skill-id', help='registered custom Claude skill for planning; .env: ANTHROPIC_PLANNING_SKILL_ID')
    ap.add_argument('--planning-skill-version', help='pinned version or latest; .env: ANTHROPIC_PLANNING_SKILL_VERSION')
    ap.add_argument('--execution-model', help='execution agent model; Anthropic default: claude-sonnet-5-5')
    ap.add_argument('--judgment-model', help='judgment/replay model; Anthropic default: claude-sonnet-5-5')
    ap.add_argument('--max-pages', type=int, default=3)
    ap.add_argument('--max-runtime', type=float, default=300.0)
    ap.add_argument('--max-rounds', type=int, default=12)
    ap.add_argument('--max-actions', type=int, default=20)
    ap.add_argument('--max-calls', type=int, default=60)
    ap.add_argument('--model-timeout', type=float, default=60, help='total deadline per model request, seconds')
    ap.add_argument('--model-max-tokens', type=int, default=4000,
                    help='output cap incl. thinking; 12000 recommended for plan-heavy runs')
    ap.add_argument('--model-effort', choices=('low', 'medium', 'high'), default=None,
                    help='Anthropic output_config.effort (anthropic provider only)')
    ap.add_argument('--allow-writes', action='store_true', default=False)
    ap.add_argument('--browser-state-reset', action='store_true',
                    help='approve browser-only reset for an isolated stateless test fixture; server state is not reset')
    ap.add_argument('--maison-reset', action='store_true',
                    help='approve POST /_reset on the URL origin before each page and replay; resets global Maison state')
    ap.add_argument('--headed', action='store_true')
    ap.add_argument('--requirements-file')
    ap.add_argument('--mcp-command', default='node')
    ap.add_argument('--mcp-script', default=str(ROOT / '.tools/playwright-mcp/node_modules/@playwright/mcp/cli.js'))
    ap.add_argument('--direct', action='store_true', help='test-only: bypass MCP')
    a = ap.parse_args()
    if urlsplit(a.url).scheme not in ('http', 'https') or not urlsplit(a.url).netloc:
        ap.error('--url must be an absolute http(s) URL')
    for name in ('max_pages', 'max_rounds', 'max_actions', 'max_calls'):
        if getattr(a, name) <= 0:
            ap.error(f'--{name.replace("_", "-")} must be positive')
    if not (math.isfinite(a.max_runtime) and a.max_runtime > 0):
        ap.error('--max-runtime must be positive and finite')
    if not (math.isfinite(a.model_timeout) and a.model_timeout > 0):
        ap.error('--model-timeout must be positive and finite')
    if a.model_max_tokens <= 0:
        ap.error('--model-max-tokens must be positive')
    if a.model_effort is not None and a.provider != 'anthropic':
        ap.error('--model-effort requires --provider anthropic')
    if a.maison_reset and a.browser_state_reset:
        ap.error('choose --maison-reset or --browser-state-reset')
    if a.browser_state_reset and a.allow_writes:
        ap.error('--browser-state-reset requires read-only network requests')
    if a.provider == 'anthropic' and not a.model:
        ap.error('--model is required for the direct Anthropic provider')
    if a.provider == 'anthropic':
        a.planning_skill_id = a.planning_skill_id or env_value('ANTHROPIC_PLANNING_SKILL_ID') or None
        if a.planning_skill_version is not None and not a.planning_skill_id:
            ap.error('--planning-skill-version requires a registered planning skill ID')
        a.planning_skill_version = a.planning_skill_version or env_value('ANTHROPIC_PLANNING_SKILL_VERSION') or 'latest'
        if a.planning_skill_id:
            try:
                HTTPModel(provider=a.provider, model=a.model, skill_id=a.planning_skill_id,
                          skill_version=a.planning_skill_version)
            except ValueError as exc:
                ap.error(str(exc))
    elif a.planning_skill_id is not None or a.planning_skill_version is not None:
        ap.error('--planning-skill-id/--planning-skill-version require --provider anthropic')
    if not a.direct and not Path(a.mcp_script).is_file():
        ap.error('MCP script missing; run: npm install --prefix .tools/playwright-mcp @playwright/mcp@0.0.83')
    out = Path(a.output).resolve()
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        ap.error('--output must not exist or be an empty directory')
    a.requirements = None
    if a.requirements_file:
        try:
            a.requirements = Path(a.requirements_file).read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            ap.error('--requirements-file unreadable or not UTF-8')
    a.out = out
    return a


async def read_port(profile):
    f, loop = profile / 'DevToolsActivePort', asyncio.get_running_loop()
    deadline = loop.time() + 10
    while loop.time() < deadline:
        try:
            lines = (await asyncio.to_thread(f.read_text, encoding='ascii')).splitlines()
            if lines and re.fullmatch(r'[0-9]{1,5}', lines[0].strip()) and 1 <= int(lines[0]) <= 65535:
                return int(lines[0])
        except (OSError, UnicodeDecodeError):
            pass
        await asyncio.sleep(0.1)
    raise RuntimeError('DevToolsActivePortUnavailable')


async def run(a):
    from playwright.async_api import async_playwright
    out = a.out
    out.mkdir(parents=True, exist_ok=True)
    profile = out / '.browser-profile'
    profile.mkdir()
    model = ScriptedModel(MOCK_SCRIPT * a.max_pages) if a.provider == 'mock' else HTTPModel(provider=a.provider, model=a.model, timeout=a.model_timeout,
                                                                                               max_tokens=a.model_max_tokens, effort=a.model_effort,
                                                                                               skill_id=a.planning_skill_id,
                                                                                               skill_version=a.planning_skill_version or 'latest')
    execution_model = judgment_model = model
    if a.provider != 'mock':
        stage_default = 'claude-sonnet-5-5' if a.provider == 'anthropic' else model.model
        execution_model = HTTPModel(provider=a.provider, model=a.execution_model or stage_default,
                                    timeout=a.model_timeout, max_tokens=a.model_max_tokens, effort=a.model_effort)
        judgment_model = HTTPModel(provider=a.provider, model=a.judgment_model or stage_default,
                                   timeout=a.model_timeout, max_tokens=a.model_max_tokens, effort=a.model_effort)
    pw = context = client = None
    try:
        pw = await async_playwright().start()
        context = await pw.chromium.launch_persistent_context(
            str(profile), headless=not a.headed,
            args=['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
            service_workers='block', user_agent='WebTestPilot/0.2', viewport={'width': 1280, 'height': 800})
        if len(context.pages) != 1:
            raise RuntimeError('UnexpectedPageCount')
        page = context.pages[0]
        if a.direct:
            bridge = DirectBridge()
        else:
            endpoint = f'http://127.0.0.1:{await read_port(profile)}'
            client = await asyncio.to_thread(
                LocalMCPClient, a.mcp_command,
                [a.mcp_script, '--cdp-endpoint', endpoint, '--output-dir', str(out / 'mcp'),
                 '--timeout-action', '5000', '--timeout-navigation', '10000', '--snapshot-mode', 'none'],
                timeout=20)
            bridge = MCPBridge(client)
        runtime = Runtime(model=model, bridge=bridge, output=out,
                          execution_model=execution_model, judgment_model=judgment_model,
                          site_requirements=a.requirements, max_rounds=a.max_rounds, max_actions=a.max_actions,
                          max_calls=a.max_calls, allow_writes=a.allow_writes,
                          browser_state_reset=a.browser_state_reset, maison_reset=a.maison_reset)
        summary = await crawl(a.url, out, max_pages=a.max_pages, max_runtime=a.max_runtime,
                              page_callback=runtime.inspect_page, shared_page=page,
                              allowed_methods=None if a.allow_writes else ('GET', 'HEAD', 'OPTIONS'),
                              before_page=runtime.prepare_page)
        result = dict(summary if isinstance(summary, dict) else vars(summary))
        result.update(run_id=runtime.run_id, provider=a.provider,
                      outputs={'output_dir': str(out), 'mcp_dir': None if a.direct else str(out / 'mcp')})
        failed = bool(result.get('callback_errors')) or str(result.get('termination_reason', '')).startswith('error:') \
            or bool(getattr(runtime, 'termination_error', None))
        return result, failed
    finally:
        if client is not None:
            try:
                await asyncio.to_thread(client.close)
            except Exception:
                pass
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass
        rp = profile.resolve()
        if rp.parent == out.resolve() and rp.name == '.browser-profile' and not profile.is_symlink() and rp.is_dir():
            shutil.rmtree(rp, ignore_errors=True)


def main():
    a = parse_args()
    try:
        result, failed = asyncio.run(run(a))
    except KeyboardInterrupt:
        print(json.dumps({'error': 'cancelled'}))
        return 130
    except Exception as e:  # sanitized: type name only, never message or keys
        print(json.dumps({'error': type(e).__name__}))
        return 1
    print(json.dumps(result, default=str))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
