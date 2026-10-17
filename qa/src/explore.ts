// ① 탐색·계획. 모델은 ref로 페이지를 보고 행동하며, pin으로 대상을 고정한 뒤 submit_plan으로 계획을 낸다.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { openContext, snapshot, resolveRef, resolveGroup, resolveText, resolvePosition, settle, stableOnReload, type Policy } from './browser.ts';
import { validate, freeze, mergePlans, cloneScenarios, startTargetsElsewhere, READS, COMPARES, type Draft, type Pinned, type Plan, type Question, type Requirement } from './plan.ts';
import { rulesText } from './rules.ts';
import { crawl, pathOf, type SiteMap, type Template } from './sitemap.ts';
import { runAgent, type AgentResult, type Budget, type Send, type Tool, type ToolOutcome } from './agent.ts';

export const SYSTEM = readFileSync(new URL('../prompts/explore.md', import.meta.url), 'utf8');
const SNAPSHOT_CHARS = 24_000;
const ACTION_TIMEOUT = 5_000;
const SETTLE_TIMEOUT = 3_000;
const MAX_QUESTIONS = 5;
const MAX_START_CHECKS = 20;
// 정체 종료(설계 5장 2단계): 화면이 바뀌지 않는 행동이 이어지면 먼저 제출을 재촉하고, 더 이어지면 대화를 끝낸다.
// 비활성 버튼·이미 선택된 탭처럼 변화 없는 행동도 정상 검사라 몇 번은 허용한다. shortcut: 값은 실측 전 임시값이다.
const STALL_WARN = 5;
const STALL_END = 8;

/**
 * conversations: 발견한 모든 템플릿의 상태(계획함 · 계획 없이 끝남 · 시도 안 함과 사유). complete = 모든 템플릿을 계획함.
 * exploredUrls: AI 탐색 중 실제로 머문 URL(사이트 지도에 없던 페이지 포함).
 */
export type ExploreResult = AgentResult & { plan?: Plan; blocked: string[]; violations: string[]; sitemap?: SiteMap; complete: boolean;
  exploredUrls: string[];
  conversations: { template: string; url: string; stop: AgentResult['stop'] | 'not_attempted'; detail?: string; turns: number; planned: boolean }[] };
/** 템플릿별 대화가 함께 쓰는 번호·기록. 도구는 대화마다 새로 만들어 이전 대화의 대상·인용·행동 상태가 새지 않게 한다. */
export type Part = { taken: Set<string>; next: { T: number; Q: number }; questions: Question[]; urls: Set<string> };
type Task = { policy: Policy; startUrl: string; requirements: Requirement[] };
/** 템플릿별 대화의 범위: 사이트 지도 요약, 이번 템플릿, 이어 쓸 ID 번호 */
/** retry: 같은 템플릿의 앞선 대화가 턴 한도로 계획 없이 끝났을 때 그 대화의 턴 수 */
export type Scope = { map: SiteMap; template: Template; url: string; nextScenario: number; nextFeature: number; retry?: number };

/**
 * 사이트 지도를 만든 뒤 템플릿마다 새 대화로 탐색·계획하고, 계획을 하나로 합친다(설계 5장 1·2단계, M3 2차).
 * 대상(T#)·질문(Q#)·정책 위반은 대화 사이에 공유하고 S#·F#는 이어 쓴다(동시 실행이면 대화마다 번호 구간). 템플릿이 하나면 대화 하나다.
 * concurrency: 동시에 여는 템플릿 대화 수(기본 1). 대화끼리 브라우저 상태를 공유하지 않으므로 흐름은 한 대화 안에서 끝난다.
 * shortcut: 템플릿마다 대표 페이지 하나만 탐색한다(기준 실행). 같은 템플릿 다른 페이지 실행(C4)은 팀 확인 뒤.
 */
