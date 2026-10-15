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
  return { context, ...(await guardContext(context, policy)) };
}

/** 이미 만든 컨텍스트에 정책을 건다. Playwright 테스트 러너의 컨텍스트(trace 기록 포함)에도 쓴다. 서비스 워커 차단은 컨텍스트 생성 옵션이다. */
export async function guardContext(context: BrowserContext, policy: Policy): Promise<Omit<Guarded, 'context'>> {
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
  return { blocked, violations };
}

/** 페이지 전체 또는 ref 영역의 접근성 snapshot. ref 번호는 전체·부분 snapshot에서 같다. depth를 주면 그 깊이까지만 보여준다. */
export function snapshot(page: Page, ref?: string, depth?: number): Promise<string> {
  return (ref ? page.getByRef(ref) : page.locator('body')).ariaSnapshot({ mode: 'ai', ...(depth ? { depth } : {}) });
}

/**
 * 화면이 그려질 때까지 기다린다: 네트워크가 잠잠해지고 접근성 snapshot이 연속 두 번 같으면 준비된 것으로 본다.
 * 기한 안에 멈추지 않으면 false (계속 바뀌는 화면). 결과를 기록해 시작 증거가 준비 전 화면인지 구분하게 한다.
 * shortcut: 오래 멈춰 있는 로딩 표시는 준비로 오인한다. 시작 상태 확인은 선행조건 검사가 맡는다.
 */
export async function settle(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
  // ai 모드로 찍는다. 기본 모드 snapshot은 모델이 받은 ref 표를 지워 getByRef가 요소를 못 찾는다.
  let last = await page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '');
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const now = await page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '');
    if (now && now === last) return true;
    last = now;
  }
  return false;
}

/**
 * count 검사용 그룹 대상. ref와 같은 역할의 요소들을 가장 가까운 이름 있는 상위 요소 안에서 모은다.
 * 만든 locator가 ref 요소를 포함할 때만 성공한다.
 */
