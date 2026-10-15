// 탐색 에이전트의 브라우저 도구. 페이지는 Playwright 접근성 snapshot(ref 포함)으로 보여주고,
// 모델이 고른 ref는 값·순서에 의존하지 않는 구조화된 대상 설명(Target)으로 바꿔야만 계획에 쓸 수 있다.
import type { Browser, BrowserContext, Page, Locator } from 'playwright';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_SCHEMES = new Set(['data:', 'about:', 'blob:']);

export type Policy = { origins: string[]; allowWrites?: boolean };
export type Guarded = { context: BrowserContext; blocked: string[]; violations: string[] };

/**
 * 정책을 강제하는 브라우저 컨텍스트를 연다. 허용 origin 밖 요청과 권한 없는 쓰기 요청은 막고(blocked),
 * 막을 수 없는 우회(외부로의 리다이렉트)는 violations에 남긴다. violations가 있으면 그 실행은 신뢰하지 않는다.
 */
export async function openContext(browser: Browser, policy: Policy): Promise<Guarded> {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const blocked: string[] = [];
  const violations: string[] = [];
  const allowed = (url: string) => {
    const u = new URL(url);
    return LOCAL_SCHEMES.has(u.protocol) || policy.origins.includes(u.origin);
  };
  await context.route('**/*', route => {
    const req = route.request();
    if (allowed(req.url()) && (policy.allowWrites || SAFE_METHODS.has(req.method()))) return route.continue();
    blocked.push(`${req.method()} ${req.url()}`);
    return route.abort('blockedbyclient');
  });
  // route 핸들러는 리다이렉트의 다음 요청을 보지 못하므로 사후에 감지한다.
  context.on('request', req => {
    if (req.redirectedFrom() && !allowed(req.url())) violations.push(`redirect ${req.url()}`);
  });
  // WebSocket 메시지는 읽기·쓰기를 구분할 수 없으므로 쓰기 권한이 있을 때만 허용 origin에 연결한다.
  await context.routeWebSocket('**', ws => {
    if (policy.allowWrites && allowed(ws.url().replace(/^ws/, 'http'))) return ws.connectToServer();
    blocked.push(`WS ${ws.url()}`);
    return ws.close();
  });
  return { context, blocked, violations };
}

/** 페이지 전체 또는 ref 영역의 접근성 snapshot. ref 번호는 전체·부분 snapshot에서 같다. depth를 주면 그 깊이까지만 보여준다. */
export function snapshot(page: Page, ref?: string, depth?: number): Promise<string> {
  return (ref ? page.getByRef(ref) : page.locator('body')).ariaSnapshot({ mode: 'ai', ...(depth ? { depth } : {}) });
}

/**
 * count 검사용 그룹 대상. ref와 같은 역할의 요소들을 가장 가까운 이름 있는 상위 요소 안에서 모은다.
 * 만든 locator가 ref 요소를 포함할 때만 성공한다.
 */
