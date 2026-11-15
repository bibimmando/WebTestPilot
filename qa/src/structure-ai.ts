// 사이트 구조 AI 검토(선택 기능, --ai-structure). 규칙이 만든 페이지 종류·중심 노드 중 애매한 것만 코드가 질문으로 만들고,
// AI는 정해진 선택지로 답한다. 근거 인용이 입력에 그대로 없으면 그 답은 쓰지 않는다(규칙 판정 유지).
// 규칙 판정과 AI 판정을 모두 SiteMap.structureReview에 남긴다. 판정·버그 등급에는 관여하지 않는다.
// 오프라인 실험(11/13, 개발 사이트 14곳·질문 104개): 규칙만 75%, 규칙+AI 95%(정답표는 Claude가 만들었고 사람 검토 전).
import { readFileSync } from 'node:fs';
import { runAgent, type Budget, type Send, type Tool } from './agent.ts';
import { pathOf, type SiteMap, type Template } from './sitemap.ts';
import { siteStructure, type TemplateInfo } from './structure.ts';

const SYSTEM = readFileSync(new URL('../prompts/structure.md', import.meta.url), 'utf8');

/** A: 한 종류로 묶은 방문 페이지가 같은 기능인가(규칙 same), B: 비슷한 두 종류가 같은 화면인가(규칙 different), C: 중심 노드인가(규칙 hub) */
export type StructureQuestion = { id: string; kind: 'A' | 'B' | 'C'; text: string; rule: 'same' | 'different' | 'hub'; refs: string[] };
export type StructureReview = { model: string; questions: (Omit<StructureQuestion, 'text'> & { decision: string; evidence: string[]; reason?: string; quoteOk: boolean; applied: boolean })[]; costUsd: number; stop: string };

const MAX_PAIRS = 6, MAX_HUBS = 6;