export async function explore(o: Task & { browser: Browser; send: Send; model: string; budget: Budget; maxTurns: number;
  maxPages?: number; maxTemplates?: number; turnsPerTemplate?: number; pagesPerTemplate?: number; concurrency?: number;
  /** 이만큼은 분류·재현 몫으로 남기고, 남은 예산이 이보다 적으면 새 대화를 시작하지 않는다 */
  keepUsd?: number;
  /** 이 시각(epoch ms)이 지나면 새 대화를 시작하지 않는다. 진행 중인 대화는 끝까지 둔다 */
  deadline?: number }): Promise<ExploreResult> {
  assertStartAllowed(o);
  // 탐색하는 동안에는 분류·재현 몫을 예약 하한으로 걸어, 진행 중인 대화도 그 몫을 쓰지 못하게 한다.
  const floor = o.budget.floorUsd;
  // 이미 걸린 하한보다 낮게 덮지 않는다(같은 장부를 쓰는 다른 단계의 하한을 지킨다).
  o.budget.floorUsd = Math.max(floor, o.keepUsd ?? 0);
  try { return await exploreSite(o); } finally { o.budget.floorUsd = floor; }
}

async function exploreSite(o: Parameters<typeof explore>[0]): Promise<ExploreResult> {
  // 사이트 지도는 쓰기 허용과 상관없이 읽기 전용으로 모은다. 페이지를 여는 것만으로 스크립트가 쓰기 요청을 보낼 수 있다.
  const reader = await openContext(o.browser, { ...o.policy, allowWrites: false });
  let map: SiteMap;
  try {
    map = await crawl(await reader.context.newPage(), o.startUrl, o.policy, { maxPages: o.maxPages ?? 30, perTemplate: 2, timeoutMs: SETTLE_TIMEOUT, audit: true });
  } finally {
    await reader.context.close();
  }
  const blocked = [...reader.blocked];
  const violations = reader.violations.map(v => `사이트 지도 수집 중 ${v}`);
  {
    // 시작 페이지의 템플릿을 먼저, 나머지는 발견 순서대로.
    const startKey = map.templates.find(t => t.pages.includes(new URL(o.startUrl).href))?.key;
    const ordered = [...map.templates].sort((a, b) => Number(b.key === startKey) - Number(a.key === startKey));
    const templates = ordered.slice(0, o.maxTemplates ?? 8);
    const single = templates.length <= 1;
    const concurrency = single ? 1 : Math.max(1, o.concurrency ?? 1);
    const part: Part = { taken: new Set(), next: { T: 1, Q: 1 }, questions: [], urls: new Set() };
    type Job = { template: Template; retryOf?: number };
    type Done = { job: Job; url: string; result: AgentResult };
    const done: Done[] = [];
    let stopped: string | undefined;
    let started = 0;
    const converse = async (job: Job): Promise<Done> => {
      const { template } = job;
      const index = started++;
      const url = template.key === startKey ? o.startUrl : map.visited.find(v => template.pages.includes(v)) ?? template.pages[0];
      // 대화마다 새 브라우저 상태(쿠키·저장소 없음)로 시작한다. 실행도 시나리오마다 빈 상태에서 시작하므로,
      // 앞 대화에서 담은 장바구니·위시리스트를 보고 계획하면 실행에서 시작 조건이 맞지 않는다(Maison 실측 2026-10-16).
      // 정책 위반 목록은 모든 대화가 함께 쓴다. 사이트 지도 수집과 지금까지(동시에 도는 대화 포함)의 위반이 계획 제출을 막는다.
      const guarded = await openContext(o.browser, o.policy, violations);
      try {
        const page = await guarded.context.newPage();
        await page.goto(url).catch(() => {});
        // 동시에 시작한 대화는 S#·F#를 앞 대화의 제출 전에 정하므로, 대화마다 100개씩 번호 구간을 나눈다.
        // 구간을 넘는 ID는 제출에서 거부한다(완료 순서에 따라 어느 대화가 거부될지 달라지지 않게).
        const next = (prefix: string) => concurrency > 1 ? index * 100 + 1
          : Math.max(0, ...[...part.taken].filter(id => id.startsWith(prefix)).map(id => Number(id.slice(1)))) + 1;
        const tools = exploreTools(page, o, violations, single ? undefined : part, concurrency > 1 ? [index * 100 + 1, index * 100 + 100] : undefined);
        const retry = job.retryOf === undefined ? undefined : done[job.retryOf].result.turns.length;
        const user = taskMessage(o, single ? undefined : { map, template, url, nextScenario: next('S'), nextFeature: next('F'), retry });
        const result = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools, user, budget: o.budget,
          maxTurns: single ? o.maxTurns : o.turnsPerTemplate ?? 25 });
        if (result.stop === 'budget') stopped = '예산 소진';
        return { job, url, result };
      } finally {
        blocked.push(...guarded.blocked);
        await guarded.context.close();
      }
    };
    // 템플릿 큐를 동시에 concurrency개씩 비운다. 예산이 떨어지면 새 대화를 시작하지 않는다.
    const drain = async (queue: Job[]) => {
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          // 한도에 닿으면 새 대화를 시작하지 않고 남은 템플릿을 미완료로 남긴다(설계 5장 0단계).
          stopped ??= o.deadline !== undefined && Date.now() > o.deadline ? '탐색 시간 한도'
            : o.keepUsd !== undefined && o.budget.limitUsd - o.budget.spent - o.budget.held < o.keepUsd ? '예산 한도(분류 몫 남김)' : undefined;
          if (stopped) { done.push({ job, url: job.template.pages[0], result: undefined! }); continue; }
          done.push(await converse(job));
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
    };
    await drain((single ? [{ key: startKey ?? o.startUrl, pages: [o.startUrl] }] : templates).map(template => ({ template })));
    // 큐 순환(설계 5장 2단계): 턴 한도로 계획 없이 끝난 템플릿은 첫 순회 뒤 새 대화로 한 번 더 시도한다.
    if (!single) await drain(done.flatMap((d, i) => d.result?.stop === 'max_turns' && !d.result.result ? [{ template: d.job.template, retryOf: i }] : []));
    // 결과는 시작 순서가 아니라 큐 순서(템플릿 순서, 재시도는 뒤)로 정렬해 동시 실행에서도 같은 순서로 합친다.
    const order = (d: Done) => (d.job.retryOf === undefined ? 0 : templates.length) + templates.indexOf(d.job.template);
    done.sort((a, b) => order(a) - order(b));
    const conversations: ExploreResult['conversations'] = done.map(({ job, url, result }) => result
      ? { template: job.template.key, url, stop: result.stop, ...(result.detail ? { detail: result.detail } : {}), turns: result.turns.length, planned: !!result.result }
      : { template: job.template.key, url, stop: 'not_attempted', detail: stopped, turns: 0, planned: false });
    const ran = done.filter(d => d.result);
    const plans = ran.flatMap(d => d.result.result ? [d.result.result as Plan] : []);
    const turns = ran.flatMap(d => d.result.turns);
    const last = ran.at(-1)?.result;

    for (const t of ordered.slice(templates.length)) conversations.push({ template: t.key, url: t.pages[0], stop: 'not_attempted', detail: `페이지 종류 수 한도(${templates.length})`, turns: 0, planned: false });
    // 실패한 대화의 질문도 버리지 않고 남긴다.
    const submitted = new Set(plans.flatMap(p => p.questions.map(q => q.id)));
    const questions = part.questions.map(q => submitted.has(q.id) || !q.feature ? q : (({ feature: _, ...rest }) => rest)(q));
    const merged = plans.length ? (single ? plans[0] : { ...mergePlans(plans, o.requirements), questions }) : undefined;
    const tainted = !!merged && violations.length > 0;
    const plan = tainted ? undefined : merged && cloneScenarios(merged, otherPages(merged, map, o.pagesPerTemplate ?? 3));
    // 한도 때문에 대화를 하나도 시작하지 못했으면 한도 사유로 끝난다.
    return { messages: [], ...last, stop: plan ? 'done' : tainted ? 'error' : last?.stop ?? 'budget',
      ...(tainted ? { detail: `정책 위반이 있어 계획을 버림: ${violations.join(', ')}` } : last ? {} : { detail: stopped }),
      turns, plan, blocked, violations, sitemap: map, conversations,
      complete: (single ? [{ key: startKey ?? o.startUrl }] : ordered).every(t => conversations.some(c => c.template === t.key && c.planned)), exploredUrls: [...part.urls] };
  }
}

