// 탐색 에이전트의 브라우저 도구. 페이지는 Playwright 접근성 snapshot(ref 포함)으로 보여주고,
// 모델이 고른 ref는 값·순서에 의존하지 않는 구조화된 대상 설명(Target)으로 바꿔야만 계획에 쓸 수 있다.
import type { Browser, BrowserContext, BrowserContextOptions, ElementHandle, Page, Locator } from 'playwright';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_SCHEMES = new Set(['data:', 'about:', 'blob:']);

/** deny: 요청하지 않을 주소(부분 문자열). 로그아웃처럼 로그인 상태를 끊는 주소를 앱 설정에서 받는다 */
export type Policy = { origins: string[]; allowWrites?: boolean; deny?: string[] };
export type Guarded = { context: BrowserContext; blocked: string[]; violations: string[] };

/**
 * 정책을 강제하는 브라우저 컨텍스트를 연다. 허용 origin 밖 요청과 권한 없는 쓰기 요청은 막고(blocked),
 * 막을 수 없는 우회(외부로의 리다이렉트)는 violations에 남긴다. violations가 있으면 그 실행은 신뢰하지 않는다.
 */
/**
 * 기대값 없이 잡히는 오류 신호(설계 5장 4단계). after = 신호가 난 단계('start' 또는 행동 ID).
 * normal = 검사 의도대로일 수 있는 정상 거절(401·403·422)이라 결함 신호로 세지 않는다.
 */
export type Signal = { kind: 'console' | 'pageerror' | 'http' | 'requestfailed'; after: string; url: string; text: string; status?: number; normal?: true };

/** storageState: 로그인으로 만든 브라우저 상태(login.ts). 주면 그 상태로 시작한다 */
export async function openContext(browser: Browser, policy: Policy, violations?: string[], storageState?: BrowserContextOptions['storageState']): Promise<Guarded> {
  const context = await browser.newContext({ serviceWorkers: 'block', ...(storageState ? { storageState } : {}) });
  return { context, ...(await guardContext(context, policy, violations)) };
}

/** 누르려는 요소(또는 그것을 담은 링크)의 주소가 앱 설정의 금지 주소면 그 주소. 누르기 전에 거절하는 데 쓴다. */
export async function deniedLink(loc: Locator, policy: Policy): Promise<string | undefined> {
  if (!policy.deny?.length) return undefined;
  const href = await loc.evaluate(e => (e.closest('a[href]') as HTMLAnchorElement | null)?.href ?? null).catch(() => null);
  return href && policy.deny.some(d => href.includes(d)) ? href : undefined;
}

