// 사이트 구조 요약 (AI 없음). 사이트 지도의 페이지별 구조 정보로 페이지 종류 사이의 본문 링크 그래프를 만들고,
// 중심 노드(여러 하위 종류로 뻗거나 목록을 가진 종류)와 그 아래 종류를 묶음으로 나눈다. 묶음은 병렬 탐색 세션의 단위 후보다.
import type { PageInfo, SiteMap, UrlScheme } from './sitemap.ts';

export type TemplateInfo = { key: string; pages: string[]; visited: string[];
  /** 방문한 페이지들의 화면 골격. 둘 이상이면 mixed(URL 모양은 같은데 화면이 다름 → 잘못 묶였을 수 있음) */
  shapes: string[]; mixed: boolean; search: boolean;
  /** 이 종류만의 폼. 공통 영역 안이거나 여러 페이지에 똑같이 나오는 폼(푸터 뉴스레터·헤더 검색)은 commonForms로 뺀다 */
  forms: PageInfo['forms']; api: string[];
  /** 본문 링크로 이어지는 다른 종류. pages = 그 종류로 가는 서로 다른 주소 수, list = 한 페이지에 3개 이상(목록) */
  out: { to: string; pages: number; list: boolean }[];
  /** 공통 영역(헤더·메뉴·푸터) 링크로만 닿는 종류 */
  layoutOnly: boolean; hub: boolean };
/** hub = 묶음을 연 중심 노드. 빈 문자열이면 메뉴로만 가는 단독 페이지를 모은 묶음 */
export type Cluster = { hub: string; templates: string[] };
export type SiteStructure = { scheme?: UrlScheme; templates: TemplateInfo[]; clusters: Cluster[]; layoutLinks: string[]; commonForms: PageInfo['forms'] };

/** 방문한 페이지 중 이 비율 이상(최소 3페이지)에 나온 링크는 공통 영역 표시가 없어도 공통 링크로 본다. */
const COMMON = 0.6;
const LIST = 3;

