// ① 사이트 지도 (AI 없음). 시작 URL에서 같은 origin 링크를 GET으로만 따라가며 페이지를 모으고, URL 모양으로 템플릿을 묶는다.
// 템플릿은 대화를 나누고 보고서의 범위를 표시하는 단위다. "사이트 전체"라고 주장하지 않도록 방문하지 못한 링크도 남긴다.
import type { Page, Request } from 'playwright';
import { auditPage, settle, BROKEN, hashRoute, MOBILE, type AuditFinding, type Policy } from './browser.ts';

export type Template = { key: string; pages: string[] };
/**
 * failed: 이동에 실패한 URL. 템플릿은 URL 모양으로 묶은 잠정 분류다(구조 비교 없음).
 * audit: 방문한 페이지의 품질·사용성 점검. confirmed = 화면이 안정된 상태에서 두 번(처음·새로 열어 다시) 모두 나온 것.
 * auditErrors: 점검하지 못한 페이지와 사유(미완료로 보고한다).
 */
export type SiteMap = { templates: Template[]; visited: string[]; unvisited: string[]; failed: string[];
  audit?: { url: string; findings: (AuditFinding & { confirmed: boolean })[] }[]; auditErrors?: string[];
  /** 같은 origin 링크를 따라갔더니 없는 페이지(404·410)나 서버 오류(5xx)가 온 것. from = 그 링크가 있던 페이지와 링크 글자. 다시 요청해도 같으면 confirmed */
  broken?: { url: string; status: number; from: string; text: string; confirmed: boolean }[];
  /** 방문한 페이지마다 보이는 입력칸 수(텍스트·선택·체크 등, 버튼 제외). 폼 페이지를 먼저 탐색하는 데 쓴다 */
  fields?: Record<string, number>;
  /** 방문한 페이지마다 구조 정보(링크 위치·폼·화면 골격·API). siteStructure()가 이것으로 중심 노드와 묶음을 만든다 */
  structure?: Record<string, PageInfo>;
  /** 이 사이트가 페이지를 주소에 나타내는 방식(모은 주소 전체로 판별). 페이지 종류 묶기와 같은 페이지 비교에 쓴다 */
  scheme?: UrlScheme;
  /** 페이지가 아닌 링크(이미지·다운로드·JSON 등). 페이지 종류·중심 노드에 넣지 않는다 */
  files?: string[];
  /** 이동에 실패한 URL의 사유(첫 줄) */
  failedReasons?: Record<string, string>;
  /** 중심 노드 판정을 덮어쓴 종류(구조 AI 검토). false면 규칙이 중심 노드로 봐도 아니다 */
  hubOverride?: Record<string, boolean>;
  /** 구조 AI 검토 기록(--ai-structure). 규칙 판정·AI 판정·근거·반영 여부 */
  structureReview?: import('./structure-ai.ts').StructureReview };

/**
 * 사이트가 페이지를 주소에 나타내는 방식. 사이트마다 다르므로 묶기 전에 모은 주소로 먼저 판별한다(AI 없음).
 * routing: path(/a/b), hash(#/a, #!/a), query(index.php?route=a, /?p=12). 섞여 있으면 여럿.
 * locale: 거의 모든 주소가 언어 조각(/en, /ko-kr)으로 시작한다. 종류를 가를 때 그 다음 조각을 첫 조각으로 본다.
 * query: 주소(origin+경로)마다 페이지 종류를 정하는 키(route)와 페이지 하나를 가리키는 식별자 키(id, 값은 :x로 묶음).
 */
export type UrlScheme = { routing: ('path' | 'hash' | 'query')[]; locale: boolean;
  /** required: 종류(route 값 조합)마다 화면을 정하는 식별자 키. 그 종류 주소의 90% 이상에 있는 키만이다(나머지는 분류·유입 문맥) */
  query: Record<string, { route: string[]; id: string[]; required?: Record<string, string[]> }> };

const LOCALE = /^[a-z]{2}([-_][a-z]{2,4})?$/i;
// 쿼리로 페이지를 나누는 주소는 보통 프런트 컨트롤러(/, index.php, page.asp 등)다. 일반 경로(/products?sort=…)의 쿼리는 화면 상태로 보고 묶지 않는다.
const FRONT = /^\/$|\.[a-z]{2,5}$/i;
// 쿼리 값. 값 안에 주소가 잘못 붙은 링크(?controller=authentication?back=https://…)는 첫 "?"·"://" 앞까지만 값으로 본다(Test Store 로그인 링크 17개가 17종이 됨, 11/13).
const param = (u: URL, k: string) => u.searchParams.get(k)?.split(/\?|:\/\//)[0] ?? null;
const kindOf = (route: string[], u: URL) => route.map(k => `${k}=${param(u, k)}`).join('&');
/** 이 주소에서 화면을 정하는 식별자 키(종류별 required, 없으면 발견한 식별자 키 전부) */
const idsOf = (q: UrlScheme['query'][string], u: URL) => (q.required?.[kindOf(q.route, u)] ?? q.id).filter(k => u.searchParams.has(k));
const group = <T>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; };

