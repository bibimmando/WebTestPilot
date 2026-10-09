"""Local stdio MCP session with discovered schemas and bounded calls."""

import asyncio
from concurrent.futures import Future, TimeoutError as FutureTimeout
from datetime import timedelta
import os
import threading


class LocalMCPClient:
    # 비밀값을 전달하지 않는 전용 스레드에서 MCP 세션 수명을 관리한다.
    def __init__(self, command, args, *, timeout=15):
        if not isinstance(timeout, (int, float)) or not 0 < timeout <= 120:
            raise ValueError("MCP timeout must be between 0 and 120 seconds")
        self.timeout = timeout
        self.command, self.args = command, list(args)
        self._ready = Future()
        self._closed = False
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()
        try:
            self.tools = self._ready.result(timeout=timeout)
        except Exception:
            self.close()
            raise RuntimeError("MCP initialization failed; raw server output omitted") from None

    # 비동기 컨텍스트를 생성한 작업에서 종료하여 SDK 취소 범위를 보존한다.
    def _worker(self):
        async def serve():
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
            self._loop = asyncio.get_running_loop()
            self._stop = asyncio.Event()
            # API 키와 기타 계정 설정은 브라우저 서버에 상속하지 않는다.
            names = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
                     "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PLAYWRIGHT_BROWSERS_PATH"}
            env = {key: value for key, value in os.environ.items() if key.upper() in names}
            params = StdioServerParameters(command=self.command, args=self.args, env=env)
            with open(os.devnull, "w") as errors:
                async with stdio_client(params, errlog=errors) as (reader, writer):
                    async with ClientSession(reader, writer, read_timeout_seconds=timedelta(seconds=self.timeout)) as session:
                        self._session = session
                        await session.initialize()
                        tools, cursor = {}, None
                        for _ in range(20):
                            result = await session.list_tools(cursor=cursor)
                            for tool in result.tools:
                                tools[tool.name] = tool.model_dump(by_alias=True)
                            cursor = result.nextCursor
                            if not cursor:
                                break
                        else:
                            raise ValueError("MCP tool pagination exceeded limit")
                        self._ready.set_result(tools)
                        await self._stop.wait()
        try:
            asyncio.run(serve())
        except BaseException:
            if not self._ready.done():
                self._ready.set_exception(RuntimeError("MCP session initialization failed"))

    # 서버가 제공한 입력 스키마에 맞는 도구만 호출하고 결과를 정규화한다.
    def call_tool(self, name, arguments):
        from jsonschema import Draft202012Validator
        if self._closed or name not in self.tools:
            raise ValueError("Unknown tool or closed MCP session")
        Draft202012Validator(self.tools[name]["inputSchema"]).validate(arguments)
        future = asyncio.run_coroutine_threadsafe(self._session.call_tool(name, arguments), self._loop)
        try:
            result = future.result(timeout=self.timeout)
        except FutureTimeout:
            future.cancel()
            self.close()
            raise TimeoutError("MCP tool timed out; session closed") from None
        except Exception:
            raise RuntimeError("MCP tool call failed; raw error omitted") from None
        data = result.model_dump(by_alias=True)
        return {"isError": bool(data.get("isError", False)), "content": data.get("content", []),
                "structuredContent": data.get("structuredContent")}

    # MCP와 같은 이벤트 루프에서 네트워크 가드를 실행해 동작 대기 중에도 차단한다.
    def install_guard(self, endpoint, scope):
        async def install():
            from playwright.async_api import async_playwright
            from src.ai_inspection.inspection_input import _origin
            self._guard_driver = await async_playwright().start()
            self._guard_browser = await self._guard_driver.chromium.connect_over_cdp(endpoint)
            contexts = self._guard_browser.contexts
            self.guard_topology = {"contexts": len(contexts), "pages": [len(c.pages) for c in contexts],
                                   "workers": [len(c.service_workers) for c in contexts]}
            if len(contexts) != 1 or len(contexts[0].pages) != 1 or contexts[0].service_workers:
                raise ValueError("An isolated single-tab session without service workers is required")
            context = contexts[0]
            self.blocked_requests = []
            # 워커가 라우팅 가드를 우회하지 못하도록 이 연결의 신규 등록을 차단한다.
            worker_policy = "if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('Service workers disabled for inspection'))"
            await context.add_init_script(worker_policy)
            await context.pages[0].evaluate(worker_policy)
            async def guard(route):
                request = route.request
                try:
                    outside = request.is_navigation_request() and _origin(request.url) != scope
                except ValueError:
                    outside = True
                if outside or request.method not in {"GET", "HEAD", "OPTIONS"}:
                    self.blocked_requests.append({"method": request.method, "reason": "safety_policy"})
                    await route.abort()
                else:
                    await route.continue_()
            self._guard_context, self._guard = context, guard
            await context.route("**/*", guard)
            self._guard_page = context.pages[0]
            self._guard_cdp = await context.new_cdp_session(self._guard_page)
            await self._guard_cdp.send("Network.enable")
            await self._guard_cdp.send("Network.setBypassServiceWorker", {"bypass": True})
            async def close_popup(page):
                if page != self._guard_page:
                    await page.close()
            context.on("page", close_popup)
            self._popup_handler = close_popup
        future = asyncio.run_coroutine_threadsafe(install(), self._loop)
        try:
            future.result(timeout=self.timeout)
        except Exception as exc:
            future.cancel()
            if isinstance(exc, ValueError):
                raise ValueError(f"MCP requires a single tab without workers: {getattr(self, 'guard_topology', {})}") from None
            raise RuntimeError(f"Shared browser safety guard could not be installed ({type(exc).__name__})") from None

    # 세션과 자식 서버를 닫되 다른 실행에서 공유하는 브라우저는 닫지 않는다.
    def close(self):
        if self._closed:
            return
        self._closed = True
        loop = getattr(self, "_loop", None)
        if loop and loop.is_running():
            async def detach_guard():
                if hasattr(self, "_guard_context"):
                    await self._guard_context.unroute("**/*", self._guard)
                    self._guard_context.remove_listener("page", self._popup_handler)
                if hasattr(self, "_guard_driver"):
                    await self._guard_driver.stop()
            try:
                asyncio.run_coroutine_threadsafe(detach_guard(), loop).result(timeout=self.timeout)
            except Exception:
                pass
            loop.call_soon_threadsafe(self._stop.set)
        self._thread.join(timeout=self.timeout + 2)