export function siteStructure(map: SiteMap, startUrl: string, maxPerCluster = 3): SiteStructure {
  const st = map.structure ?? {};
  const tOf = new Map(map.templates.flatMap(t => t.pages.map(p => [p, t.key] as const)));
  const pages = Object.keys(st);
  // 공통 링크는 (목적지, 놓인 영역) 쌍이 여러 페이지에 반복되는 것이다. 목적지만 세면 홈 본문 목차의 링크도 사이드 메뉴와 목적지가 같아
  // 지워져 중심 노드가 0개가 됐다(Test Pages, Codex 11/13). 랜드마크 안이라도 그 페이지에만 있는 링크(섹션별 목차)는 본문으로 본다.
  type Link = PageInfo['links'][number];
  const pair = (l: Link) => `${l.to}|${l.region ?? ''}`;
  const seenOn = new Map<string, number>();
  for (const p of pages) for (const k of new Set(st[p].links.map(pair))) seenOn.set(k, (seenOn.get(k) ?? 0) + 1);
  const many = (n: number) => pages.length >= 3 && n >= Math.max(3, pages.length * COMMON);
  const repeated = (l: Link) => many(seenOn.get(pair(l)) ?? 0);
  // 공통 영역 안 링크는 목적지가 페이지마다 달라도 공통이다(현재 주소를 담은 헤더 로그인 링크가 본문으로 바뀌어 안내 문서가 가짜 중심 노드가 됐다,
  // Test Store, Codex 2차 11/13). 그래서 링크 쌍이 아니라 영역 자체가 여러 페이지에 반복되는지를 본다. 그 페이지에만 있는 랜드마크(섹션별 목차)는 본문이다.
  const regionOn = new Map<string, number>();
  for (const p of pages) for (const r of new Set(st[p].links.filter(l => l.layout && l.region).map(l => l.region!))) regionOn.set(r, (regionOn.get(r) ?? 0) + 1);
  const isLayout = (l: Link) => repeated(l) || (l.layout && (l.region === undefined || pages.length < 3 || many(regionOn.get(l.region) ?? 0)));
  const formKey = (f: PageInfo['forms'][number]) => `${f.action}|${f.fields.map(x => `${x.type}:${x.name}`).join()}`;
  const formOn = new Map<string, number>();
  for (const p of pages) for (const k of new Set(st[p].forms.map(formKey))) formOn.set(k, (formOn.get(k) ?? 0) + 1);
  const commonForm = (f: PageInfo['forms'][number]) => f.layout || (pages.length >= 3 && formOn.get(formKey(f))! >= Math.max(3, pages.length * COMMON));
  const commonForms = pages.flatMap(p => st[p].forms).filter(commonForm).filter((f, i, a) => a.findIndex(g => formKey(g) === formKey(f)) === i);
  const layoutLinks = [...new Set(pages.flatMap(p => st[p].links.filter(isLayout).map(l => l.to)))];

  const contentIn = new Set<string>(), anyIn = new Set<string>();
  const infos: TemplateInfo[] = map.templates.map(t => {
    const visited = t.pages.filter(p => st[p]);
    const targets = new Map<string, { urls: Set<string>; list: boolean }>();
    for (const p of visited) {
      const perPage = new Map<string, number>();
      for (const l of st[p].links) {
        const to = tOf.get(l.to);
        if (!to || to === t.key) continue;
        anyIn.add(to);
        if (isLayout(l)) continue;
        contentIn.add(to);
        const x = targets.get(to) ?? { urls: new Set(), list: false };
        x.urls.add(l.to);
        targets.set(to, x);
        perPage.set(to, (perPage.get(to) ?? 0) + 1);
      }
      for (const [to, n] of perPage) if (n >= LIST) targets.get(to)!.list = true;
    }
    const out = [...targets].map(([to, x]) => ({ to, pages: x.urls.size, list: x.list }));
    const shapes = [...new Set(visited.map(p => st[p].shape).filter(Boolean))];
    const forms = visited.flatMap(p => st[p].forms).filter(f => !commonForm(f)).filter((f, i, a) => a.findIndex(g => formKey(g) === formKey(f)) === i);
    return { key: t.key, pages: t.pages, visited, shapes, mixed: shapes.length > 1, search: visited.some(p => st[p].search), forms,
      api: [...new Set(visited.flatMap(p => st[p].api))].sort(), out, layoutOnly: false, hub: map.hubOverride?.[t.key] ?? (out.length >= 2 || out.some(o => o.list)) };
  });
  for (const t of infos) t.layoutOnly = anyIn.has(t.key) && !contentIn.has(t.key);

  // 시작 종류부터 본문 링크로 너비 우선 탐색해 부모를 정한다. 본문 링크로 닿지 않는 종류(메뉴로만 가는 섹션)는 그 자리에서 새 뿌리다.
  const byKey = new Map(infos.map(t => [t.key, t]));
  const start = tOf.get(startUrl) ?? infos[0]?.key;
  const owner = new Map<string, string>();
  for (const root of [start, ...infos.map(t => t.key)]) {
    if (!root || owner.has(root)) continue;
    owner.set(root, root);
    const queue = [root];
    while (queue.length) {
      const k = queue.shift()!;
      for (const o of byKey.get(k)?.out ?? []) {
        if (owner.has(o.to)) continue;
        // 중심 노드면 자기 묶음을 열고, 아니면 부모의 묶음에 든다.
        owner.set(o.to, byKey.get(o.to)!.hub ? o.to : owner.get(k)!);
        queue.push(o.to);
      }
    }
  }
  // 너비 우선은 먼저 닿은 부모에 붙여, 상품 상세가 상품 목록(링크 13개)이 아니라 홈(링크 4개)에 붙었다(Maison 11/12).
  // 중심 노드가 아닌 종류는 그 종류로 가는 본문 링크를 가진 중심 노드 중 목록이 있고 링크가 가장 많은 쪽에 붙인다.
  for (const t of infos) {
    if (t.hub || owner.get(t.key) === t.key) continue;
    const best = infos.filter(h => h.hub).flatMap(h => h.out.filter(o => o.to === t.key).map(o => ({ h: h.key, score: (o.list ? 1000 : 0) + o.pages })))
      .sort((a, b) => b.score - a.score)[0];
    if (best) owner.set(t.key, owner.get(best.h) === best.h ? best.h : owner.get(best.h)!);
  }
  const groups = new Map<string, string[]>();
  for (const t of infos) groups.set(owner.get(t.key)!, [...(groups.get(owner.get(t.key)!) ?? []), t.key]);
  // 중심 노드가 아닌 뿌리 하나짜리 묶음(메뉴로만 가는 단독 페이지)은 세션 하나를 다 쓰기엔 작아 정한 크기로 모은다.
  // 같은 첫 경로 조각(/info, /info/:x)은 한 묶음에 넣고, 넘치면 그때 나눈다.
  const clusters: Cluster[] = [], singles: string[] = [];
  for (const [hub, ks] of groups) {
    if (ks.length === 1 && !byKey.get(hub)!.hub && hub !== start) { singles.push(hub); continue; }
    const ordered = [hub, ...ks.filter(k => k !== hub)];
    for (let i = 0; i < ordered.length; i += maxPerCluster) clusters.push({ hub, templates: ordered.slice(i, i + maxPerCluster) });
  }
  const first = (k: string) => { const u = new URL(k); return u.pathname.split('/')[1] + (u.hash.split('/')[1] ?? ''); };
  const bySeg = new Map<string, string[]>();
  for (const k of singles.sort()) bySeg.set(first(k), [...(bySeg.get(first(k)) ?? []), k]);
  let bin: string[] = [];
  for (const g of [...bySeg.values()].sort((a, b) => b.length - a.length)) {
    if (bin.length && bin.length + g.length > maxPerCluster) { clusters.push({ hub: '', templates: bin }); bin = []; }
    for (const k of g) { bin.push(k); if (bin.length === maxPerCluster) { clusters.push({ hub: '', templates: bin }); bin = []; } }
  }
  if (bin.length) clusters.push({ hub: '', templates: bin });
  return { scheme: map.scheme, templates: infos, clusters, layoutLinks, commonForms };
}