export function urlScheme(urls: string[]): UrlScheme {
  const us = urls.flatMap(u => { try { return [new URL(u)]; } catch { return []; } });
  const firsts = us.map(u => u.pathname.split('/')[1] ?? '').filter(Boolean);
  const locale = firsts.length >= 3 && firsts.filter(f => LOCALE.test(f)).length >= firsts.length * 0.8 && new Set(firsts.filter(f => LOCALE.test(f))).size <= 5;
  const query: UrlScheme['query'] = {};
  for (const [base, list] of group(us.filter(u => FRONT.test(u.pathname)), u => u.origin + u.pathname)) {
    if (list.length < 3) continue;
    const keys = [...new Set(list.flatMap(u => [...u.searchParams.keys()]))];
    const vals = (xs: URL[], k: string) => xs.map(u => param(u, k)).filter((v): v is string => v !== null);
    // 종류 키: 이 주소 링크의 절반 이상에 있고, 식별자가 아닌 값이 둘 이상(route=product/product, route=account/login).
    const route = keys.filter(k => vals(list, k).length >= list.length * 0.5 && new Set(vals(list, k).filter(v => !idLike(v))).size >= 2);
    // 식별자 키: 같은 종류 안에서 절반 이상에 있고 값이 모두 식별자 모양이며 셋 이상 다르다(product_id=40, p=12).
    const kinds = [...group(list, u => kindOf(route, u)).values()];
    const id = keys.filter(k => !route.includes(k) && kinds.some(g => { const v = vals(g, k); return g.length >= 3 && v.length >= g.length * 0.5 && new Set(v).size >= 3 && v.every(idLike); }));
    // 같은 상품도 분류·제조사 문맥(&path=, &manufacturer_id=)이 붙으면 다른 종류로 나뉘었다(OpenCart, Codex 11/13).
    // 종류마다 거의 늘 있는 식별자 키만 화면을 정하는 키로 본다. 주소가 하나뿐인 종류는 있는 키를 다 쓴다(근거 부족).
    // 종류 키가 없는 주소(/?p=12)는 첫 화면(/)과 글이 한 무리라 비율로 가를 수 없어 식별자 키를 다 쓴다.
    // 종류 안에 늘 있는 식별자 키가 없으면(목록 화면 주소와 그 상세 주소가 같은 route), 식별자 모양 키가 있는지 없는지가 목록·상세를 가른다.
    // 브랜드 목록(?controller=manufacturer)과 브랜드별 상품(&id_manufacturer=2)이 한 종류로 합쳐졌다(Test Store, Codex 2차 11/13: 값이 2개라 식별자 키로 못 봄).
    const idKeys = (g: URL[]) => keys.filter(k => !route.includes(k) && vals(g, k).length > 0 && vals(g, k).every(idLike));
    const requiredOf = (g: URL[]) => {
      const all = idKeys(g), always = all.filter(k => g.length < 2 ? g[0].searchParams.has(k) : vals(g, k).length >= g.length * 0.9);
      return always.length ? always : all;
    };
    const required = route.length ? Object.fromEntries(kinds.map(g => [kindOf(route, g[0]), requiredOf(g)])) : undefined;
    if (route.length || id.length) query[base] = { route, id, ...(required ? { required } : {}) };
  }
  const routing = [...new Set(us.map(u => hashRoute(u) ? 'hash' as const : query[u.origin + u.pathname] ? 'query' as const : 'path' as const))];
  return { routing: routing.length ? routing : ['path'], locale, query };
}

