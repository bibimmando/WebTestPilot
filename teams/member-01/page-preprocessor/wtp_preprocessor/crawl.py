import asyncio
import hashlib
import re
import time
from collections import deque
from urllib.parse import urljoin, urlsplit, urlunsplit, unquote_plus

from protego import Protego

_DEFAULT_PORTS = {'http': 80, 'https': 443}
_SENSITIVE_KEY = re.compile(r'(token|session|passw|pwd|key|auth|code|secret|sig)', re.I)
_API_PATTERNS = [
    re.compile(r'\btgpt_sk_[A-Za-z0-9]{20,}'),
    re.compile(r'\bsk-[A-Za-z0-9_\-]{16,}'),
    re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
    re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}'),
    re.compile(r'\bAIza[0-9A-Za-z_\-]{30,}'),
    re.compile(r'\bxox[baprs]-[A-Za-z0-9\-]{10,}'),
    re.compile(r'(?i)\bbearer\s+[A-Za-z0-9._\-~+/]{10,}=*'),
]
MASK = '[REDACTED]'


# URL을 절대 경로로 정규화하고 지원하지 않는 형식은 거부
def normalize_url(value, base=None):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('empty url')
    raw = urljoin(base, value.strip()) if base else value.strip()
    parts = urlsplit(raw)
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise ValueError('unsupported scheme')
    if parts.username is not None or parts.password is not None or '@' in parts.netloc:
        raise ValueError('userinfo not allowed')
    host = (parts.hostname or '').lower()
    if not host:
        raise ValueError('missing host')
    port = parts.port
    netloc = f'[{host}]' if ':' in host else host
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc += f':{port}'
    return urlunsplit((scheme, netloc, parts.path or '/', parts.query, parts.fragment))


# 스킴, 호스트, 실효 포트로 동일 출처 여부 비교
def same_origin(a, b):
    try:
        pa, pb = urlsplit(normalize_url(a)), urlsplit(normalize_url(b))
    except ValueError:
        return False
    return (pa.scheme, pa.hostname, pa.port or _DEFAULT_PORTS[pa.scheme]) == \
        (pb.scheme, pb.hostname, pb.port or _DEFAULT_PORTS[pb.scheme])


# 텍스트 내 명시적 비밀값과 API 키 패턴을 마스킹
def redact_text(text, secrets=()):
    if not text:
        return text
    out = str(text)
    for s in sorted((s for s in secrets if s), key=len, reverse=True):
        out = out.replace(str(s), MASK)
    for pat in _API_PATTERNS:
        out = pat.sub(MASK, out)
    return out


# 쿼리 순서와 중복을 보존하며 민감한 쿼리 값을 마스킹
def _redact_query(query):
    items = []
    for item in query.split('&'):
        if '=' in item:
            k, v = item.split('=', 1)
            if v and _SENSITIVE_KEY.search(unquote_plus(k)):
                v = MASK
            items.append(f'{k}={v}')
        else:
            items.append(item)
    return '&'.join(items)


# URL의 쿼리와 해시에서 민감한 값을 마스킹
def redact_url(url):
    try:
        p = urlsplit(url)
    except ValueError:
        return redact_text(url)
    frag = _redact_query(p.fragment) if '=' in p.fragment else p.fragment
    return redact_text(urlunsplit((p.scheme, p.netloc, p.path, _redact_query(p.query) if p.query else '', frag)))


# URL의 SHA256 식별자 생성
def _uid(url):
    return hashlib.sha256(url.encode('utf-8')).hexdigest()