/** 사이트 구조 요약(종류 그래프)과 후보 질문. 방문한 페이지의 제목·h1·본문 링크만 쓴다(사이트를 다시 열지 않는다). */
export function structureQuestions(map: SiteMap, startUrl: string): { summary: string; questions: StructureQuestion[] } {
  const structure = map.structure ?? {};
  const st = siteStructure(map, startUrl);
  const origin = new URL(startUrl).origin;
  const short = (u: string) => u.replace(origin, '') || '/';
  const label = new Map(st.templates.map((t, i) => [t.key, `K${i + 1}`]));
  const pageLine = (p: string) => { const s = structure[p]; return `${short(p)} — 제목 "${s.title ?? ''}", h1 "${s.heading ?? ''}", 본문 링크 ${s.links.filter(l => !l.layout).length}개`; };
  // 본문 링크 글자 표본: 앞에서부터 자르면 한 영역(사이드 분류 메뉴)이 다 차지했다. 영역마다 돌아가며 고르게 뽑는다.
  const sample = (p: string, n = 15) => {
    const by = new Map<string, string[]>();
    for (const l of structure[p].links.filter(l => !l.layout && l.text)) by.set(l.region ?? '', [...(by.get(l.region ?? '') ?? []), l.text]);
    const lists = [...by.values()], got: string[] = [];
    for (let i = 0; got.length < n && lists.some(x => x.length > i); i++) for (const x of lists) if (x[i] !== undefined && got.length < n) got.push(x[i]);
    return got.join(' · ');
  };
  const outsOf = (t: TemplateInfo) => t.out.map(o => `${label.get(o.to)}(${o.list ? `목록 ${o.pages}` : o.pages})`).join(', ') || '없음';
  const visitedT = st.templates.filter(t => t.visited.length && structure[t.visited[0]]);
  const lines = visitedT.map(t => {
    const s = structure[t.visited[0]];
    const forms = t.forms.map(fm => `폼(${fm.fields.map(x => x.name || x.type).slice(0, 6).join(', ')}${fm.submit ? ` → "${fm.submit}"` : ''})`).join(' ');
    const outs = t.out.map(o => `${label.get(o.to)}${o.list ? `(목록 ${o.pages})` : `(${o.pages})`}${st.templates.find(x => x.key === o.to)?.visited.length ? '' : '[미방문]'}`).join(', ');
    return `${label.get(t.key)} ${short(t.key)} [방문 ${t.visited.length}/발견 ${t.pages.length}] 제목 "${s.title ?? ''}", h1 "${s.heading ?? ''}"${forms ? `; ${forms}` : ''}${outs ? `; 본문 링크 → ${outs}` : ''}`;
  });
  const commonTexts = [...new Set(Object.values(structure).flatMap(s => s.links.filter(l => l.layout).map(l => l.text)).filter(Boolean))].slice(0, 25);
  const summary = [`사이트 ${origin} (방문 ${map.visited.length}, 종류 ${st.templates.length}, 방문한 종류 ${visitedT.length})`,
    `공통 영역 링크 글자(일부): ${commonTexts.join(' · ')}`, ...lines].join('\n');

  const qs: StructureQuestion[] = [];
  for (const t of visitedT.filter(t => t.visited.length >= 2))
    qs.push({ id: `A${qs.length + 1}`, kind: 'A', rule: 'same', refs: t.visited,
      text: `${label.get(t.key)} ${short(t.key)}로 묶인 방문 페이지들이 같은 기능의 화면(데이터만 다름)인가?\n${t.visited.map(p => `- ${pageLine(p)}; 본문 링크 글자: ${sample(p, 8)}`).join('\n')}` });
  // B 후보: 골격이 같고, 제목·h1이 같거나 본문 링크 목적지가 많이 겹치는 두 종류.
  const outSet = (t: TemplateInfo) => new Set(t.out.map(o => o.to));
  const pairs: [TemplateInfo, TemplateInfo][] = [];
  for (let i = 0; i < visitedT.length; i++) for (let k = i + 1; k < visitedT.length; k++) {
    const a = visitedT[i], b = visitedT[k], sa = structure[a.visited[0]], sb = structure[b.visited[0]];
    const oa = outSet(a), ob = outSet(b), inter = [...oa].filter(x => ob.has(x)).length, uni = new Set([...oa, ...ob]).size;
    const sameText = (sa.heading && sa.heading === sb.heading) || (sa.title && sa.title === sb.title && (sa.heading ?? '') === (sb.heading ?? ''));
    if (sa.shape === sb.shape && (sameText || (uni >= 2 && inter / uni >= 0.6))) pairs.push([a, b]);
  }
  for (const [a, b] of pairs.slice(0, MAX_PAIRS))
    qs.push({ id: `B${qs.length + 1}`, kind: 'B', rule: 'different', refs: [a.key, b.key],
      text: `${label.get(a.key)}와 ${label.get(b.key)}는 같은 화면(주소만 다른 별칭이거나 같은 기능)인가?\n- ${pageLine(a.visited[0])}; 종류 단위 본문 링크 → ${outsOf(a)}\n- ${pageLine(b.visited[0])}; 종류 단위 본문 링크 → ${outsOf(b)}\n- 본문 링크 목적지 종류 겹침: ${[...outSet(a)].filter(x => outSet(b).has(x)).length} / ${new Set([...outSet(a), ...outSet(b)]).size}` });
  for (const t of visitedT.filter(t => t.hub).slice(0, MAX_HUBS))
    qs.push({ id: `C${qs.length + 1}`, kind: 'C', rule: 'hub', refs: [t.key],
      text: `${label.get(t.key)} ${short(t.key)}는 중심 노드(그 페이지 고유의 목록·하위 페이지로 가는 본문 링크를 가진 페이지)인가? 공통 메뉴 링크만 있는 페이지라면 아니다.\n- ${pageLine(t.visited[0])}\n- 종류 단위 본문 링크 → ${outsOf(t)}\n- 본문 링크 글자(영역별 표본): ${sample(t.visited[0])}` });
  return { summary, questions: qs };
}

/** 사용자 메시지(실험 스크립트와 같은 형식) */
export const structureMessage = (summary: string, qs: { id: string; kind: string; text: string }[]) =>
  `[사이트 구조 요약]\n${summary}\n\n[질문]\n${qs.map(q => `${q.id} (${q.kind}) ${q.text}`).join('\n\n')}`;

/**
 * 근거 인용 검사: 구절마다 입력에 그대로 있어야 한다(공백만 정규화). 구절을 한 문자열로 이어 받으면 입력 안의 "/"(주소, "3 / 3")와
 * 구분자가 섞여 맞는 인용도 실패했다(11/13 새 사이트 5건). 그래서 구절을 배열로 받는다.
 */