/**
 * C4: 경로만 다른 페이지로 묶인 템플릿(`/product/:x`)에서 계획을 실행할 페이지 집합을 템플릿마다 정한다.
 * 대표(원래 시나리오의 시작 페이지)를 포함해 total개가 되도록 다른 페이지를 고르고(방문한 페이지 먼저), 그 템플릿의 모든 시나리오가 같은 페이지들을 쓴다.
 * 쿼리만 다른 페이지(정렬·필터)는 같은 화면의 다른 상태라 고르지 않는다.
 */
export function otherPages(plan: Plan, map: SiteMap, total: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of map.templates.filter(x => x.key.endsWith('/:x'))) {
    const scenarios = plan.scenarios.filter(s => !s.variantOf && t.pages.some(p => pathOf(p) === pathOf(s.start.url)));
    if (!scenarios.length) continue;
    const used = new Set(scenarios.map(s => pathOf(s.start.url)));
    const picks: string[] = [];
    for (const p of [...t.pages.filter(p => map.visited.includes(p)), ...t.pages.filter(p => !map.visited.includes(p))]) {
      if (used.size + picks.length >= total) break;
      if (used.has(pathOf(p)) || picks.some(x => pathOf(x) === pathOf(p))) continue;
      picks.push(p);
    }
    if (picks.length) for (const s of scenarios) out[s.id] = picks;
  }
  return out;
}