/**
 * links: 같은 origin 링크(정리된 주소). layout = 헤더·메뉴·푸터 같은 공통 영역이나 메뉴 버튼 안에 있던 링크.
 *   region = 링크를 담은 가장 가까운 영역(id 있는 요소·랜드마크·목록)의 표시. 같은 목적지라도 놓인 영역이 다르면 다른 링크로 센다.
 * forms: form 밖 입력칸은 버튼이 있는 가장 가까운 영역마다 따로 묶는다(헤더 검색칸과 본문 수량칸이 섞이지 않게).
 * forms: 보이는 입력칸이 있는 폼(form 밖 입력칸은 action 없는 폼 하나로 묶는다). method는 속성이 있을 때만, layout = 공통 영역 안. shape: 화면 골격 지문(요소 수를 구간으로).
 * api: 페이지를 여는 동안 보낸 fetch/xhr 요청(방식과 경로, 숫자 조각은 :x). 정책이 막은 쓰기 요청도 시도로 남는다.
 */
export type PageInfo = { links: { to: string; text: string; layout: boolean; region?: string }[]; search: boolean; shape: string; api: string[];
  /** 문서 제목과 첫 보이는 h1(없으면 h2). 같은 기능의 페이지인지 사람·AI가 판단하는 근거 */
  title?: string; heading?: string;
  forms: { action: string; method: string; submit: string; layout: boolean; fields: { type: string; name: string; required: boolean }[] }[] };


/**
 * 페이지를 가리키는 주소. 같은 경로의 다른 쿼리(정렬·필터)는 같은 페이지로 보고, hash 라우팅이면 hash 안 경로가 페이지 경로다.
 * 사이트가 쿼리로 페이지를 나누면(scheme.query) 그 키(route·식별자)는 남긴다.
 */