export function quoteOk(evidence: string[], input: string): boolean {
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
  const parts = evidence.map(norm).filter(x => x.length >= 2);
  return parts.length > 0 && parts.every(x => norm(input).includes(x));
}

/**
 * AI 판정을 사이트 지도에 반영한다(규칙과 다르고 근거가 확인된 답만).
 * A different → 방문 페이지마다 자기 종류로 뗀다(방문하지 않은 페이지는 원래 종류에 남는다). B same → 두 종류를 합친다. C not_hub → 중심 노드에서 뺀다.
 */
export function applyReview(map: SiteMap, review: StructureReview): SiteMap {
  let templates: Template[] = map.templates.map(t => ({ ...t, pages: [...t.pages] }));
  const hubOverride = { ...map.hubOverride };
  for (const q of review.questions) {
    if (!q.quoteOk || q.decision === 'unknown' || q.decision === q.rule) continue;
    if (q.kind === 'A' && q.decision === 'different') {
      const t = templates.find(x => q.refs.every(p => x.pages.includes(p)));
      if (!t) continue;
      const own = q.refs.slice(1);
      t.pages = t.pages.filter(p => !own.includes(p));
      templates.push(...own.map(p => ({ key: pathOf(p, map.scheme), pages: [p] })));
      q.applied = true;
    } else if (q.kind === 'B' && q.decision === 'same') {
      const a = templates.find(x => x.key === q.refs[0]), b = templates.find(x => x.key === q.refs[1]);
      if (!a || !b || a === b) continue;
      a.pages.push(...b.pages);
      templates = templates.filter(x => x !== b);
      q.applied = true;
    } else if (q.kind === 'C' && q.decision === 'not_hub') {
      hubOverride[q.refs[0]] = false;
      q.applied = true;
    }
  }
  return { ...map, templates, ...(Object.keys(hubOverride).length ? { hubOverride } : {}), structureReview: review };
}

/** 질문을 만들어 AI에 한 번 묻고, 확인된 답을 반영한 사이트 지도를 돌려준다. 질문이 없으면 그대로. 실패해도 규칙 결과를 쓴다. */
export async function reviewStructure(o: { map: SiteMap; startUrl: string; send: Send; model: string; budget: Budget }): Promise<SiteMap> {
  const { summary, questions } = structureQuestions(o.map, o.startUrl);
  if (!questions.length) return o.map;
  const user = structureMessage(summary, questions);
  let answers: { id: string; decision: string; evidence: string[] | string; reason?: string }[] | undefined;
  const tool: Tool = {
    def: { name: 'answer', description: '모든 질문의 판정', input_schema: { type: 'object', required: ['answers'], properties: {
      answers: { type: 'array', items: { type: 'object', required: ['id', 'decision', 'evidence'], properties: {
        id: { type: 'string' }, decision: { type: 'string', enum: ['same', 'different', 'hub', 'not_hub', 'unknown'] },
        evidence: { type: 'array', items: { type: 'string' }, description: '입력에서 그대로 복사한 짧은 구절들(항목 하나에 구절 하나)' }, reason: { type: 'string' } } } } } } },
    run: async (input: { answers: typeof answers }) => { answers = input.answers ?? []; return { text: '받았습니다.', done: true }; },
  };
  const r = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools: [tool], user, budget: o.budget, maxTurns: 2, maxTokens: 4000, effort: 'high', nudge: true })
    .catch(e => ({ stop: 'error' as const, detail: String((e as Error).message), turns: [] as { cost?: number }[] }));
  const review: StructureReview = { model: o.model, stop: answers ? 'done' : r.stop, costUsd: r.turns.reduce((a, t) => a + (t.cost ?? 0), 0),
    questions: questions.map(q => {
      const a = answers?.find(x => x.id === q.id);
      // 배열이 아닌 근거(문자열 하나)는 구절 하나로 본다.
      const evidence = !a ? [] : Array.isArray(a.evidence) ? a.evidence.map(String) : [String(a.evidence ?? '')];
      const ok = !!a && quoteOk(evidence, user);
      return { id: q.id, kind: q.kind, rule: q.rule, refs: q.refs, decision: ok ? a!.decision : 'unknown', evidence, ...(a?.reason ? { reason: a.reason } : {}), quoteOk: ok, applied: false };
    }) };
  return applyReview(o.map, review);
}