class URLQueue:
    # 시드 URL로 큐와 그래프 초기화
    def __init__(self, seed):
        self.seed = normalize_url(seed)
        self._queue = deque()
        self.seen = set()
        self._urls = {}
        self.nodes = {}
        self.edges = []
        self._edge_keys = set()
        self.enqueue(self.seed)

    # 노드가 없으면 생성
    def _node(self, url, status):
        nid = _uid(url)
        if nid not in self.nodes:
            self._urls[nid] = url
            self.nodes[nid] = {'id': nid, 'url': redact_url(url), 'status': status, 'test_status': 'not_run'}
        return nid

    # 동일 출처 URL은 한 번만 큐에 넣고 간선은 항상 기록
    def enqueue(self, url, source=None, label='', kind='link', area='', action_id=None, observed=False, *, visit=True):
        try:
            src = normalize_url(source) if source else None
            target = normalize_url(url, base=src)
        except ValueError:
            return False
        in_scope = same_origin(target, self.seed)
        tid = self._node(target, 'discovered' if in_scope else 'out_of_scope')
        if src:
            sid = self._node(src, 'discovered' if same_origin(src, self.seed) else 'out_of_scope')
            edge = {'from': sid, 'to': tid, 'label': redact_text(label or ''), 'discovered_by': kind,
                    'source_area': area, 'action_id': action_id, 'observed_navigation': bool(observed)}
            key = tuple(edge.values())
            if key not in self._edge_keys:
                self._edge_keys.add(key)
                self.edges.append(edge)
        if not visit or not in_scope or target in self.seen:
            return False
        self.seen.add(target)
        self._queue.append(target)
        self.nodes[tid]['status'] = 'queued'
        return True

    # 다음 실제 URL을 꺼내고 처리 중으로 표시
    def pop(self):
        if not self._queue:
            return None
        url = self._queue.popleft()
        self.nodes[_uid(url)]['status'] = 'processing'
        return url

    # 노드의 공개 상태값 갱신
    def mark(self, url, **states):
        nid = _uid(normalize_url(url))
        if nid not in self.nodes:
            raise KeyError('unknown url')
        for k, v in states.items():
            if k not in ('id', 'url'):
                self.nodes[nid][k] = redact_text(v) if isinstance(v, str) else v

    # 큐 길이 반환
    def __len__(self):
        return len(self._queue)

    # 마스킹된 노드, 간선, 대기 목록 내보내기
    def export(self):
        return {'nodes': [dict(n) for n in self.nodes.values()],
                'edges': [dict(e) for e in self.edges],
                'pending': [{'id': _uid(u), 'url': redact_url(u)} for u in self._queue]}


class RobotsPolicy:
    # robots 정책 캐시와 요청 간격 설정 초기화
    def __init__(self, user_agent='WebTestPilot/0.1', retries=2, base_delay=1.0, ttl=86400):
        self.user_agent = user_agent
        self.retries = retries
        self.base_delay = base_delay
        self.ttl = ttl
        self._cache = {}
        self._last_start = None
        self._lock = asyncio.Lock()

    # URL의 출처 문자열 생성
    @staticmethod
    def _origin(url):
        p = urlsplit(url)
        return urlunsplit((p.scheme, p.netloc, '', '', ''))

    # robots.txt를 가져와 (parser 또는 None, 상태) 반환
    async def _fetch(self, origin, ctx):
        target = origin + '/robots.txt'
        headers = {'User-Agent': self.user_agent}
        for _ in range(6):
            resp = None
            for attempt in range(self.retries + 1):
                try:
                    resp = await ctx.get(target, headers=headers, timeout=3000, max_redirects=0)
                    if resp.status < 500:
                        break
                    await resp.dispose()
                except Exception:
                    resp = None
                if attempt < self.retries:
                    await asyncio.sleep(0.5 * (attempt + 1))
            if resp is None or resp.status >= 500:
                return None, 'deferred_robots_unavailable'
            st = resp.status
            headers_copy = resp.headers
            if st != 200:
                await resp.dispose()
            if st in (301, 302, 303, 307, 308):
                loc = headers_copy.get('location')
                try:
                    nxt = normalize_url(loc, base=target) if loc else None
                except ValueError:
                    nxt = None
                if not nxt or not same_origin(nxt, origin):
                    return None, 'deferred_robots_redirect'
                target = nxt
                continue
            if st == 200:
                try:
                    return Protego.parse(await resp.text()), 'ok'
                except Exception:
                    return None, 'deferred_robots_parse'
                finally:
                    await resp.dispose()
            if st == 404:
                return None, 'no_robots'
            if st in (401, 403, 429):
                return None, f'deferred_robots_{st}'
            return None, f'deferred_robots_{st}'
        return None, 'deferred_robots_redirect_limit'

    # robots 규칙에 따라 URL 접근 가능 여부 판단
    async def check(self, url, request_context):
        url = normalize_url(url)
        origin = self._origin(url)
        hit = self._cache.get(origin)
        if not hit or time.monotonic() - hit[0] > self.ttl:
            parser, status = await self._fetch(origin, request_context)
            hit = (time.monotonic(), parser, status)
            if not status.startswith('deferred'):
                self._cache[origin] = hit
        _, parser, status = hit
        if status.startswith('deferred'):
            return False, status
        if parser is None:
            return True, 'allowed_no_robots'
        if parser.can_fetch(url, self.user_agent):
            return True, 'allowed'
        return False, 'excluded_robots'

    # 문서 탐색 시작 사이에 최소 지연 적용
    async def pace(self, url=None):
        delay = self.base_delay
        if url:
            hit = self._cache.get(self._origin(normalize_url(url)))
            if hit and hit[1] is not None:
                cd = hit[1].crawl_delay(self.user_agent)
                if cd:
                    delay = max(delay, float(cd))
        async with self._lock:
            now = time.monotonic()
            if self._last_start is not None:
                wait = self._last_start + delay - now
                if wait > 0:
                    await asyncio.sleep(wait)
            self._last_start = time.monotonic()