export async function resolveGroup(page: Page, ref: string): Promise<Resolved> {
  const node = parseSnapshot(await snapshot(page)).get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  let up = node.parent;
  while (up && typeof describe(up) === 'string') up = up.parent;
  const target: Target = up ? { role: node.role, within: describe(up) as Target } : { role: node.role };
  const loc = toLocator(page, target);
  if (up && (await toLocator(page, target.within!).count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  if ((await loc.and(page.getByRef(ref)).count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  return { ok: true, ref, target };
}

/** 계획에 저장하는 대상 설명. 문자열 코드가 아니라 데이터이며, 패턴은 정규식 source다. role이 없으면 텍스트로 찾는다. */
export type Target = { role?: string; name?: string; text?: string; within?: Target };

export type Resolved =
  | { ok: true; ref: string; target: Target }
  | { ok: false; ref: string; reason: Reason };
type Reason = 'unknown_ref' | 'unnamed' | 'value_only' | 'ambiguous' | 'text_not_found';

type Node = { ref?: string; role: string; name?: string; text?: string; ownText: string[]; parent?: Node };

/**
 * ref를 Target으로 바꾼다. 역할·이름·텍스트에서 값(숫자)을 패턴으로 바꾸고, 유일하지 않으면 가까운 상위 요소로 범위를 좁힌다.
 * 만든 locator가 ref와 같은 요소 하나만 가리킬 때만 성공한다.
 */
export async function resolveRef(page: Page, ref: string): Promise<Resolved> {
  const node = parseSnapshot(await snapshot(page)).get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  const base = describe(node);
  if (typeof base === 'string') return { ok: false, ref, reason: base };
  const same = page.getByRef(ref);
  let target: Target = base;
  for (let up = node.parent, tries = 0; ; up = up?.parent) {
    const loc = toLocator(page, target);
    if ((await loc.count()) === 1 && (await loc.and(same).count()) === 1) return { ok: true, ref, target };
    while (up && typeof describe(up) === 'string') up = up.parent;
    if (!up || ++tries > 2) return { ok: false, ref, reason: 'ambiguous' };
    target = { ...base, within: describe(up) as Target };
  }
}

/**
 * ref가 붙지 않는 텍스트(그냥 span 안의 가격·개수 등)를, 그 텍스트를 직접 담은 ref 요소를 기준으로 고정한다.
 * 숫자는 패턴으로 바꾸고, 페이지에서 유일하지 않으면 가까운 이름 있는 상위 요소로 범위를 좁힌다.
 */
export async function resolveText(page: Page, ref: string, text: string): Promise<Resolved> {
  const node = parseSnapshot(await snapshot(page)).get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  if (!node.ownText.some(t => t.includes(text))) return { ok: false, ref, reason: 'text_not_found' };
  const pattern = valuePattern(text);
  if (!pattern) return { ok: false, ref, reason: 'value_only' };
  const inRef = page.getByRef(ref).getByText(new RegExp(pattern));
  if ((await inRef.count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  let target: Target = { text: pattern };
  for (let up: Node | undefined = node, tries = 0; ; up = up?.parent) {
    const loc = toLocator(page, target);
    if ((await loc.count()) === 1 && (await loc.and(inRef).count()) === 1) return { ok: true, ref, target };
    while (up && typeof describe(up) === 'string') up = up.parent;
    if (!up || ++tries > 2) return { ok: false, ref, reason: 'ambiguous' };
    target = { text: pattern, within: describe(up) as Target };
  }
}

/** Target을 Playwright API 호출로 조립한다. 문자열을 코드로 실행하지 않는다. */
export function toLocator(page: Page, t: Target): Locator {
  const scope: Page | Locator = t.within ? toLocator(page, t.within) : page;
  if (t.role === undefined) return scope.getByText(new RegExp(t.text!));
  const loc = scope.getByRole(t.role as Parameters<Page['getByRole']>[0],
    t.name === undefined ? {} : { name: new RegExp(t.name) });
  return t.text === undefined ? loc : loc.filter({ hasText: new RegExp(t.text) });
}

function describe(n: Node): Target | Reason {
  const label = n.name ?? n.text ?? (n.ownText.length ? n.ownText.join(' ') : undefined);
  if (label === undefined || !label.trim()) return 'unnamed';
  const pattern = valuePattern(label);
  if (!pattern) return 'value_only';
  // 자식이 있는 요소의 텍스트는 일부만 보이므로 부분 일치, 그 외는 전체 일치로 둔다.
  const anchored = n.name !== undefined || n.text !== undefined ? `^${pattern}$` : pattern;
  return n.name !== undefined ? { role: n.role, name: anchored } : { role: n.role, text: anchored };
}

/** 숫자 구간을 임의 값으로 바꾼 정규식 source. 숫자 외의 글자가 없으면 신원이 없으므로 null. */
export function valuePattern(label: string): string | null {
  const parts = label.trim().split(/\d[\d,.]*/);
  if (!parts.join('').replace(/[\s\p{P}\p{S}]/gu, '')) return null;
  return parts.map(escapeRegExp).join('.*?');
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// 줄 형식: `- role "name" [attr] [ref=e1]: text`. 이름·텍스트는 snapshot이 JSON 문자열로 따옴표를 쓴다.
const LINE = /^(\s*)- ([a-z]+)(?: ("(?:[^"\\]|\\.)*"))?[^:]*?(?:\[ref=([a-z0-9]+)\])?(?::(?: (.*))?)?$/;

/** snapshot 텍스트를 ref → Node 맵으로 읽는다. `- text:` 줄은 부모의 ownText가 된다. */
export function parseSnapshot(snap: string): Map<string, Node> {
  const byRef = new Map<string, Node>();
  const stack: { indent: number; node: Node }[] = [];
  for (const line of snap.split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    const [, space, role, name, ref, rest] = m;
    while (stack.length && stack.at(-1)!.indent >= space.length) stack.pop();
    const parent = stack.at(-1)?.node;
    const text = rest === undefined || rest === '' ? undefined : unquote(rest);
    if (role === 'text') { if (parent && text) parent.ownText.push(text); continue; }
    const node: Node = { ref, role, name: name ? unquote(name) : undefined, text, ownText: [], parent };
    if (ref) byRef.set(ref, node);
    stack.push({ indent: space.length, node });
  }
  return byRef;
}

function unquote(s: string): string {
  if (!s.startsWith('"')) return s;
  try { return JSON.parse(s); } catch { return s.slice(1, -1); }
}