/** 시작 URL도 navigate와 같은 origin 정책을 따른다. */
export function assertStartAllowed(o: Task): void {
  if (!o.policy.origins.includes(new URL(o.startUrl).origin)) throw new Error(`시작 URL이 허용 origin 밖: ${o.startUrl}`);
}

/** 첫 사용자 메시지: 시작 URL, 권한, 요구사항. 템플릿별 대화면 사이트 지도 요약과 이번 대화의 범위를 함께 준다. */
export function taskMessage(o: Task, scope?: Scope): string {
  return [
    `시작 URL: ${scope?.url ?? o.startUrl}`,
    ...(scope ? [
      '사이트 지도 (페이지 종류별, 같은 종류는 대표 URL 하나로 다룸):',
      ...scope.map.templates.map(t => `- ${t.key} (발견 ${t.pages.length}개)${t.key === scope.template.key ? '  ← 이번 대화' : ''}`),
      '(페이지 종류는 URL 모양으로 묶은 잠정 분류입니다. 같은 종류로 묶였는데 기능이 다르면 observations에 적으세요.)',
      `이번 대화의 범위: 페이지 종류 ${scope.template.key}. 이 종류에서 시작하는 기능을 계획하세요. 행동의 결과가 다른 페이지에 나타나면(목록·모음·내 정보 화면 등) 같은 시나리오 안에서 그 페이지로 이동해 이어서 확인하세요. 다른 종류에서 시작하는 기능은 다른 대화에서 다룹니다. 이 종류와 관련 없는 요구사항은 계획하지도 unplanned에 적지도 마세요.`,
      `ID는 이어서 씁니다: 시나리오 S${scope.nextScenario}부터, 기능 F${scope.nextFeature}부터.`,
      ...(scope.retry === undefined ? [] : [`이 페이지 종류의 앞선 대화는 턴 ${scope.retry}개를 쓰고 계획 없이 끝났습니다. 핵심 기능부터 계획하고 일찍 제출하세요.`]),
    ] : []),
    `허용 origin: ${o.policy.origins.join(', ')} (쓰기 요청 ${o.policy.allowWrites ? '허용' : '차단'})`,
    ...(o.requirements.length
      ? ['요구사항 (먼저 계획하고, 남은 여유로 다른 기능도 탐색):', ...o.requirements.map(r => `- ${r.id}: ${r.text}`)]
      : ['요구사항: 없음. 사이트를 탐색해 기능을 찾고 검사하세요.']),
    '일반 규칙 목록 (inferred 근거로 인용할 수 있는 규칙):',
    rulesText(),
  ].join('\n');
}

