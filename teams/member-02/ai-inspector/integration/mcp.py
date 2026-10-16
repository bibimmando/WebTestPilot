"""Sequential MCP and direct Playwright action bridges for WebTestPilot test pages."""
from __future__ import annotations

import asyncio
import secrets
from typing import Any
from urllib.parse import urlsplit

from .mcp_client import LocalMCPClient
from .preprocessor.collector import resolve_locator

ELEMENT_OPS = frozenset({'click', 'fill', 'press'})
ALL_OPS = ELEMENT_OPS | {'navigate'}
ALLOWED_KEYS = frozenset({'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown'})
BLOCKED_INPUT_TYPES = frozenset({'password', 'file'})
URL_SCHEMES = frozenset({'http', 'https'})
MARK_ATTR = 'data-wtp-mcp'
TOOLS = {'click': 'browser_click', 'fill': 'browser_type', 'press': 'browser_press_key', 'navigate': 'browser_navigate'}
# Fixed, program-authored page functions. Model output never reaches evaluate().
_SET_MARK = '(el, a) => { el.setAttribute(a[0], a[1]); return true; }'
_CLEAR_MARK = '(el, a) => { if (el.getAttribute(a[0]) === a[1]) { el.removeAttribute(a[0]); } return true; }'


class _Rejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _outcome(driver: str, execution: str, code: str | None = None, message: str | None = None,
             tool: str | None = None, args: dict | None = None, result: Any = None,
             preparation: list | None = None) -> dict:
    return {
        'driver': driver,
        'execution': execution,
        'error': None if code is None else {'code': code, 'message': message},
        'mcp_tool': tool,
        'mcp_arguments': args,
        'result': result,
        'preparation': list(preparation or []),
    }


async def _preflight(page: Any, detail: Any, operation: str, value: Any) -> Any:
    """Validate page state and target; return verified Locator (None for navigate)."""
    if operation not in ALL_OPS:
        raise _Rejected('unsupported_operation', 'Operation is not supported.')
    try:
        if page.is_closed():
            raise _Rejected('page_closed', 'Current page is closed.')
        context = page.context
        browser = context.browser
        contexts = browser.contexts if browser is not None else [context]
        if len(contexts) != 1 or len(context.pages) != 1:
            raise _Rejected('ambiguous_page', 'Exactly one browser context and page are required.')
    except _Rejected:
        raise
    except Exception:
        raise _Rejected('page_state_unavailable', 'Page state could not be verified.') from None
    if operation == 'navigate':
        if not isinstance(value, str) or not value or value != value.strip():
            raise _Rejected('invalid_url', 'Navigation URL is invalid.')
        parts = urlsplit(value)
        if parts.scheme not in URL_SCHEMES or (parts.scheme != 'file' and not parts.netloc):
            raise _Rejected('invalid_url', 'Navigation URL is invalid.')
        return None
    if not isinstance(detail, dict) or not detail.get('locator') or detail.get('locator_status') != 'verified':
        raise _Rejected('unverified_target', 'A verified element locator is required.')
    if operation == 'fill' and not isinstance(value, str):
        raise _Rejected('invalid_value', 'Fill value must be text.')
    if operation == 'press' and value not in ALLOWED_KEYS:
        raise _Rejected('key_not_allowed', 'Key is not allowed.')
    try:
        locator = resolve_locator(page, detail['locator'])
        if await locator.count() != 1:
            raise _Rejected('target_not_unique', 'Target must resolve to exactly one element.')
        if not await locator.is_visible():
            raise _Rejected('target_not_visible', 'Target is not visible.')
        if not await locator.is_enabled():
            raise _Rejected('target_not_enabled', 'Target is not enabled.')
        if operation == 'fill':
            types = {str(await locator.get_attribute('type') or '').strip().lower(),
                     str(detail.get('type') or '').strip().lower()}
            if types & BLOCKED_INPUT_TYPES:
                raise _Rejected('input_type_blocked', 'Input type is not allowed.')
    except _Rejected:
        raise
    except Exception:
        raise _Rejected('target_unresolved', 'Target could not be resolved.') from None
    return locator