# ---- runner (appended) ----
import asyncio
import json
import math
import time
from collections import Counter
from pathlib import Path

USER_AGENT = 'WebTestPilot/0.1'


def _write_json(path, data):
    # 임시 파일에 쓴 뒤 교체하여 JSON을 원자적으로 저장
    path = Path(path)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    tmp.replace(path)


async def crawl(start_url, output_dir, *, max_pages=50, max_runtime=300, page_callback=None,
                ready_selector=None, page_delay=1, headed=False, collection_timeout=15,
                summary_max_bytes=12288, hash_policy='conservative'):
    # 동일 출처 FIFO 크롤: 정책 확인, 수집, 콜백, 그래프/요약 저장
    from playwright.async_api import async_playwright
    from .collector import PageCollector
    from .preprocess import classify_link, classify_response, parse_sitemap
    if max_pages < 1 or max_runtime <= 0 or collection_timeout <= 0 or page_delay < 0 or not all(
        math.isfinite(n) for n in (max_runtime, collection_timeout, page_delay)):
        raise ValueError('max_pages/max_runtime/collection_timeout must be positive')
    if isinstance(summary_max_bytes, bool) or not isinstance(summary_max_bytes, int) or summary_max_bytes < 2048:
        raise ValueError('summary_max_bytes must be an integer >= 2048')
    if hash_policy not in ('conservative', 'preserve_all', 'strip_routes'):
        raise ValueError('invalid hash_policy')
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    seed = normalize_url(start_url)
    queue = URLQueue(seed)
    robots = RobotsPolicy(user_agent=USER_AGENT, base_delay=max(1, page_delay))
    t0 = time.monotonic()
    st = {'visited': 0, 'termination': 'running', 'guard_blocks': [], 'callback_errors': [],
          'current': seed, 'nav_seen': set(), 'popup_seen': set()}

    def elapsed():
        # 시작 이후 경과 시간(초)
        return time.monotonic() - t0

    def write():
        # graph.json, urls.jsonl, run_summary.json 저장
        graph = queue.export()
        if collector is not None:
            graph = collector._sanitize(graph)
        nodes = graph.get('nodes', [])
        _write_json(out / 'graph.json', graph)
        with open(out / 'urls.jsonl', 'w', encoding='utf-8') as fh:
            for n in nodes:
                fh.write(json.dumps(n, ensure_ascii=False, default=str) + '\n')
        summary = {
            'start_url': redact_url(seed),
            'termination_reason': st['termination'],
            'pages_visited': st['visited'],
            'runtime_seconds': round(elapsed(), 3),
            'limits': {'max_pages': max_pages, 'max_runtime': max_runtime},
            'counts': {
                'status': dict(Counter(str(n.get('status')) for n in nodes)),
                'collect_status': dict(Counter(str(n.get('collect_status')) for n in nodes if n.get('collect_status'))),
                'test_status': dict(Counter(str(n.get('test_status', 'not_run')) for n in nodes)),
            },
            'test_completed_pages': sum(1 for n in nodes if n.get('test_status') in ('passed', 'failed')),
            'pending_count': len(graph.get('pending', [])),
            'guard_blocks': st['guard_blocks'],
            'callback_errors': st['callback_errors'],
            'callback_configured': page_callback is not None,
            'paths': {'graph': str(out / 'graph.json'), 'urls': str(out / 'urls.jsonl'),
                      'summary': str(out / 'run_summary.json'), 'snapshots': str(out / 'snapshots'),
                      'ai_inputs': str(out / 'ai_inputs'), 'actions': str(out / 'actions')},
            'summary_max_bytes': summary_max_bytes, 'hash_policy': hash_policy,
            'recorded_actions': len(collector.api.records) if collector else 0,
        }
        if collector is not None:
            summary = collector._sanitize(summary)
        _write_json(out / 'run_summary.json', summary)
        return summary

    def ingest(source, links, kind, action_id=None, observed=False):
        # 실제 URL 링크 목록을 큐/그래프에 추가
        for link in links or []:
            try:
                info = classify_link(link['url'], source, collector.last_dom_ids if collector else (),
                                     explicit_download=bool(link.get('explicit_download')), hash_policy=hash_policy)
            except (ValueError, KeyError, TypeError):
                continue
            u = info['target_url']
            visit = info['queue_url'] == u
            queue.enqueue(u, source=source, label=link.get('label', ''), kind='anchor' if info['anchor_alias'] else kind,
                          area=link.get('area', ''), action_id=action_id, observed=observed, visit=visit)
            node = queue.nodes[_uid(u)]
            queue.mark(u, url_role_hint=info['kind'], url_hints=info['hints'])
            if node['status'] == 'discovered' and not visit:
                queue.mark(u, status='anchor_alias' if info['anchor_alias'] else 'resource_link',
                           skip_reason=info['reason'], target_document=redact_url(info['target_document']))
            if info['queue_url'] and info['queue_url'] != u:
                queue.enqueue(info['queue_url'], source=u, kind='anchor_document')

    def ingest_moves(collector, source):
        # 관측된 리다이렉트/이동 및 팝업을 observed 간선으로 기록
        for h in list(collector.navigation_history):
            key = (h.get('from'), h.get('to'), h.get('action_id'), h.get('kind'))
            if key in st['nav_seen']:
                continue
            st['nav_seen'].add(key)
            try:
                f, t = normalize_url(h['from']), normalize_url(h['to'])
            except (ValueError, KeyError, TypeError):
                continue
            if f != t:
                queue.enqueue(t, source=f, kind=h.get('kind','redirect'), action_id=h.get('action_id'), observed=True)
        for p in list(collector.popup_urls):
            if p in st['popup_seen']:
                continue
            st['popup_seen'].add(p)
            try:
                queue.enqueue(normalize_url(p), source=source, kind='popup_attempt', observed=False, visit=False)
            except ValueError:
                pass

    pw = browser = context = collector = None
    try:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=not headed)
        context = await browser.new_context(user_agent=USER_AGENT, service_workers='block')

        page = await context.new_page()

        async def guard_popup(route, request):
            # 팝업 문서는 이번 버전에서 검사하지 않고 요청 전에 차단한다.
            try:
                is_popup = request.resource_type == 'document' and request.frame.page != page
            except Exception:
                is_popup = request.resource_type == 'document'
            if is_popup:
                st['guard_blocks'].append({'from': redact_url(st['current']),
                                           'to': redact_url(request.url), 'reason': 'unsupported_popup'})
                await route.abort('blockedbyclient')
            else:
                await route.continue_()

        await context.route('**/*', guard_popup)
        cdp = await context.new_cdp_session(page)

        async def guard_document(event):
            # Chromium Fetch는 리다이렉트의 각 문서 요청을 전송 전에 멈춘다.
            rid = event['requestId']
            target = event['request']['url']
            try:
                target = normalize_url(target)
                if same_origin(target, seed):
                    ok, reason = await asyncio.wait_for(
                        robots.check(target, context.request), max(0.001, max_runtime-elapsed()))
                else:
                    ok, reason = False, 'out_of_scope'
                if ok:
                    await cdp.send('Fetch.continueRequest', {'requestId': rid})
                    return
                kind = 'blocked_redirect' if event.get('redirectedRequestId') else 'blocked_navigation'
                queue.enqueue(target, source=st['current'], kind=kind, observed=False)
                status = ('out_of_scope' if reason == 'out_of_scope' else
                          'deferred' if reason.startswith('deferred') else 'blocked_robots')
                queue.mark(target, status=status, reason=reason)
                st['guard_blocks'].append({'from': redact_url(st['current']),
                                           'to': redact_url(target), 'reason': reason})
                await cdp.send('Fetch.failRequest', {'requestId': rid, 'errorReason': 'BlockedByClient'})
            except Exception:
                try:
                    await cdp.send('Fetch.failRequest', {'requestId': rid, 'errorReason': 'Aborted'})
                except Exception:
                    pass

        cdp.on('Fetch.requestPaused', guard_document)
        await cdp.send('Fetch.enable', {'patterns': [
            {'urlPattern': '*', 'resourceType': 'Document', 'requestStage': 'Request'}]})
        collector = PageCollector(page, out, timeout=collection_timeout, ready_selector=ready_selector,
                                  summary_budget={'max_bytes': summary_max_bytes})
        collector.runtime_deadline = t0 + max_runtime

        async def probe_file(url):
            # 확장자는 후보 힌트다. HEAD의 MIME이 HTML이면 정상 페이지 수집으로 진행한다.
            target, hops = url, []
            for _ in range(6):
                if not same_origin(target, seed):
                    return {'method':'HEAD','url':url,'final_url':target,'reason':'out_of_scope','redirects':hops}
                try:
                    remaining = max(0.001, max_runtime-elapsed())
                    ok, reason = await asyncio.wait_for(robots.check(target, context.request), remaining)
                    if not ok:
                        return {'method':'HEAD','url':url,'final_url':target,'reason':reason,'redirects':hops}
                    await asyncio.wait_for(robots.pace(target), max(0.001,max_runtime-elapsed()))
                    response = await context.request.head(target, max_redirects=0, timeout=max(1,min(5000,(max_runtime-elapsed())*1000)))
                    try:
                        status, headers = response.status, response.headers
                        if status in (301,302,303,307,308):
                            nxt = normalize_url(headers.get('location',''), target)
                            hops.append({'from':target,'to':nxt})
                            target = nxt
                            continue
                        result = classify_response(status,headers.get('content-type'),target)
                        result.update(method='HEAD',url=url,final_url=target,status=status,redirects=hops)
                        if status in (401,403,429):
                            result['reason'] = 'deferred_http_' + str(status)
                        elif status in (405,501) or status >= 500:
                            result['page_role'] = 'unknown'
                        return result
                    finally:
                        await response.dispose()
                except (ValueError, asyncio.TimeoutError):
                    return {'method':'HEAD','url':url,'final_url':target,'reason':'deferred_probe','redirects':hops}
                except Exception as exc:
                    return {'method':'HEAD','url':url,'final_url':target,'page_role':'unknown','error':type(exc).__name__,'redirects':hops}
            return {'method':'HEAD','url':url,'final_url':target,'reason':'deferred_redirect_limit','redirects':hops}
        while True:
            if st['visited'] >= max_pages:
                st['termination'] = 'max_pages' if len(queue) else 'queue_empty'
                break
            if elapsed() >= max_runtime:
                st['termination'] = 'max_runtime'
                break
            url = queue.pop()
            if url is None:
                st['termination'] = 'queue_empty'
                break
            if not same_origin(url, seed):
                queue.mark(url, status='out_of_scope', reason='out_of_scope')
                continue
            try:
                allowed, reason = await asyncio.wait_for(robots.check(url, context.request), max(0.001, max_runtime-elapsed()))
            except asyncio.TimeoutError:
                queue._queue.appendleft(url)
                queue.mark(url, status='queued')
                st['termination'] = 'max_runtime'
                break
            if not allowed:
                queue.mark(url, status='deferred' if reason.startswith('deferred') else 'blocked_robots', reason=reason)
                write()
                continue
            try:
                await asyncio.wait_for(robots.pace(url), max(0.001, max_runtime-elapsed()))
            except asyncio.TimeoutError:
                queue._queue.appendleft(url)
                queue.mark(url, status='queued')
                st['termination'] = 'max_runtime'
                break
            st['visited'] += 1
            st['current'] = url
            if classify_link(url, url, hash_policy=hash_policy)['kind'] == 'file_candidate':
                probe = await probe_file(url)
                for hop in probe.get('redirects',[]):
                    queue.enqueue(hop['to'], source=hop['from'],kind='head_redirect',observed=False,visit=False)
                probe_path = out / 'resources' / (_uid(url) + '.json')
                probe_path.parent.mkdir(exist_ok=True)
                _write_json(probe_path, collector._sanitize(probe))
                if probe.get('reason') or probe.get('page_role') == 'file':
                    queue.mark(url, status='resource_observed' if not probe.get('reason') else 'deferred',
                               page_role=probe.get('page_role','unknown'), content_type=probe.get('content_type'),
                               callback_status='skipped_nonpage', skip_reason=probe.get('reason','binary_file'),
                               resource_ref=str(probe_path), collect_status='metadata_only')
                    write()
                    continue
            try:
                async def collect_page():
                    if not await collector.open_page(url):
                        return None
                    return await collector.snapshot(trigger='initial_load')
                snap = await asyncio.wait_for(collect_page(), max(0.001, max_runtime-elapsed()))
                if snap is None:
                    queue.mark(url, status='failed', collect_status='failed', reason='navigation_failed')
                    ingest_moves(collector, url)
                    write()
                    continue
            except Exception as exc:
                queue.mark(url, status='failed', collect_status='failed', reason=redact_text(str(exc))[:300])
                write()
                continue
            sid = snap.get('snapshot_id')
            queue.mark(url, status='collected', collect_status=(snap.get('quality') or {}).get('status', 'unknown'),
                       snapshot_id=sid, robots_reason=reason, page_role=snap.get('page_role'),
                       content_type=snap.get('content_type'), ai_input_ref=snap.get('ai_input_ref'))
            ingest(page.url, collector.last_links, 'link')
            ingest_moves(collector, url)
            if snap.get('page_role') in ('sitemap','xml') and snap['artifacts'].get('initial_response'):
                original = Path(snap['artifacts']['initial_response']).resolve()
                if original.is_relative_to(collector.raw):
                    with original.open('rb') as body_file:
                        sitemap = parse_sitemap(body_file.read(1048577), page.url)
                    for discovered in sitemap['urls']:
                        ingest(page.url,[{'url':discovered}], 'sitemap')
                    queue.mark(url, sitemap={k:v for k,v in sitemap.items() if k!='urls'}, sitemap_urls=len(sitemap['urls']))
            test_status, cb_status, snap_ids = 'not_run', 'not_configured', [sid]
            records_before = len(collector.api.records)
            eligible = classify_response(snap.get('main_status'), snap.get('content_type'), snap.get('final_url'))['callback_eligible']
            if not eligible:
                cb_status = 'skipped_nonpage'
                queue.mark(url, skip_reason='mime:' + str(snap.get('content_type') or 'unknown'))
            if page_callback is not None and eligible:
                remaining = max_runtime - elapsed()
                if remaining <= 0:
                    cb_status = 'skipped_time_limit'
                else:
                    try:
                        res = await asyncio.wait_for(page_callback(page, snap, collector.api), remaining) or {}
                        cb_status = 'completed'
                        test_status = res.get('test_status', 'not_run')
                        if test_status not in ('passed', 'failed', 'not_run'):
                            raise ValueError('callback test_status must be passed, failed or not_run')
                        snap_ids += [s.get('snapshot_id') for s in res.get('snapshots') or [] if isinstance(s, dict)]
                        last_action = None
                        for d in res.get('discovered_urls') or []:
                            try:
                                u = normalize_url(d['url'], url)
                            except (ValueError, KeyError, TypeError):
                                continue
                            last_action = d.get('action_id')
                            ingest(page.url,[dict(d,url=u)],'action',action_id=last_action)
                        ingest(page.url, collector.last_links, 'after_action', action_id=last_action)
                        ingest_moves(collector, url)
                    except asyncio.TimeoutError:
                        test_status = 'not_run'
                        cb_status = 'timeout'
                        st['callback_errors'].append({'url': redact_url(url), 'error': 'timeout'})
                    except Exception as exc:
                        test_status = 'not_run'
                        cb_status = 'error'
                        st['callback_errors'].append({'url': redact_url(url), 'error': type(exc).__name__,
                                                      'message': redact_text(str(exc))[:300]})
            # 실패한 조작의 사후 상태도 남기고, 마스킹한 URL로 실제 탐색하지 않는다.
            for action in collector.api.records[records_before:]:
                after_id = action.get('after_snapshot_id')
                after = collector.api.private_links.get(after_id)
                before_id = action.get('before_snapshot_id')
                if before_id:
                    snap_ids.append(before_id)
                if after:
                    snap_ids.append(after_id)
                    baseline = collector.api.private_links.get(before_id,{})
                    prior_links = {(l.get('url'),l.get('label'),l.get('area')) for l in baseline.get('links',[])}
                    new_links = [l for l in after.get('links',[]) if (l.get('url'),l.get('label'),l.get('area')) not in prior_links]
                    ingest(after['url'],new_links,'after_action',action_id=action['action_id'])
            ingest_moves(collector,url)
            queue.mark(url, test_status=test_status, callback_status=cb_status, snapshots=list(dict.fromkeys(snap_ids)))
            write()
    except BaseException as exc:
        if st['termination'] == 'running':
            st['termination'] = 'error:' + type(exc).__name__
        raise
    finally:
        for closer in (collector, context, browser):
            if closer is not None:
                try:
                    await closer.close()
                except Exception:
                    pass
        if pw is not None:
            try:
                await pw.stop()
            except Exception:
                pass
        st['last_summary'] = write()
    return st['last_summary']