/** 탐색 도구 전체. API 루프(explore)와 개발용 MCP 서버(mcp.ts)가 같은 도구를 쓴다. 계획이 통과하면 done에 Plan이 담긴다. */
/** idRange: 동시 실행에서 이 대화가 쓸 S#·F# 번호 구간 [처음, 끝]. */
export function exploreTools(page: Page, o: Task, violations: string[], part?: Part, idRange?: [number, number]): Tool[] {
  const pinned = new Map<string, Pinned>();
  // 탐색 중 본 snapshot 텍스트. constraint(화면 안내) 인용이 실제로 화면에 있었는지 확인한다.
  const seen: string[] = [];
  const questions: Question[] = [];
  const nextTarget = () => part ? `T${part.next.T++}` : `T${pinned.size + 1}`;
  return [...browserTools(page, o.policy, pinned, violations, seen, nextTarget, u => part?.urls.add(u)), {
    def: { name: 'ask_user', strict: true, description: '정답이 업무 규칙에 달려 있고 화면만으로 알 수 없을 때 사용자에게 질문을 남긴다. 답을 기다리지 말고 다른 기능을 계속 탐색한다.',
      input_schema: { type: 'object', additionalProperties: false, required: ['question', 'options'], properties: {
        question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: '선택지 2개 이상' },
        feature: { type: 'string', description: '이 질문에 걸린 기능 ID (F#). 계획의 features에 같은 ID로 적는다' } } } },
    run: async ({ question, options, feature }: { question: string; options: string[]; feature?: string }) => {
      if (!question.trim() || options.length < 2) return { text: '질문과 선택지 2개 이상이 필요합니다.', isError: true };
      const id = part ? `Q${part.next.Q++}` : `Q${questions.length + 1}`;
      // 상한을 넘은 질문도 버리지 않고 "규칙 미확인"으로 남긴다. 사용자에게 보내는 질문은 실행 전체에서 상한까지만이다.
      const overLimit = (part ? part.questions : questions).filter(q => !q.overLimit).length >= MAX_QUESTIONS;
      const q: Question = { id, page: page.url(), question, options, ...(feature ? { feature } : {}), ...(overLimit ? { overLimit } : {}) };
      questions.push(q);
      part?.questions.push(q);
      return { text: `${id}로 남겼습니다${overLimit ? ` (질문 한도 ${MAX_QUESTIONS}개를 넘어 사용자에게 묻지 않고 "규칙 미확인"으로 기록)` : ''}. 답은 이번 실행 중에 오지 않습니다. 이 규칙에 의존하는 기대값은 쓰지 말고 다른 기능을 계속 탐색하세요.` };
    },
  }, {
    def: { name: 'submit_plan', description: '완성한 테스트 계획을 제출한다. 오류가 있으면 오류 목록이 돌아온다.', input_schema: DRAFT_SCHEMA },
    run: async (draft: Draft) => {
      if (violations.length) return { text: `정책 위반이 있어 계획을 받을 수 없다: ${violations.join(', ')}`, isError: true };
      if (idRange) {
        const out = [...(draft.scenarios ?? []).map(s => s.id), ...(draft.features ?? []).map(f => f.id)]
          .filter(id => { const n = Number(String(id).slice(1)); return !(n >= idRange[0] && n <= idRange[1]); });
        if (out.length) return { text: `ID는 S${idRange[0]}~S${idRange[1]}, F${idRange[0]}~F${idRange[1]} 안에서 쓰세요: ${out.join(', ')}`, isError: true };
      }
      // 복제 표식은 하네스만 붙인다.
      if ((draft.scenarios ?? []).some(x => (x as { variantOf?: unknown }).variantOf !== undefined)) return { text: 'variantOf는 계획에 쓸 수 없다', isError: true };
      let errors: string[];
      const check = (onStart?: Set<string>) => validate(draft, o.requirements, pinned, o.policy.origins, seen.join('\n'), onStart, part);
      try { errors = check(); } catch (e) {
        return { text: `계획 형식 오류: ${(e as Error).message}`, isError: true };
      }
      // 다른 페이지에서 pin한 시작 상태 대상은 시작 URL을 새로 열어 실제로 있는지 확인한다(같은 템플릿의 다른 쿼리 등).
      // 다른 오류가 없을 때만 연다. 그룹은 다른 목록과 섞여도 "하나 이상"으로 통과하므로 제외해 시작 페이지 pin을 요구한다.
      const onStart = new Set<string>();
      if (errors.length && errors.every(e => e.includes('not on the start page'))) {
        for (const { id, url } of startTargetsElsewhere(draft, pinned).slice(0, MAX_START_CHECKS)) {
          const p = pinned.get(id)!;
          const ok = !p.group && o.policy.origins.includes(new URL(url).origin)
            && await stableOnReload(page, p.target, false, SETTLE_TIMEOUT, url).catch(() => false);
          if (violations.length) return { text: `시작 페이지 확인 중 정책 위반: ${violations.join(', ')}`, isError: true };
          if (ok) onStart.add(`${id} ${url}`);
        }
        errors = check(onStart);
      }
      const declared = new Set((draft.features ?? []).map(f => f.id));
      for (const q of questions) if (q.feature && !declared.has(q.feature)) errors.push(`question ${q.id}: feature ${q.feature} is not in features`);
      if (errors.length) return { text: `계획을 고쳐서 다시 제출하세요:\n- ${errors.join('\n- ')}`, isError: true };
      // 템플릿별 대화면 이 계획의 ID를 다음 대화가 다시 쓰지 못하게 남긴다.
      for (const id of [...draft.scenarios.map(s => s.id), ...(draft.features ?? []).map(f => f.id)]) part?.taken.add(id);
      return { text: '계획을 받았습니다.', done: freeze(draft, o.requirements, pinned, questions, [...onStart]) };
    },
  }];
}