class MCPBridge:
    """Dispatches one verified operation through an advertised MCP tool schema."""

    driver = 'mcp'

    def __init__(self, client: LocalMCPClient) -> None:
        self.client = client

    def _schema(self, tool: str) -> tuple[dict | None, tuple]:
        tools = getattr(self.client, 'tools', None) or {}
        meta = tools.get(tool) if isinstance(tools, dict) else None
        if not isinstance(meta, dict):
            return None, ()
        schema = meta.get('inputSchema', meta)
        if not isinstance(schema, dict):
            return None, ()
        props = schema.get('properties')
        required = schema.get('required') or ()
        return (props if isinstance(props, dict) else {}), tuple(r for r in required if isinstance(r, str))

    async def execute(self, page: Any, detail: Any, operation: str, value: Any = None) -> dict:
        d = self.driver
        try:
            locator = await _preflight(page, detail, operation, value)
        except _Rejected as exc:
            return _outcome(d, 'not_executed', exc.code, exc.message)
        tool = TOOLS[operation]
        props, required = self._schema(tool)
        unsupported = _outcome(d, 'not_executed', 'unsupported_schema', 'Advertised tool schema is unsupported.')
        if props is None:
            return unsupported
        target_arg = 'target' if 'target' in (props or {}) else 'selector'
        needed = {'click': (target_arg,), 'fill': (target_arg, 'text'), 'press': ('key',), 'navigate': ('url',)}
        if any(k not in props for k in needed[operation]):
            return unsupported
        token = selector = None
        preparation: list = []
        try:
            args: dict = {}
            if operation == 'navigate':
                args['url'] = value
            else:
                if target_arg in props:
                    token = secrets.token_hex(12)
                    await locator.evaluate(_SET_MARK, [MARK_ATTR, token])
                    selector = f'[{MARK_ATTR}="{token}"]'
                    if await page.locator(selector).count() != 1:
                        await self._unmark(page, selector, token)
                        return _outcome(d, 'not_executed', 'mark_failed', 'Target could not be marked uniquely.')
                    args[target_arg] = selector
                if 'element' in props:
                    label = detail.get('name') or detail.get('role') or 'verified target'
                    args['element'] = str(label)[:80]
                if operation == 'fill':
                    args['text'] = value
                    if 'submit' in props:
                        args['submit'] = False
                elif operation == 'press':
                    args['key'] = value
            if set(required) - set(args):
                await self._unmark(page, selector, token)
                return unsupported
            # Validate before dispatch: a schema failure is certainly not an executed action.
            from jsonschema import Draft202012Validator
            Draft202012Validator(self.client.tools[tool]['inputSchema']).validate(args)
            if operation == 'press' and selector is None:
                await locator.focus()
                preparation.append({'kind': 'focus', 'target': 'verified_locator', 'test_action': False})
        except Exception:
            await self._unmark(page, selector, token)
            return _outcome(d, 'not_executed', 'preparation_failed', 'Action preparation failed.', preparation=preparation)
        try:
            try:
                response = await asyncio.to_thread(self.client.call_tool, tool, args)
            except Exception:
                return _outcome(d, 'unknown', 'dispatch_failed', 'Tool dispatch outcome is unknown.', tool, args,
                                preparation=preparation)
            if not isinstance(response, dict) or response.get('isError'):
                return _outcome(d, 'unknown', 'tool_error', 'Tool reported an error; outcome is unknown.', tool, args,
                                preparation=preparation)
            result = {'structuredContent': response.get('structuredContent'), 'content': response.get('content')}
            return _outcome(d, 'executed', tool=tool, args=args, result=result, preparation=preparation)
        finally:
            await self._unmark(page, selector, token)

    @staticmethod
    async def _unmark(page: Any, selector: str | None, token: str | None) -> None:
        if not selector or not token:
            return
        try:
            if page.is_closed():
                return
            mark = page.locator(selector)
            if await mark.count() == 1:
                await mark.evaluate(_CLEAR_MARK, [MARK_ATTR, token])
        except Exception:
            pass


class DirectBridge:
    """Same contract as MCPBridge, using the verified Playwright Locator directly."""

    driver = 'direct'

    async def execute(self, page: Any, detail: Any, operation: str, value: Any = None) -> dict:
        d = self.driver
        try:
            locator = await _preflight(page, detail, operation, value)
        except _Rejected as exc:
            return _outcome(d, 'not_executed', exc.code, exc.message)
        try:
            if operation == 'click':
                await locator.click()
            elif operation == 'fill':
                await locator.fill(value)
            elif operation == 'press':
                await locator.press(value)
            else:
                await page.goto(value)
        except Exception:
            return _outcome(d, 'unknown', 'dispatch_failed', 'Direct action outcome is unknown.')
        return _outcome(d, 'executed', result={})