/** 이미 만든 컨텍스트에 정책을 건다. Playwright 테스트 러너의 컨텍스트(trace 기록 포함)에도 쓴다. 서비스 워커 차단은 컨텍스트 생성 옵션이다. */
export async function guardContext(context: BrowserContext, policy: Policy, violations: string[] = [], onDeny?: (url: string) => void): Promise<Omit<Guarded, 'context'>> {
  const blocked: string[] = [];
  const allowed = (url: string) => {
    const u = new URL(url);
    return LOCAL_SCHEMES.has(u.protocol) || policy.origins.includes(u.origin);
  };
  const isDenied = (url: string) => !!policy.deny?.some(d => url.includes(d));
  await context.route('**/*', async route => {
    const req = route.request();
    const denied = isDenied(req.url());
    // 금지 주소는 안전장치로 막는다(서버 세션을 지킨다). 링크 클릭은 그 전에 행동 단계가 거절한다(deniedLink): 이동을 막으면 오류 페이지가 남는다.
    const permitted = !denied && allowed(req.url()) && (policy.allowWrites || SAFE_METHODS.has(req.method()));
    // 라우트는 리다이렉트의 다음 요청을 보지 못한다. 금지 주소가 있으면 페이지 이동은 리다이렉트를 따라가지 않고 받아 와서
    // 목적지가 금지 주소·허용 밖이면 막는다(허용된 /go가 /logout으로 보내 세션을 끊는 경우).
    if (permitted && policy.deny?.length && req.isNavigationRequest()) {
      const res = await route.fetch({ maxRedirects: 0 }).catch(() => undefined);
      if (!res) return route.abort('failed');
      const loc = res.headers()['location'];
      const next = loc ? new URL(loc, req.url()).href : undefined;
      if (next && (isDenied(next) || !allowed(next))) { blocked.push(`DENY redirect ${req.url()} -> ${next}`); onDeny?.(next); return route.abort('blockedbyclient'); }
      return route.fulfill({ response: res });
    }
    if (permitted) return route.continue();
    if (denied) { blocked.push(`DENY ${req.method()} ${req.url()}`); onDeny?.(req.url()); return route.abort('blockedbyclient'); }
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
export type Target = { role?: string; name?: string; text?: string; within?: Target; anchor?: string; nth?: number; of?: number; href?: string };

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
    while (up && !scopeOf(up)) up = up.parent;
    if (!up || ++tries > 2) {
      const link = await sameDestination(page, base, same);
      return link ? { ok: true, ref, target: link } : { ok: false, ref, reason: 'ambiguous' };
    }
    target = { ...base, within: scopeOf(up)! };
  }
}

// 이름이 없어도 페이지에 보통 하나뿐인 영역(머리말·꼬리말·본문 등). 유일하지 않으면 위 반복이 개수로 거른다.
const LANDMARKS = new Set(['banner', 'contentinfo', 'main', 'navigation', 'complementary', 'search']);
/** 범위로 쓸 상위 요소: 이름·텍스트로 식별되는 요소, 또는 이름 없는 랜드마크(역할만) */
const scopeOf = (n: Node): Target | undefined => {
  const d = describe(n);
  return typeof d !== 'string' ? d : LANDMARKS.has(n.role) ? { role: n.role } : undefined;
};

/**
 * 같은 영역 안의 로고와 메뉴처럼 영역으로도 나뉘지 않는데 이름도 주소도 같은 링크는 같은 곳으로 가므로 동등한 대상으로 본다.
 * 주소까지 같은 링크 안에서의 순서로 고정한다. 이름만 같고 주소가 다른 링크는 섞지 않는다.
 * shortcut: 같은 주소의 두 링크가 서로 다른 클릭 동작을 갖거나 재렌더링으로 순서만 바뀌면 다른 링크를 누를 수 있다(개수가 바뀌면 거부). 실측에서 보이면 링크별 고유 속성을 함께 고정한다.
 */
async function sameDestination(page: Page, base: Target, same: Locator): Promise<Target | undefined> {
  if (base.role !== 'link') return undefined;
  const href = await same.getAttribute('href').catch(() => null);
  if (!href) return undefined;
  const t: Target = { ...base, href };
  const n = await toLocator(page, t).count();
  if (n === 1) return t;
  for (let i = 0; i < n && n <= MAX_GROUP; i++) {
    const one: Target = { ...t, nth: i, of: n };
    if ((await toLocator(page, one).and(same).count()) === 1) return one;
  }
  return undefined;
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
export async function stableOnReload(page: Page, t: Target, group: boolean, timeoutMs: number, url = page.url(),
  size = page.viewportSize()): Promise<boolean> {
  const fresh = await page.context().newPage();
  try {
    // 화면 크기는 페이지마다 바꿀 수 있어 새 페이지에 넘어가지 않는다. pin한 크기(기본은 지금 크기)에서 다시 확인한다.
    if (size) await fresh.setViewportSize(size);
    await fresh.goto(url, { timeout: timeoutMs * 3 });
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
  const withText = t.text === undefined ? loc : loc.filter({ hasText: new RegExp(t.text) });
  // href 속성 원문과 비교한다. JSON 문자열의 따옴표·역슬래시 이스케이프는 CSS 문자열에서도 같은 뜻이다.
  return t.href === undefined ? withText : withText.and(scope.locator(`[href=${JSON.stringify(t.href)}]`));
}

/**
 * 라벨 영역으로 고정한 대상의 지금 영역 요소. 영역은 "라벨과 같은 모양 요소를 함께 담은 가장 작은 상위 요소"라
 * 대상이 사라지면 더 큰 영역으로 넓어진다. 그래서 대상을 찾았을 때의 영역을 기억해 두고 사라졌는지는 그 영역에서 본다.
 */
export async function areaOf(page: Page, t: Target): Promise<ElementHandle | null> {
  if (t.anchor === undefined) return null;
  return page.locator('*').filter({ has: page.getByText(new RegExp(t.anchor)) }).filter({ has: shape(page, t) }).last()
    .elementHandle({ timeout: 1000 }).catch(() => null);
}

/**
 * 기억한 영역에서 대상이 아예 사라졌는가. 영역이 문서에 남아 있고 라벨도 그대로인데 같은 모양 요소가 하나도 없을 때만 참이다.
 * 하나라도 남아 있으면 어느 것이 사라졌는지 모르므로 거짓(대상이 바뀐 것으로 남긴다). "사라졌다"를 읽을 때만 쓴다.
 */
export async function goneFromArea(page: Page, t: Target, area: ElementHandle | null | undefined): Promise<boolean> {
  // 역할만으로 고정한 대상(이름 없는 버튼 등)만 본다. 짧은 글자 모양으로 고정한 값은 내용이 바뀌면 모양에서 벗어날 뿐 요소는 남아 있다.
  if (!area || t.anchor === undefined || t.role === undefined || t.name !== undefined || t.text !== undefined) return false;
  if (!(await area.evaluate(e => e.isConnected).catch(() => false))) return false;
  const inArea = async (loc: Locator) => {
    for (const el of await loc.elementHandles()) if (await area.evaluate((a, x) => a.contains(x), el)) return true;
    return false;
  };
  // 라벨이 그 영역에 그대로 있어야 같은 영역이다(영역 전체가 다시 그려졌으면 판단하지 않는다).
  return await inArea(page.getByText(new RegExp(t.anchor))) && !(await inArea(shape(page, t)));
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

/**
 * 품질·사용성 점검(일반 규칙 ③, 설계 5장 6단계). 기대값 없이 브라우저가 계산한 사실로만 찾는다(AI 없음).
 * - unnamed-control: 접근 가능한 이름이 없는 조작 요소(개선 제안)
 * - covered-control: 화면 안 조작 요소의 가운데를 누르면 다른 요소가 눌림(조작을 막으므로 UI 결함)
 * - horizontal-overflow: 페이지가 화면 폭보다 넓어 가로로 넘침(개선 제안)
 */
export type AuditFinding = { kind: 'unnamed-control' | 'covered-control' | 'horizontal-overflow'; viewport: 'desktop' | 'mobile';
  level: 'ui_defect' | 'improvement';
  /** 재점검 때 같은 문제인지 가르는 대상 식별(역할·요소). 개수·폭 같은 측정값은 넣지 않는다 */
  target: string;
  detail: string };
export const MOBILE = { width: 390, height: 844 };
/** Playwright 기본 화면 크기. 탐색·실행 컨텍스트가 따로 정하지 않으므로 데스크톱은 이 크기다 */
export const DESKTOP = { width: 1280, height: 720 };
export type Viewport = 'desktop' | 'mobile';
// shortcut: 화면 크기만 바꾼다. 터치·모바일 UA(isMobile·hasTouch)는 컨텍스트 단위라 켜지 않는다. 터치 전용 동작을 검사해야 하면 모바일 컨텍스트를 따로 연다.
export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = { desktop: DESKTOP, mobile: MOBILE };
const NAMED_ROLES = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem']);

/**
 * 지금 화면(현재 크기)을 점검한다. skipUnnamed: 이미 다른 화면 크기에서 센 이름 없는 요소의 역할(같은 대상을 두 번 세지 않는다).
 * shortcut: 최상위 문서의 일반 DOM만 본다. iframe·shadow DOM 안은 점검하지 않는다(설계 문서에 범위 한계로 적음). 필요해지면 프레임·열린 shadow root를 순회한다.
 */
export async function auditPage(page: Page, viewport: AuditFinding['viewport'], skipUnnamed = new Set<string>()): Promise<AuditFinding[]> {
  const out: AuditFinding[] = [];
  // 역할별로 묶는다. 목록 카드마다 같은 아이콘 버튼이 있으면 한 줄로 세고 첫 위치만 예로 든다.
  const unnamed = new Map<string, { count: number; first: string }>();
  const where = (n: Node) => { for (let p = n.parent; p; p = p.parent) if (p.name) return `"${p.name.slice(0, 40)}" 안`; return ''; };
  for (const n of parseSnapshot(await tree(page).catch(() => [])).values()) {
    if (!NAMED_ROLES.has(n.role) || n.name?.trim() || skipUnnamed.has(n.role)) continue;
    const u = unnamed.get(n.role) ?? { count: 0, first: where(n) };
    u.count++;
    unnamed.set(n.role, u);
  }
  for (const [role, u] of unnamed)
    out.push({ kind: 'unnamed-control', viewport, level: 'improvement', target: role,
      detail: `${role}${u.count > 1 ? ` ${u.count}개` : ''}${u.first ? ` (${u.count > 1 ? '예: ' : ''}${u.first})` : ''}` });
  const measured = await page.evaluate(() => {
    const label = (e: Element) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
    const shown = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    // 실제로 열린 모달이 있으면 그 뒤는 가려지는 것이 정상이라 모달 안만 본다(모달의 닫기·확인 버튼이 가려진 것은 찾는다).
    const modal = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].find(shown);
    // ARIA 없이 만든 모달: 화면을 거의 다 덮는 고정 위치의 보이는 배경 덮개. 그 아래 깔린 요소가 가려지는 것은 의도다.
    // 투명한 전체 덮개는 넣지 않는다(닫은 뒤 남은 덮개처럼 조작을 막는 진짜 결함일 수 있다).
    const fixed = [...document.body.querySelectorAll('*')].filter(b => getComputedStyle(b).position === 'fixed' && shown(b) && getComputedStyle(b).opacity !== '0');
    const full = (b: Element) => { const r = b.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight * 0.9; };
    // 덮개 위에 실제로 떠 있는 창이 있어야 모달이다. 창 없이 남은 덮개는 조작을 막는 결함일 수 있어 그대로 찾는다.
    const above = (w: Element, b: Element) => { const r = w.getBoundingClientRect(); const st = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2); const i = st.findIndex(x => w.contains(x)); return i >= 0 && i < st.indexOf(b); };
    const backdrops = fixed.filter(b => {
      const s = getComputedStyle(b);
      const visibleFill = !/rgba\(.*,\s*0\)|transparent/.test(s.backgroundColor) || s.backdropFilter !== 'none' && !!s.backdropFilter;
      // 창은 덮개와 따로 떠 있는 고정 요소이거나 덮개 안의 작은 내용 상자다.
      const hasWindow = fixed.some(w => w !== b && !full(w) && !b.contains(w) && above(w, b))
        || [...b.querySelectorAll('*')].some(w => shown(w) && !full(w) && (w.textContent ?? '').trim() !== '');
      return visibleFill && full(b) && hasWindow;
    });
    // 고정 위치 창 안의 조작 요소(모달 자신의 버튼)는 덮개 아래에 깔려도 결함이다(z-index 오류).
    const inFixedWindow = (e: Element) => fixed.some(w => !backdrops.includes(w) && w.contains(e));
    const covered: { target: string; detail: string }[] = [];
    for (const e of (modal ?? document).querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox]')) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      // 투명한 요소(꾸민 체크박스 뒤의 실제 input 등)는 사람이 누르는 대상이 아니라 뺀다.
      if (r.width < 4 || r.height < 4 || s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none' || s.opacity === '0' || (e as HTMLInputElement).disabled) continue;
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // 조상이 잘라 내 보이지 않는 요소(캐러셀의 넘어간 슬라이드 등)는 가려진 것이 아니라 숨긴 것이다.
      let clipped = false;
      for (let a = e.parentElement; a && !clipped; a = a.parentElement) {
        const st = getComputedStyle(a);
        if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
        const ar = a.getBoundingClientRect();
        clipped = x < ar.left || x > ar.right || y < ar.top || y > ar.bottom;
      }
      if (clipped) continue;
      // elementFromPoint는 pointer-events:none인 요소를 건너뛴다. 그래서 나온 요소가 실제로 클릭을 받는 요소다.
      const hit = document.elementFromPoint(x, y);
      if (!hit || e.contains(hit) || hit.contains(e)) continue;
      // 자기 라벨이 눌리면 같은 조작이다(라벨 클릭은 그 입력을 조작한다).
      if ([...((e as HTMLInputElement).labels ?? [])].some(l => l.contains(hit))) continue;
      // 배경 덮개보다 아래에 깔린 요소는 모달 뒤의 내용이다. 덮개 위에 있는 모달 자신의 버튼이 가려진 것은 계속 찾는다.
      if (backdrops.length && !inFixedWindow(e)) {
        const stack = document.elementsFromPoint(x, y);
        const at = stack.findIndex(s => s === e || e.contains(s));
        if (backdrops.some(b => { const i = stack.indexOf(b); return i >= 0 && (at < 0 || i < at); })) continue;
      }
      covered.push({ target: label(e), detail: `${label(e)} 를 ${label(hit)} 가 가림` });
    }
    const sw = document.documentElement.scrollWidth;
    let widest = '';
    if (sw > innerWidth + 1) {
      let max = innerWidth;
      for (const e of document.body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.right > max + 1 && r.width > 0) { max = r.right; widest = label(e); } }
    }
    return { covered, overflow: sw > innerWidth + 1 ? `페이지 폭 ${sw}px > 화면 ${innerWidth}px${widest ? `, 가장 넓게 나간 요소 ${widest}` : ''}` : '' };
  }).catch(() => ({ covered: [] as { target: string; detail: string }[], overflow: '' }));
  for (const c of measured.covered) out.push({ kind: 'covered-control', viewport, level: 'ui_defect', ...c });
  if (measured.overflow) out.push({ kind: 'horizontal-overflow', viewport, level: 'improvement', target: 'page', detail: measured.overflow });
  return out;
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
 * 이름이 있는 요소는 이름과 안의 내용 텍스트를(내용이 이름과 같으면 이름만), 이름이 없는 요소는 자기 텍스트나 자손 텍스트를 읽는다.
 */
export function ariaText(nodes: AriaNode[], inside = false): string {
  // 이름 있는 요소 안의 이미지 대체 텍스트는 이름의 일부일 뿐 내용이 아니다(예: "View cart" 링크 안의 "Bag" 아이콘).
  return clean(nodes.map(n => typeof n === 'string' ? n : inside && n.role === 'img' ? '' : n.name !== undefined ? named(n)
    : `${n.text ?? ''} ${ariaText(n.children ?? [], inside)}`).join(' '));
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 읽기 규칙 1(M1~M3 2차): 이름 있는 요소는 이름만, 이름 없는 요소는 text 또는 자손 텍스트.
 * 이 규칙으로 기대값을 만든 예전 계획(plan.textRead 없음)은 이 규칙으로 읽어 기대값을 바꾸지 않고 재실행한다.
 */
export function ariaTextV1(nodes: AriaNode[]): string {
  return clean(nodes.map(n => typeof n === 'string' ? n : n.name ?? n.text ?? (n.children?.length ? ariaTextV1(n.children) : '')).join(' '));
}

/**
 * 이름 있는 요소는 이름과 안의 내용 텍스트를 함께 읽는다. 내용이 이름과 같거나 이름에 들어 있으면 이름만 읽는다.
 * 이름만 읽으면 내용을 담은 요소의 실제 값을 놓친다(Maison 실측 2026-10-16: FAQ 영역은 질문 문장만, 위시리스트 링크는 배지 숫자 없이 읽힘).
 */
function named(n: Exclude<AriaNode, string>): string {
  const name = n.name!;
  // 자식 텍스트가 하나뿐이면 snapshot은 그것을 children이 아니라 text 속성으로 준다.
  const inner = [n.text ?? '', ariaText(n.children ?? [], true)].join(' ').replace(/\s+/g, ' ').trim();
  // 이름 말고 남는 것이 기호뿐이면(숨긴 아이콘 글자 "+" 등) 장식으로 보고 이름만 읽는다.
  if (!inner || name.includes(inner) || !inner.replace(name, '').replace(/[\s\p{P}\p{S}]/gu, '')) return name;
  return inner.includes(name) ? inner : `${name} ${inner}`;
}