function browserTools(page: Page, policy: Policy, pinned: Map<string, Pinned>, violations: string[], seen: string[],
  nextTarget: () => string, onUrl: (url: string) => void): Tool[] {
  // 마지막 이동 뒤 행동이 없으면 지금 화면은 URL만으로 다시 만들 수 있으므로, pin한 대상이 새로 열어도 있는지 확인한다.
  let acted = false;
  // 화면 상태: URL, 포커스된 요소, ai 모드 접근성 트리. settle도 같은 모드로 찍으므로 모델이 받은 ref 표를 바꾸지 않는다.
  const state = async () => `${page.url()}\n${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 200) ?? '').catch(() => '')}\n${await page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '')}`;
  let still = 0;
  const after = async (what: string, before: string): Promise<ToolOutcome> => {
    await settle(page, SETTLE_TIMEOUT);
    onUrl(page.url());
    still = (await state()) === before ? still + 1 : 0;
    const text = `${what}${still ? ` (화면 변화 없음, ${still}번 연속)` : ''}. 현재 URL: ${page.url()}${violations.length ? `\n정책 위반: ${violations.join(', ')}` : ''}`;
    if (still >= STALL_END) return { text, stall: `화면이 바뀌지 않는 행동 ${still}번 연속` };
    if (still >= STALL_WARN) return { text: `${text}\n화면이 바뀌지 않는 행동이 이어집니다. 지금까지 찾은 기능으로 계획을 제출하거나 다른 기능을 보세요. ${STALL_END}번 연속이면 이 대화를 끝냅니다.` };
    return { text };
  };
  const ref = { type: 'string', description: 'snapshot의 ref (예: e12)' } as const;
  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[],
    run: (input: any) => Promise<string | ToolOutcome>): Tool => ({
    def: { name, description, strict: true, input_schema: { type: 'object', properties, required, additionalProperties: false } },
    run: async input => { const r = await run(input); return typeof r === 'string' ? { text: r } : r; },
  });

  return [
    tool('snapshot', '현재 페이지(또는 ref 영역)의 접근성 트리를 ref와 함께 읽는다.', { ref: { ...ref, description: '생략하면 페이지 전체' } }, [],
      async ({ ref }) => {
        // constraint 인용은 모델에게 실제로 보여 준 텍스트로만 확인한다.
        const shown = (text: string) => { seen.push(text); return text; };
        const full = await snapshot(page, ref);
        if (full.length <= SNAPSHOT_CHARS) return shown(full);
        for (let depth = 8; depth >= 2; depth--) {
          const part = await snapshot(page, ref, depth);
          if (part.length <= SNAPSHOT_CHARS) return shown(`${part}\n(깊이 ${depth}까지만 표시. 자세히 볼 영역의 ref로 다시 snapshot하세요.)`);
        }
        return shown(`${(await snapshot(page, ref, 1)).slice(0, SNAPSHOT_CHARS)}\n(너무 커서 일부만 표시. 영역 ref로 다시 snapshot하세요.)`);
      }),
    tool('navigate', '허용 origin 안의 URL로 이동한다.', { url: { type: 'string' } }, ['url'], async ({ url }) => {
      if (!policy.origins.includes(new URL(url, page.url()).origin)) throw new Error(`허용되지 않은 origin: ${url}`);
      const before = await state();
      await page.goto(new URL(url, page.url()).href);
      acted = false;
      return after('이동함', before);
    }),
    tool('click', '요소를 클릭한다.', { ref }, ['ref'], async ({ ref }) => {
      acted = true;
      const before = await state();
      await page.getByRef(ref).click({ timeout: ACTION_TIMEOUT });
      return after(`${ref} 클릭함`, before);
    }),
    tool('fill', '입력칸에 값을 채운다.', { ref, value: { type: 'string' } }, ['ref', 'value'], async ({ ref, value }) => {
      acted = true;
      const before = await state();
      await page.getByRef(ref).fill(value, { timeout: ACTION_TIMEOUT });
      return after(`${ref}에 입력함`, before);
    }),
    tool('select', '선택 상자에서 옵션을 고른다.', { ref, value: { type: 'string', description: '옵션 라벨' } }, ['ref', 'value'],
      async ({ ref, value }) => {
        acted = true;
        const before = await state();
        await page.getByRef(ref).selectOption({ label: value }, { timeout: ACTION_TIMEOUT });
        return after(`${ref}에서 선택함`, before);
      }),
    tool('press', '키를 누른다 (예: Enter, Escape, Tab).', { key: { type: 'string' } }, ['key'], async ({ key }) => {
      acted = true;
      const before = await state();
      await page.keyboard.press(key);
      return after(`${key} 누름`, before);
    }),
    tool('pin', '계획에 쓸 요소를 고정하고 대상 ID(T1 등)를 받는다. 개수를 세거나 항목들을 읽을 요소는 group=true. '
      + 'ref가 없는 텍스트(예: "- text: 합계 100원")는 그 줄을 담은 요소의 ref와 text로 고정한다. '
      + '새로고침마다 바뀌는 목록(추천 등)의 요소는 position=true로 이름 대신 순서로 고정한다.',
      { ref, group: { type: 'boolean' }, text: { type: 'string', description: 'ref 요소 안의 텍스트 (선택)' },
        position: { type: 'boolean', description: '이름 대신 라벨 영역 안 순서로 고정 (선택)' } }, ['ref', 'group'],
      async ({ ref, group, text, position }) => {
        if ([text !== undefined, group, position].filter(Boolean).length > 1) throw new Error('text·group·position은 함께 쓸 수 없음');
        const r = text !== undefined ? await resolveText(page, ref, text) : group ? await resolveGroup(page, ref)
          : position ? await resolvePosition(page, ref) : await resolveRef(page, ref);
        if (!r.ok) throw new Error(`${ref}를 고정할 수 없음: ${REASONS[r.reason]}`);
        if (!acted && !(await stableOnReload(page, r.target, group, SETTLE_TIMEOUT))) {
          throw new Error(`${ref}는 같은 페이지를 새로 열면 사라지는 요소라 재실행할 수 없음. `
            + '바뀌는 목록이면 position=true로 순서로 고정하고, 기대값은 클릭 전에 읽은 값(expected_from)으로 비교하세요.');
        }
        const id = nextTarget();
        pinned.set(id, { target: r.target, group, url: page.url() });
        return `${id} = ${JSON.stringify(r.target)}`;
      }),
  ];
}

