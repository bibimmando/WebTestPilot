// ① 사이트 지도 (AI 없음). 시작 URL에서 같은 origin 링크를 GET으로만 따라가며 페이지를 모으고, URL 모양으로 템플릿을 묶는다.
// 템플릿은 대화를 나누고 보고서의 범위를 표시하는 단위다. "사이트 전체"라고 주장하지 않도록 방문하지 못한 링크도 남긴다.
import type { Page } from 'playwright';
import { auditPage, settle, MOBILE, type AuditFinding, type Policy } from './browser.ts';

export type Template = { key: string; pages: string[] };
/**
 * failed: 이동에 실패한 URL. 템플릿은 URL 모양으로 묶은 잠정 분류다(구조 비교 없음).
 * audit: 방문한 페이지의 품질·사용성 점검. confirmed = 화면이 안정된 상태에서 두 번(처음·새로 열어 다시) 모두 나온 것.
 * auditErrors: 점검하지 못한 페이지와 사유(미완료로 보고한다).
 */
export type SiteMap = { templates: Template[]; visited: string[]; unvisited: string[]; failed: string[];
  audit?: { url: string; findings: (AuditFinding & { confirmed: boolean })[] }[]; auditErrors?: string[] };

/** 쿼리·hash를 뺀 경로. 같은 경로의 다른 쿼리(정렬·필터)는 같은 페이지 종류로 본다. */
export const pathOf = (url: string) => { const u = new URL(url); return u.origin + (u.pathname.replace(/\/+$/, '') || '/'); };

/**
 * URL을 템플릿으로 묶는다. 같은 상위 경로 아래 마지막 경로 조각만 다른 페이지가 둘 이상이면 한 템플릿(`/product/:x`)이다.
 * shortcut: URL 모양만 본다. 같은 상위 경로의 서로 다른 안내 페이지(/info/faq, /info/returns)도 묶이고, 구조 지문 비교는 없다.
 */
export function groupTemplates(urls: string[]): Template[] {
  const byParent = new Map<string, Set<string>>();
  for (const u of urls) {
    const p = pathOf(u);
    const parent = p.slice(0, p.lastIndexOf('/'));
    if (!byParent.has(parent)) byParent.set(parent, new Set());
    byParent.get(parent)!.add(p);
  }
  const templates = new Map<string, string[]>();
  for (const u of urls) {
    const p = pathOf(u);
    const parent = p.slice(0, p.lastIndexOf('/'));
    // 최상위 경로(/products, /cart)는 서로 다른 기능이므로 묶지 않는다.
    const key = byParent.get(parent)!.size > 1 && new URL(p).pathname.split('/').length > 2 ? `${parent}/:x` : p;
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
  const clean = (u: string) => { const x = new URL(u); x.hash = ''; return x.href; };
  const queue = [clean(startUrl)];
  const known = new Set(queue);
  const visited: string[] = [];
  const failed: string[] = [];
  const found = new Map<string, { findings: AuditFinding[]; ready: boolean }>();
  const auditErrors: string[] = [];
  // 실패한 이동도 한도에 센다. 실패하는 URL이 많아도 시도 수와 발견 수가 끝없이 늘지 않게 한다.
  const maxAttempts = o.maxPages * 2, maxKnown = o.maxPages * 10;
  let attempts = 0;
  while (queue.length && visited.length < o.maxPages && attempts < maxAttempts) {
    const url = queue.shift()!;
    // 이미 방문한 페이지들과 함께 다시 묶어 같은 템플릿의 방문 수를 센다(묶음이 나중에 생겨도 앞선 방문을 놓치지 않는다).
    const group = groupTemplates([...visited, url]).find(t => t.pages.includes(url))!;
    if (group.pages.filter(p => visited.includes(p)).length >= o.perTemplate) continue;
    attempts++;
    let ready = false;
    try {
      await page.goto(url, { timeout: o.timeoutMs * 3 });
      ready = await settle(page, o.timeoutMs);
    } catch { failed.push(url); continue; }
    visited.push(url);
    // 점검은 덧붙인 기능이다. 실패해도 사이트 지도 수집은 계속하고 그 페이지를 점검 미완료로 남긴다.
    if (o.audit) {
      try { found.set(url, { findings: await audit(page, o.timeoutMs), ready }); }
      catch (e) { auditErrors.push(`${url}: ${String((e as Error)?.message ?? e).split('\n')[0]}`); }
    }
    const links = await page.locator('a[href]').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
    for (const l of links) {
      let u: string;
      try { u = clean(l); } catch { continue; }
      if (!policy.origins.includes(new URL(u).origin) || policy.deny?.some(d => u.includes(d)) || known.has(u) || known.size >= maxKnown) continue;
      known.add(u);
      queue.push(u);
    }
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
  return { templates: groupTemplates(all), visited, failed, unvisited: all.filter(u => !visited.includes(u)),
    ...(o.audit ? { audit: auditResult, ...(auditErrors.length ? { auditErrors } : {}) } : {}) };
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