export const pathOf = (url: string, scheme?: UrlScheme) => {
  const u = new URL(url), q = scheme?.query[u.origin + u.pathname];
  const kv = q ? [...q.route.filter(k => u.searchParams.has(k)), ...idsOf(q, u)].map(k => `${k}=${param(u, k)}`).join('&') : '';
  return u.origin + (u.pathname.replace(/\/+$/, '') || '/') + (kv ? `?${kv}` : '') + hashRoute(u).split('?')[0].replace(/\/+$/, '').replace(/^#!?$/, '');
};

// 식별자처럼 보이는 경로 조각: 숫자를 담거나, 인코딩·비ASCII 글자(글 제목 slug)이거나, 아주 긴 조각.
const idLike = (s: string) => /\d|%[0-9a-f]{2}|[^\x00-\x7f]/i.test(s) || s.length > 40;

/**
 * URL을 템플릿으로 묶는다. 경로 조각 중 식별자처럼 보이는 것은 `:x`이고, 나머지가 같은데 한 위치만 다른 페이지가 둘 이상이면
 * 그 위치도 `:x`다(`/product/:x`, `/c/:x/comments/:x/:x`, `/c/:x/submit`). 마지막 조각만 보던 규칙은 게시글처럼 깊은 경로를
 * 글마다 다른 종류로 나눠 같은 화면에 탐색 대화를 여러 번 열었다(agora 10/26: 페이지 종류 75개, 대화 18개 중 9개가 게시글).
 * 첫 조각(/products, /cart, /info)은 서로 다른 기능이므로 묶지 않는다.
 * shortcut: URL 모양만 본다. 같은 상위 경로의 서로 다른 안내 페이지(/info/faq, /info/returns)도 묶이고, 구조 지문 비교는 없다.
 * 숫자·한글이 없는 짧은 영어 slug가 그 위치에 하나뿐이면 식별자로 못 알아봐 따로 남는다. 실측에서 보이면 화면 구조 비교를 더한다.
 */
export function groupTemplates(urls: string[], scheme: UrlScheme = urlScheme(urls)): Template[] {
  const shapes = new Map(urls.map(u => {
    const url = new URL(u), { origin } = url;
    // 쿼리로 페이지를 나누는 사이트: 경로와 종류 키 값이 종류이고 식별자 키 값은 :x다. 이 부분은 아래의 "한 위치만 다르면 묶기"에서 뺀다.
    const q = scheme.query[origin + url.pathname];
    if (q) {
      const kv = [...q.route.filter(k => url.searchParams.has(k)).map(k => `${k}=${param(url, k)}`), ...idsOf(q, url).map(k => `${k}=:x`)].join('&');
      return [u, { origin: origin + url.pathname + (kv ? `?${kv}` : ''), segs: [] as string[] }] as const;
    }
    // hash 라우팅이면 hash 안 경로로 묶는다(앞 경로가 /이면 생략해 첫 조각 규칙이 라우트 첫 조각에 적용되게 한다).
    const full = pathOf(u).slice(origin.length), route = full.replace(/^\/#!?(?=\/)/, '');
    let prefix = origin + full.slice(0, full.length - route.length), segs = route.split('/').slice(1);
    // 언어 조각은 앞에 붙여 두고 다음 조각을 첫 조각으로 본다(/en/products와 /en/cart를 묶지 않게).
    if (scheme.locale && LOCALE.test(segs[0] ?? '')) { prefix += `/${segs[0]}`; segs = segs.length > 1 ? segs.slice(1) : ['']; }
    return [u, { origin: prefix, segs: segs.map((s, i) => i > 0 && idLike(s) ? ':x' : s) }] as const;
  }));
  const all = [...shapes.values()];
  // 뒤에서부터 위치마다: 그 위치만 빼고 같은 경로들이 그 위치에서 둘 이상 다르면 :x로 묶는다(그 위치는 비교에서 빠지므로 바꿔도 다른 묶음에 영향 없음).
  for (let i = Math.max(0, ...all.map(x => x.segs.length)) - 1; i >= 1; i--) {
    const keyOf = (x: (typeof all)[number]) => `${x.origin}|${x.segs.length}|${x.segs.map((s, j) => j === i ? '' : s).join('/')}`;
    const values = new Map<string, Set<string>>();
    for (const x of all) if (x.segs.length > i) values.set(keyOf(x), (values.get(keyOf(x)) ?? new Set()).add(x.segs[i]));
    for (const x of all) if (x.segs.length > i && values.get(keyOf(x))!.size > 1) x.segs[i] = ':x';
  }
  const templates = new Map<string, string[]>();
  for (const u of urls) {
    const { origin, segs } = shapes.get(u)!;
    const key = segs.length ? `${origin}/${segs.join('/')}` : origin;
    if (!templates.has(key)) templates.set(key, []);
    templates.get(key)!.push(u);
  }
  return [...templates].map(([key, pages]) => ({ key, pages }));
}

/**
 * 너비 우선으로 같은 origin 페이지를 방문해 링크를 모은다. 같은 템플릿은 perTemplate개까지만 방문한다.
 * 쓰기 요청은 컨텍스트 정책이 막는다. 방문 수 한도를 넘긴 링크는 unvisited로 남긴다.
 */
export async function crawl(page: Page, startUrl: string, policy: Policy, o: { maxPages: number; perTemplate: number; timeoutMs: number; audit?: boolean }): Promise<SiteMap> {
  const clean = (u: string) => { const x = new URL(u); x.hash = /^#!?\/?$/.test(x.hash) ? '' : hashRoute(x); return x.href; };
  const queue = [clean(startUrl)];
  const known = new Set(queue);
  const visited: string[] = [];
  const failed: string[] = [];
  const found = new Map<string, { findings: AuditFinding[]; ready: boolean }>();
  const auditErrors: string[] = [];
  const from = new Map<string, { page: string; text: string }>();
  const broken: { url: string; status: number }[] = [];
  const fields: Record<string, number> = {};
  const structure: Record<string, PageInfo> = {};
  const files: string[] = [];
  const failedReasons: Record<string, string> = {};
  // 막힌 요청 뒤 그 탭이 오류 화면으로 옮겨 가는 동안 다음 이동이 계속 끊겼다(scrapethissite·quotes, Codex 11/13: "interrupted by another navigation").
  // 같은 탭에서 기다렸다 다시 여는 것으로는 풀리지 않아, 이동이 실패하면 그 탭을 닫고 같은 컨텍스트(쿠키·정책 그대로)의 새 탭으로 바꾼다.
  // 끊긴 이동은 새 탭에서 한 번 더 연다.
  const fresh = async () => { const p = await page.context().newPage(); await page.close().catch(() => {}); page = p; };
  const open = async (url: string, listen: (r: Request) => void) => {
    for (let i = 0; ; i++) {
      page.on('request', listen);
      try { return await page.goto(url, { timeout: o.timeoutMs * 3 }); }
      catch (e) {
        const msg = String((e as Error)?.message ?? e).split('\n')[0];
        await fresh();
        // 시작 페이지가 첫 시도에 시간 초과로 실패하면 사이트 지도 전체가 비므로 한 번 더 연다(toolshop 11/13: 첫 이동 15초 초과, 다시 열면 정상).
        if (i === 0 && (/interrupted by another navigation|ERR_ABORTED|frame was detached/i.test(msg) || !visited.length && /Timeout/i.test(msg))) continue;
        throw new Error(msg);
      }
    }
  };
  // 실패한 이동도 한도에 센다. 실패하는 URL이 많아도 시도 수와 발견 수가 끝없이 늘지 않게 한다.
  const maxAttempts = o.maxPages * 2, maxKnown = o.maxPages * 10;
  let attempts = 0;
  while (queue.length && visited.length < o.maxPages && attempts < maxAttempts) {
    const url = queue.shift()!;
    // 이미 방문한 페이지들과 함께 다시 묶어 같은 템플릿의 방문 수를 센다(묶음이 나중에 생겨도 앞선 방문을 놓치지 않는다).
    // 주소 방식은 지금까지 발견한 주소 전체로 판별한다(방문한 몇 페이지만으로는 쿼리 라우팅을 못 알아봐 모든 페이지가 한 종류가 된다).
    // 묶음은 발견한 주소 전체로 정한다. 방문한 주소만으로 묶으면 끝에 발견 전체로 다시 묶은 종류와 경계가 달라 상한을 넘겼다(Sylius 8곳, Codex 11/13).
    const same = groupTemplates([...known], urlScheme([...known])).find(t => t.pages.includes(url))!;
    if (same.pages.filter(p => visited.includes(p)).length >= o.perTemplate) continue;
    attempts++;
    let ready = false;
    const api = new Set<string>();
    const onRequest = (r: Request) => { if (['fetch', 'xhr'].includes(r.resourceType())) api.add(apiKey(r.method(), r.url(), url)); };
    try {
      const res = await open(url, onRequest);
      // 깨진 페이지는 방문한 페이지 종류로 세지 않는다(탐색 대화를 열지 않고 링크가 있던 페이지의 이동 결함으로 보고).
      if (res && BROKEN(res.status()) && from.has(url)) { broken.push({ url, status: res.status() }); continue; }
      // 이미지·JSON 같은 문서는 페이지가 아니다. 응답 형식이 HTML이 아니거나, HTML로 왔어도 본문 전체가 JSON 글자면 뺀다.
      if (!/html/i.test(res?.headers()['content-type'] ?? 'text/html') || await page.evaluate(() => {
        const t = document.body?.innerText.trim() ?? '';
        if (!/^[[{]/.test(t) || document.body.querySelectorAll('a,button,input,img').length) return false;
        try { JSON.parse(t); return true; } catch { return false; }
      }).catch(() => false)) { files.push(url); continue; }
      ready = await settle(page, o.timeoutMs);
      // SPA 전환 애니메이션 중에는 떠나는 화면이 남아 있어 그 요소까지 읽었다(PhoneCat .ng-leave, Codex 11/13). 끝나는 애니메이션이 있으면 끝나기를 기다려 다시 안정을 본다.
      const moving = () => document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity);
      if (await page.evaluate(moving).catch(() => false)) {
        await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), undefined, { timeout: o.timeoutMs }).catch(() => {});
        ready = await settle(page, o.timeoutMs) && ready;
      }
    } catch (e) { failed.push(url); failedReasons[url] = String((e as Error)?.message ?? e); continue; }
    finally { page.off('request', onRequest); }
    visited.push(url);
    fields[url] = await page.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select')
      .filter({ visible: true }).count().catch(() => 0);
    // 점검은 덧붙인 기능이다. 실패해도 사이트 지도 수집은 계속하고 그 페이지를 점검 미완료로 남긴다.
    if (o.audit) {
      try { found.set(url, { findings: await audit(page, o.timeoutMs), ready }); }
      catch (e) { auditErrors.push(`${url}: ${String((e as Error)?.message ?? e).split('\n')[0]}`); }
    }
    const shown = await pageInfo(page);
    const links = [...await anchors(page), ...(await menuLinks(page, url, o.timeoutMs)).map(l => ({ ...l, layout: true }))];
    const out = new Map<string, PageInfo['links'][number]>();
    for (const l of links) {
      let u: string;
      try { u = clean(l.href); } catch { continue; }
      if (!policy.origins.includes(new URL(u).origin) || policy.deny?.some(d => u.includes(d))) continue;
      // 이미지·문서 파일 주소는 열지 않고 파일로만 남긴다.
      if (FILE.test(new URL(u).pathname)) { if (!files.includes(u)) files.push(u); continue; }
      // 같은 주소가 본문과 공통 영역에 다 있으면 본문 링크로 본다(영역 표시도 본문 쪽).
      if (u !== url) { const had = out.get(u); const body = had && !had.layout ? had : l; out.set(u, { to: u, text: had?.text || l.text, layout: (had?.layout ?? true) && l.layout, region: body.region }); }
      if (known.has(u) || known.size >= maxKnown) continue;
      known.add(u);
      from.set(u, { page: url, text: l.text });
      queue.push(u);
    }
    structure[url] = { ...shown, api: [...api].sort(), links: [...out.values()] };
  }
  const all = [...known];
  // 발견이 있는 페이지는 새로 열어 한 번 더 점검한다. 두 번 다 나온 것만 재현된 것으로 본다.
  const auditResult: NonNullable<SiteMap['audit']> = [];
  for (const [url, { findings, ready }] of found) {
    if (!findings.length) continue;
    let again: AuditFinding[] = [];
    let readyAgain = false;
    try { await page.goto(url, { timeout: o.timeoutMs * 3 }); readyAgain = await settle(page, o.timeoutMs); again = await audit(page, o.timeoutMs); }
    catch { /* 다시 열지 못하면 확인되지 않은 것으로 남긴다 */ }
    // 같은 문제인지는 대상 식별로만 가른다. 개수·폭 같은 측정값이 조금 바뀌어도 같은 문제다.
    const key = (f: AuditFinding) => `${f.kind}|${f.viewport}|${f.target}`;
    const seen = new Set(again.map(key));
    // 로딩 중인 화면(덮개가 버튼을 가리는 등)에서 나온 발견은 두 번 나와도 확인됨으로 두지 않는다.
    auditResult.push({ url, findings: findings.map(f => ({ ...f, confirmed: ready && readyAgain && seen.has(key(f)) })) });
  }
  // 일시적인 서버 오류를 결함으로 단정하지 않도록 한 번 더 요청한다(GET, 같은 컨텍스트 쿠키).
  const brokenResult: NonNullable<SiteMap['broken']> = [];
  for (const b of broken) {
    const again = await page.request.get(b.url, { timeout: o.timeoutMs * 3 }).then(r => r.status()).catch(() => 0);
    const f = from.get(b.url)!;
    brokenResult.push({ ...b, from: f.page, text: f.text, confirmed: BROKEN(again) });
  }
  const gone = new Set([...broken.map(b => b.url), ...files]);
  const kept = all.filter(u => !gone.has(u));
  const scheme = urlScheme(kept);
  return { templates: splitByShape(groupTemplates(kept, scheme), structure, scheme), scheme, visited, failed, unvisited: kept.filter(u => !visited.includes(u)), fields, structure,
    ...(files.length ? { files } : {}), ...(Object.keys(failedReasons).length ? { failedReasons } : {}),
    ...(o.audit ? { audit: auditResult, ...(auditErrors.length ? { auditErrors } : {}) } : {}),
    ...(brokenResult.length ? { broken: brokenResult } : {}) };
}

const LAYOUT = 'header,nav,footer,aside,[role=banner],[role=navigation],[role=contentinfo],[role=complementary],[role=menu]';
const FILE = /\.(jpe?g|png|gif|svg|webp|avif|ico|bmp|pdf|zip|gz|tgz|rar|7z|mp[34]|webm|avi|mov|wav|ogg|css|js|mjs|json|xml|txt|csv|xlsx?|docx?|pptx?|woff2?|ttf|otf|eot|exe|dmg|apk)$/i;
const anchors = (page: Page) => page.locator('a[href]').evaluateAll((as, layout) => as.map(a => {
  const box = a.parentElement?.closest('[id],header,nav,footer,aside,main,section,article,ul,ol,[role]');
  const region = box ? `${box.tagName.toLowerCase()}${box.id ? `#${box.id}` : box.getAttribute('role') ? `[${box.getAttribute('role')}]` : box.classList[0] ? `.${box.classList[0]}` : ''}` : 'body';
  return { href: (a as HTMLAnchorElement).href, text: (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), layout: !!a.closest(layout), region };
}), LAYOUT).catch(() => [] as { href: string; text: string; layout: boolean; region: string }[]);

/**
 * URL 모양으로 한 종류가 된 페이지 중 화면 골격이 다른 것을 따로 뗀다(폼 페이지와 파일 목록이 /web/:x로 묶였다, Codex 11/13).
 * 다른 조각이 모두 식별자 모양(숫자 등)이면 같은 화면의 데이터 차이로 보고 떼지 않는다. 방문하지 않은 페이지는 원래 종류에 남는다.
 */
export function splitByShape(templates: Template[], structure: Record<string, PageInfo>, scheme?: UrlScheme): Template[] {
  const out: Template[] = [];
  for (const t of templates) {
    const seen = t.pages.filter(p => structure[p]?.shape);
    const base = seen[0];
    if (!base || new Set(seen.map(p => structure[p].shape)).size < 2) { out.push(t); continue; }
    const parts = (u: string) => pathOf(u, scheme).split(/[/?&#=]/);
    const dataOnly = (p: string) => { const a = parts(p), b = parts(base); return a.length === b.length && a.every((s, i) => s === b[i] || idLike(s) && idLike(b[i])); };
    const own = seen.filter(p => structure[p].shape !== structure[base].shape && !dataOnly(p));
    for (const p of own) out.push({ key: pathOf(p, scheme), pages: [p] });
    out.push({ ...t, pages: t.pages.filter(p => !own.includes(p)) });
  }
  return out;
}

/** API 요청을 "방식 경로"로 줄인다. 같은 origin은 경로만, 다른 origin은 origin을 붙인다. 숫자가 든 조각과 페이지 주소에 든 조각(상품 slug)은 :x. */
const apiKey = (method: string, raw: string, pageUrl: string) => {
  const own = new Set(pathOf(pageUrl).split(/[/#]/).filter(x => x.length > 2));
  const u = new URL(raw), path = u.pathname.split('/').map(x => /\d/.test(x) || own.has(x) ? ':x' : x).join('/');
  return `${method} ${u.origin === new URL(pageUrl).origin ? '' : u.origin}${path}`;
};

/** 폼·검색창·화면 골격을 브라우저에서 읽는다. 골격은 본문(main)의 제목·폼·입력칸 수 구간·표·대화상자 유무다. */
const pageInfo = (page: Page): Promise<Omit<PageInfo, 'links' | 'api'>> => page.evaluate(layout => {
  const vis = (e: Element) => { const r = e.getBoundingClientRect(), st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden'; };
  // 열린 shadow root 안도 본다. 입력칸 수(locator)는 shadow 안을 세는데 구조 수집은 못 봐 서로 달랐다(Playground shadowdom, Codex 11/13).
  const roots: ParentNode[] = [document];
  for (let i = 0; i < roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  const deep = (sel: string) => roots.flatMap(r => [...r.querySelectorAll(sel)]);
  // shadow 안 요소는 그 shadow를 가진 바깥 요소 기준으로 위치(공통 영역·본문)를 본다.
  const light = (e: Element) => { let n: Element = e; while (n.getRootNode() instanceof ShadowRoot) n = (n.getRootNode() as ShadowRoot).host; return n; };
  const text = (e: Element | null) => (e?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select';
  const nameOf = (f: HTMLInputElement) => (f.getAttribute('aria-label') || (f.labels?.[0] ? text(f.labels[0]) : '') || f.placeholder || f.name || '').slice(0, 40);
  const formOf = (root: Element, fs: Element[]) => {
    // form 밖 입력칸은 그 영역에 보이는 버튼이 하나뿐일 때만 제출 버튼으로 본다(여럿이면 어느 것인지 몰라 비워 둔다).
    const isForm = root.tagName === 'FORM', f = root as HTMLFormElement;
    const looseButtons = isForm || root === document.body ? [] : [...root.querySelectorAll('button,input[type=submit],input[type=button],[role=button]')].filter(vis);
    const btn = isForm ? root.querySelector('button[type=submit], input[type=submit], button:not([type])') : looseButtons.length === 1 ? looseButtons[0] : null;
    return { action: isForm && f.getAttribute('action') ? f.action : '', method: (isForm && f.getAttribute('method') || '').toUpperCase(), layout: !!light(root).closest(layout) || fs.every(x => light(x).closest(layout)),
      submit: btn ? text(btn) || (btn as HTMLInputElement).value || '' : '',
      fields: fs.map(x => ({ type: x.tagName === 'INPUT' ? (x as HTMLInputElement).type : x.tagName.toLowerCase(), name: nameOf(x as HTMLInputElement),
        required: (x as HTMLInputElement).required })) };
  };
  const all = deep(FIELD).filter(vis);
  const forms = deep('form').map(f => ({ f, fs: all.filter(x => f.contains(x)) })).filter(x => x.fs.length).map(x => formOf(x.f, x.fs));
  // form 밖 입력칸: 버튼이 있는 가장 가까운 영역(또는 랜드마크·fieldset)마다 묶는다. 전에는 body 하나로 묶어 헤더 검색칸과 상품 수량칸이 한 폼이 됐다(OpenCart, Codex 11/13).
  const BUTTON = 'button,input[type=submit],input[type=button],[role=button]';
  const boxOf = (x: Element) => {
    for (let e = light(x).parentElement; e && e !== document.body; e = e.parentElement)
      if (e.matches('form,fieldset,[role=search],[role=dialog],dialog,section,article,aside,header,nav,footer,main') || [...e.querySelectorAll(BUTTON)].some(vis)) return e;
    return document.body;
  };
  const boxes = new Map<Element, Element[]>();
  for (const x of all.filter(x => !light(x).closest('form') && !x.closest('form'))) boxes.set(boxOf(x), [...boxes.get(boxOf(x)) ?? [], x]);
  for (const [box, fs] of boxes) forms.push(formOf(box, fs));
  // 목록·카드·이미지 수는 데이터에 따라 달라 같은 화면도 다르게 보이므로 넣지 않는다. 입력칸은 로그인(몇 개)과 가입(많이)을 가르게 0·1-4·5+로 센다.
  const main = document.querySelector('main, [role=main]') ?? document.body;
  const count = (sel: string) => deep(sel).filter(e => main.contains(light(e)) && vis(e)).length;
  const has = (sel: string) => count(sel) ? 1 : 0;
  const fieldN = count(FIELD);
  const shape = `h1:${has('h1')} form:${has('form')} field:${fieldN === 0 ? '0' : fieldN < 5 ? '1-4' : '5+'} table:${has('table')} dialog:${has('dialog,[role=dialog]')}`;
  const search = deep('input[type=search], [role=search], [role=searchbox]').length > 0;
  const heading = text(deep('h1').find(vis) ?? deep('h2').find(vis) ?? null);
  return { forms, search, shape, title: document.title.trim().replace(/\s+/g, ' ').slice(0, 80), heading };
}, LAYOUT).catch(() => ({ forms: [], search: false, shape: '' }));

/** 한 페이지에서 열어 볼 메뉴 버튼 수 상한(크롤 시간). */
const MAX_TOGGLES = 6;
/**
 * 메뉴를 여는 버튼(aria-haspopup, 닫힌 aria-expanded)을 눌러 그 안에 나타난 링크를 모은다. 계정 메뉴 안의 로그인·회원가입처럼
 * 열어야만 생기는 링크를 놓쳐 폼 페이지가 사이트 지도에서 빠졌다(Maison 로컬 11/11: /login·/signup·/account가 계정 메뉴 안에만 있음).
 * 메뉴 열기는 이동·쓰기가 아니다. 쓰기 요청은 사이트 지도 컨텍스트가 막고, 누른 뒤 주소가 바뀌었으면 원래 페이지로 돌아간다.
 */
async function menuLinks(page: Page, url: string, timeoutMs: number): Promise<{ href: string; text: string; layout: boolean; region: string }[]> {
  const toggles = page.locator('button[aria-haspopup]:not([aria-haspopup="false"]), [role=button][aria-haspopup]:not([aria-haspopup="false"]), button[aria-expanded="false"], summary');
  const before = new Set((await anchors(page)).map(l => l.href));
  const out: { href: string; text: string; layout: boolean; region: string }[] = [];
  const n = Math.min(await toggles.count().catch(() => 0), MAX_TOGGLES);
  for (let i = 0; i < n; i++) {
    try {
      const t = toggles.nth(i);
      if (!(await t.isVisible())) continue;
      await t.click({ timeout: 2000 });
      await page.waitForTimeout(300);
      for (const l of await anchors(page)) if (!before.has(l.href)) { before.add(l.href); out.push(l); }
      await page.keyboard.press('Escape');
      if (pathOf(page.url()) !== pathOf(url)) { await page.goto(url, { timeout: timeoutMs * 3 }); await settle(page, timeoutMs); }
    } catch { /* 누를 수 없는 버튼은 건너뛴다 */ }
  }
  return out;
}

/**
 * 데스크톱 크기로 점검한 뒤 모바일 폭으로 바꿔 다시 점검하고 원래 크기로 돌린다. 원래 크기를 모르면 되돌릴 수 없어 모바일은 보지 않는다.
 * 이름 없는 요소는 데스크톱에서 센 역할을 모바일에서 다시 세지 않는다(모바일에서만 나타난 것만 더한다).
 */
async function audit(page: Page, timeoutMs: number): Promise<AuditFinding[]> {
  const size = page.viewportSize();
  const out = await auditPage(page, 'desktop');
  if (!size) return out;
  try {
    await page.setViewportSize(MOBILE);
    await settle(page, timeoutMs);
    out.push(...await auditPage(page, 'mobile', new Set(out.filter(f => f.kind === 'unnamed-control').map(f => f.target))));
  } finally {
    await page.setViewportSize(size);
    // 반응형 화면이 원래 크기로 다시 그려진 뒤 링크를 모은다.
    await settle(page, timeoutMs);
  }
  return out;
}