const REASONS: Record<string, string> = {
  unknown_ref: '현재 snapshot에 없는 ref (페이지가 바뀌었으면 다시 snapshot)',
  unnamed: '이름·텍스트가 없고, 가까운 영역에 기준이 될 고유한 라벨도 없어 식별할 수 없음',
  value_only: '숫자 값만 있고, 가까운 영역에 기준이 될 고유한 라벨도 없어 값이 바뀌면 식별할 수 없음',
  ambiguous: '같은 모양의 요소와 구분되지 않음',
  text_not_found: '그 ref 요소가 직접 담은 텍스트가 아님 (- text: 줄의 바로 위 요소 ref를 쓰세요)',
};

const source = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: { kind: { enum: ['requirement', 'constraint', 'observed', 'inferred'] }, id: { type: 'string', description: 'requirement의 요구사항 ID' },
    rule: { type: 'string', description: 'inferred: 일반 규칙 목록의 규칙 ID' },
    quote: { type: 'string', description: 'requirement: 요구사항 원문 인용 / constraint: 화면 안내·제약 원문 인용 / inferred: 이 검사에 규칙이 적용되는 이유' } },
};
const DRAFT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object', additionalProperties: false, required: ['scenarios', 'unplanned'],
  properties: {
    features: { type: 'array', description: '탐색으로 찾은 기능. 요구사항에 없는 기능도 적는다', items: {
      type: 'object', additionalProperties: false, required: ['id', 'name', 'page'],
      properties: { id: { type: 'string', description: 'F1, F2 ...' }, name: { type: 'string' }, page: { type: 'string', description: '기능이 있는 페이지 URL' },
        requirements: { type: 'array', items: { type: 'string' }, description: '관련 요구사항 ID (있으면)' } } } },
    scenarios: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'covers', 'start', 'steps', 'checks'],
      properties: {
        id: { type: 'string', description: 'S1, S2 ...' }, title: { type: 'string' },
        covers: { type: 'array', items: { type: 'string' }, description: '요구사항(R#) 또는 기능(F#) ID' },
        start: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' } } },
        steps: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'op'],
          properties: { id: { type: 'string', description: 'S1.A1 ...' }, op: { enum: ['click', 'fill', 'select', 'press'] },
            target: { type: 'string', description: 'pin으로 받은 대상 ID' }, value: { type: 'string', description: 'fill/select 값, press 키' } } } },
        checks: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'after', 'read', 'op', 'source'],
          properties: { id: { type: 'string', description: 'S1.C1 ...' }, after: { type: 'string', description: '"start" 또는 이 시나리오의 단계 ID' },
            target: { type: 'string', description: 'read url이면 생략' },
            read: { enum: READS },
            // record는 복제 전용 내부 연산이라 모델에게 주지 않는다.
            op: { enum: COMPARES.filter(o => o !== 'record') },
            expected: { type: 'string', description: '고정 기대값. expected_from과 둘 중 하나' },
            expected_from: { type: 'string', description: '같은 시나리오의 앞선 검사 ID. 그 검사가 읽은 실제 값을 기대값으로 쓴다' },
            offset: { type: 'integer', description: 'expected_from 값의 첫 숫자에 더할 수 (예: 증가 버튼 1번 = 1)' },
            source,
            precondition: { type: 'boolean', description: 'true면 시작 조건 확인. 실패하면 뒤 행동을 하지 않고 준비 실패로 남긴다' } } } },
      } } },
    unplanned: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['requirement', 'reason'],
      properties: { requirement: { type: 'string', description: '계획하지 못한 요구사항(R#) 또는 기능(F#) ID' }, reason: { type: 'string' } } } },
    observations: { type: 'array', description: '탐색 중 본 이상하거나 요구사항과 어긋나 보이는 점 (계획에 담지 못한 것 포함)', items: {
      type: 'object', additionalProperties: false, required: ['page', 'note'],
      properties: { page: { type: 'string' }, note: { type: 'string' } } } },
  },
};