export async function resolveGroup(page: Page, ref: string): Promise<Resolved> {
  const nodes = parseSnapshot(await tree(page));
  const node = nodes.get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  // 목록·표 같은 컨테이너 자체를 고르면 개수 1짜리 그룹이 된다. 자식이 모두 같은 역할이면 그 항목들을 그룹으로 본다.
  if (CONTAINERS.has(node.role) && node.children.length && node.children.every(c => c.role === node.children[0].role)) {
    const item = node.children.find(c => c.ref);
    if (!item) return { ok: false, ref, reason: 'ambiguous' };
    const r = await resolveGroup(page, item.ref!);
    return { ...r, ref };
  }
  let up = node.parent;
  while (up && typeof describe(up) === 'string') up = up.parent;
  const target: Target = up ? { role: node.role, within: describe(up) as Target } : { role: node.role };
  const loc = toLocator(page, target);
  if (up && (await toLocator(page, target.within!).count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  if ((await loc.and(page.getByRef(ref)).count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  // 중첩 목록·표의 다른 열이 섞이지 않도록, 모은 수가 같은 부모 아래 같은 역할의 형제 수와 같아야 한다.
  const siblings = [...nodes.values()].filter(n => n.parent === node.parent && n.role === node.role).length;
  if ((await loc.count()) !== siblings) return { ok: false, ref, reason: 'ambiguous' };
  return { ok: true, ref, target };
}

/**
 * 계획에 저장하는 대상 설명. 문자열 코드가 아니라 데이터이며, 패턴은 정규식 source다. role이 없으면 텍스트로 찾는다.
 * anchor·nth·of는 이름 없는 아이콘 버튼·숫자만 있는 값처럼 스스로 신원이 없는 요소용이다: 페이지에서 유일한 라벨(anchor)을 담은
 * 가장 작은 영역 안에서, 같은 모양 요소 of개 중 nth번째(0부터). 영역 안 개수가 of와 다르면 대상이 바뀐 것으로 본다.
 */
export type Target = { role?: string; name?: string; text?: string; within?: Target; anchor?: string; nth?: number; of?: number };

export type Resolved =
  | { ok: true; ref: string; target: Target }
  | { ok: false; ref: string; reason: Reason };
type Reason = 'unknown_ref' | 'unnamed' | 'value_only' | 'ambiguous' | 'text_not_found';

type Node = { ref?: string; role: string; name?: string; text?: string; ownText: string[]; parent?: Node; children: Node[] };

/**
 * ref를 Target으로 바꾼다. 역할·이름·텍스트에서 값(숫자)을 패턴으로 바꾸고, 유일하지 않으면 가까운 상위 요소로 범위를 좁힌다.
 * 만든 locator가 ref와 같은 요소 하나만 가리킬 때만 성공한다.
 */
export async function resolveRef(page: Page, ref: string): Promise<Resolved> {
  const node = parseSnapshot(await tree(page)).get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  const base = describe(node);
  if (typeof base === 'string') {
    const anchored = await resolveAnchored(page, node.parent, node, page.getByRef(ref),
      [{ role: node.role }, ...(base === 'value_only' ? [{ text: SHORT_TEXT }] : [])]);
    return anchored ? { ok: true, ref, target: anchored } : { ok: false, ref, reason: base };
  }
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
  const nodes = parseSnapshot(await tree(page));
  const node = nodes.get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  // 텍스트는 자식 텍스트 조각이나 요소 자신의 text로 나온다.
  if (![node.text ?? '', ...node.ownText].some(t => t.includes(text))) return { ok: false, ref, reason: 'text_not_found' };
  const pattern = valuePattern(text);
  if (!pattern) {
    // 숫자만 있는 텍스트(수량 칸의 "1" 등)는 그 요소를 담은 영역의 라벨을 기준점으로 고정한다.
    const same = page.getByRef(ref).getByText(new RegExp(String.raw`^\s*` + escapeRegExp(text.trim()) + String.raw`\s*$`));
    if ((await same.count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
    const anchored = await resolveAnchored(page, node, undefined, same, [{ text: SHORT_TEXT }]);
    return anchored ? { ok: true, ref, target: anchored } : { ok: false, ref, reason: 'value_only' };
  }
  const inRef = page.getByRef(ref).getByText(new RegExp(pattern));
  if ((await inRef.count()) !== 1) return { ok: false, ref, reason: 'ambiguous' };
  // 찾은 요소가 ref를 가진 자식(버튼 등)이면 그 자식의 텍스트이지 ref가 직접 담은 텍스트가 아니다.
  for (const child of nodes.values()) {
    if (child.parent === node && child.ref && (await inRef.and(page.getByRef(child.ref)).count()) > 0) {
      return { ok: false, ref, reason: 'ambiguous' };
    }
  }
  let target: Target = { text: pattern };
  for (let up: Node | undefined = node, tries = 0; ; up = up?.parent) {
    const loc = toLocator(page, target);
    if ((await loc.count()) === 1 && (await loc.and(inRef).count()) === 1) return { ok: true, ref, target };
    while (up && typeof describe(up) === 'string') up = up.parent;
    if (!up || ++tries > 2) return { ok: false, ref, reason: 'ambiguous' };
    target = { text: pattern, within: describe(up) as Target };
  }
}

/**
 * 매번 바뀌는 목록(추천·무작위 관련 상품)의 요소를 이름이 아니라 고유한 라벨 영역 안의 순서로 고정한다.
 * "첫 번째 관련 상품을 누르면 그 이름의 상세가 열린다"처럼 관측 참조와 함께 쓴다.
 */
export async function resolvePosition(page: Page, ref: string): Promise<Resolved> {
  const node = parseSnapshot(await tree(page)).get(ref);
  if (!node) return { ok: false, ref, reason: 'unknown_ref' };
  const t = await resolveAnchored(page, node.parent, node, page.getByRef(ref), [{ role: node.role }]);
  return t ? { ok: true, ref, target: t } : { ok: false, ref, reason: 'ambiguous' };
}

/**
 * 고정한 대상이 같은 URL을 새로 열어도 있는지 확인한다. 새로고침마다 바뀌는 영역의 요소는 재실행에서 사라진다.
 * shortcut: 한 번만 다시 연다. 우연히 같은 항목이 다시 나오면 놓친다. 오탐이 보이면 횟수를 늘린다.
 */
export async function stableOnReload(page: Page, t: Target, group: boolean, timeoutMs: number): Promise<boolean> {
  const fresh = await page.context().newPage();
  try {
    await fresh.goto(page.url());
    await settle(fresh, timeoutMs);
    const n = await toLocator(fresh, t).count();
    return group ? n > 0 : n === 1 && !(await shapeChanged(fresh, t));
  } finally {
    await fresh.close();
  }
}

/** Target을 Playwright API 호출로 조립한다. 문자열을 코드로 실행하지 않는다. */
// shortcut: Target에 프레임 경로가 없어 iframe 안 요소는 페이지 범위 locator로 찾지 못한다. 필요해지면 Target에 프레임을 추가한다(M2 이후).
export function toLocator(page: Page, t: Target): Locator {
  let scope: Page | Locator = t.within ? toLocator(page, t.within) : page;
  // 라벨을 담고 같은 모양 요소도 담은 상위 요소 중 가장 안쪽(문서 순서상 마지막). 라벨이 유일하므로 후보는 그 조상들뿐이다.
  if (t.anchor !== undefined) scope = scope.locator('*').filter({ has: page.getByText(new RegExp(t.anchor)) })
    .filter({ has: shape(page, t) }).last();
  const loc = shape(scope, t);
  return t.nth === undefined ? loc : loc.nth(t.nth);
}

function shape(scope: Page | Locator, t: Target): Locator {
  if (t.role === undefined) return scope.getByText(new RegExp(t.text!));
  const loc = scope.getByRole(t.role as Parameters<Page['getByRole']>[0],
    t.name === undefined ? {} : { name: new RegExp(t.name) });
  return t.text === undefined ? loc : loc.filter({ hasText: new RegExp(t.text) });
}

/** 순서로 고정한 대상의 영역 안 같은 모양 요소 수가 고정 때와 다르면 순서가 다른 요소를 가리킬 수 있다. */
export async function shapeChanged(page: Page, t: Target): Promise<boolean> {
  // 라벨이 하나 더 생기면 .last()가 다른 영역을 고르므로, 실행 때도 라벨이 유일한지 본다.
  if (t.anchor !== undefined && (await page.getByText(new RegExp(t.anchor)).count()) !== 1) return true;
  return t.of !== undefined && (await toLocator(page, { ...t, nth: undefined }).count()) !== t.of;
}

// 숫자 칸은 숫자 모양이 아니라 "영역 안 짧은 텍스트 중 몇 번째"로 고정한다. 값이 NaN·오류 문구로 바뀌어도 같은 칸을 읽어 불일치로 비교한다.
const SHORT_TEXT = String.raw`^\s*\S.{0,39}$`;
const MAX_GROUP = 6;
const CONTAINERS = new Set(['list', 'listbox', 'table', 'rowgroup', 'grid', 'menu', 'menubar', 'tablist', 'tree', 'feed', 'radiogroup']);
const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'option', 'tab', 'menuitem',
  'switch', 'slider', 'spinbutton', 'listbox']);

/**
 * 스스로 신원이 없는 요소(이름 없는 버튼, 숫자만 있는 값)를 가까운 상위 요소 안의 고유한 라벨과 순서로 고정한다.
 * 예: "Quantity" 라벨 옆의 [−] [1] [+] → 라벨 영역 안 버튼 2개 중 두 번째, 영역 안 숫자 텍스트.
 * 작은 그룹(최대 6개)에서만 허용한다. 큰 목록에서 순서로 고르면 값·정렬에 따라 다른 요소가 된다.
 */
async function resolveAnchored(page: Page, from: Node | undefined, except: Node | undefined, same: Locator, bases: Target[]): Promise<Target | undefined> {
  for (let up = from, depth = 0; up && depth < 3; up = up.parent, depth++) {
    for (const label of labelsIn(up, except)) {
      const anchor = `^${label}$`;
      if ((await page.getByText(new RegExp(anchor)).count()) !== 1) continue;
      for (const base of bases) {
        // 라벨도 짧은 텍스트라, 값 칸의 모양에서 라벨을 빼야 라벨 자신이 아닌 라벨을 담은 영역이 범위가 된다.
        const t: Target = base.text === SHORT_TEXT ? { text: String.raw`^(?!\s*${label}\s*$)\s*\S.{0,39}$`, anchor } : { ...base, anchor };
        let n: number;
        try { n = await toLocator(page, t).count(); } catch { continue; }
        if (n < 1 || n > MAX_GROUP) continue;
        for (let i = 0; i < n; i++) {
          const one: Target = n > 1 ? { ...t, nth: i, of: n } : { ...t, of: 1 };
          if ((await toLocator(page, one).and(same).count()) === 1) return one;
        }
      }
    }
  }
  return undefined;
}

/** 영역 안에서 기준점이 될 수 있는 값 없는 텍스트(정규식 source). 대상 자신의 하위는 제외한다. */
function labelsIn(area: Node, except?: Node): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n === except) return;
    // 제목 같은 정적 요소의 이름도 라벨이다. 링크·버튼 이름은 바뀌는 항목 자체일 수 있어 쓰지 않는다.
    const name = n.name !== undefined && !INTERACTIVE.has(n.role) ? n.name : undefined;
    for (const t of [n.text, name, ...n.ownText]) if (t && !/\d/.test(t) && t.trim()) out.push(escapeRegExp(t.trim()));
    n.children.forEach(walk);
  };
  walk(area);
  return [...new Set(out)];
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

/** ariaSnapshotJSON의 노드. 텍스트 조각은 문자열로 온다. 모델에게 보여 주는 YAML snapshot과 같은 트리·ref다. */
export type AriaNode = string | { role: string; name?: string; text?: string; ref?: string; children?: AriaNode[] };

/** 대상 고정용 구조화 snapshot. YAML 문자열을 파싱하지 않아 줄 형식(따옴표·속성) 변화에 영향받지 않는다. */
function tree(page: Page): Promise<AriaNode[]> {
  return page.locator('body').ariaSnapshotJSON({ mode: 'ai' }) as Promise<AriaNode[]>;
}

/** 구조화 snapshot을 ref → Node 맵으로 읽는다. 텍스트 조각은 부모의 ownText가 된다. */
export function parseSnapshot(nodes: AriaNode[]): Map<string, Node> {
  const byRef = new Map<string, Node>();
  const walk = (list: AriaNode[], parent?: Node) => {
    for (const n of list) {
      if (typeof n === 'string' || n.role === 'text') {
        const t = typeof n === 'string' ? n : n.text;
        if (parent && t) parent.ownText.push(t);
        continue;
      }
      const node: Node = { ref: n.ref, role: n.role, name: n.name, text: n.text, ownText: [], parent, children: [] };
      parent?.children.push(node);
      if (n.ref) byRef.set(n.ref, node);
      walk(n.children ?? [], node);
    }
  };
  walk(nodes);
  return byRef;
}

/**
 * 모델이 snapshot(ai 모드)에서 본 것과 같은 기준의 텍스트. 숨긴 요소는 빠지고 CSS 대소문자 변환은 적용되지 않는다.
 * 이름이 있는 요소(링크·버튼·제목)는 snapshot에 이름으로 보이므로 이름을, 이름이 없는 요소는 자기 텍스트나 자손 텍스트를 읽는다.
 */
export function ariaText(nodes: AriaNode[]): string {
  return nodes.map(n => typeof n === 'string' ? n : n.name ?? n.text ?? (n.children?.length ? ariaText(n.children) : ''))
    .join(' ').replace(/\s+/g, ' ').trim();
}
