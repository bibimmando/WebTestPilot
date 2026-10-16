// ① 사이트 지도 (AI 없음). 시작 URL에서 같은 origin 링크를 GET으로만 따라가며 페이지를 모으고, URL 모양으로 템플릿을 묶는다.
// 템플릿은 대화를 나누고 보고서의 범위를 표시하는 단위다. "사이트 전체"라고 주장하지 않도록 방문하지 못한 링크도 남긴다.
import type { Page } from 'playwright';
import { settle, type Policy } from './browser.ts';

export type Template = { key: string; pages: string[] };
/** failed: 이동에 실패한 URL. 템플릿은 URL 모양으로 묶은 잠정 분류다(구조 비교 없음). */
export type SiteMap = { templates: Template[]; visited: string[]; unvisited: string[]; failed: string[] };

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
export async function crawl(page: Page, startUrl: string, policy: Policy, o: { maxPages: number; perTemplate: number; timeoutMs: number }): Promise<SiteMap> {
  const clean = (u: string) => { const x = new URL(u); x.hash = ''; return x.href; };
  const queue = [clean(startUrl)];
  const known = new Set(queue);
  const visited: string[] = [];
  const failed: string[] = [];
  // 실패한 이동도 한도에 센다. 실패하는 URL이 많아도 시도 수와 발견 수가 끝없이 늘지 않게 한다.
  const maxAttempts = o.maxPages * 2, maxKnown = o.maxPages * 10;
  let attempts = 0;
  while (queue.length && visited.length < o.maxPages && attempts < maxAttempts) {
    const url = queue.shift()!;
    // 이미 방문한 페이지들과 함께 다시 묶어 같은 템플릿의 방문 수를 센다(묶음이 나중에 생겨도 앞선 방문을 놓치지 않는다).
    const group = groupTemplates([...visited, url]).find(t => t.pages.includes(url))!;
    if (group.pages.filter(p => visited.includes(p)).length >= o.perTemplate) continue;
    attempts++;
    try {
      await page.goto(url, { timeout: o.timeoutMs * 3 });
      await settle(page, o.timeoutMs);
    } catch { failed.push(url); continue; }
    visited.push(url);
    const links = await page.locator('a[href]').evaluateAll(as => as.map(a => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
    for (const l of links) {
      let u: string;
      try { u = clean(l); } catch { continue; }
      if (!policy.origins.includes(new URL(u).origin) || known.has(u) || known.size >= maxKnown) continue;
      known.add(u);
      queue.push(u);
    }
  }
  const all = [...known];
  return { templates: groupTemplates(all), visited, failed, unvisited: all.filter(u => !visited.includes(u)) };
}
