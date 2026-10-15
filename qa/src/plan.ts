// 계획 계약. 모델은 submit_plan으로 Draft를 내고, 하네스가 검증한 뒤 대상(T#)을 실제 Target으로 바꿔 Plan으로 고정한다.
import type { Target } from './browser.ts';

export type Requirement = { id: string; text: string };

export type Step = { id: string; op: 'click' | 'fill' | 'select' | 'press'; target?: string; value?: string };
export type Check = {
  id: string; after: string; target: string;
  read: 'text' | 'value' | 'checked' | 'visible' | 'count';
  op: 'equals' | 'contains';
  expected: string;
  source: { kind: 'requirement' | 'observed' | 'heuristic'; id?: string; quote?: string };
};
export type Scenario = { id: string; title: string; covers: string[]; start: { url: string }; steps: Step[]; checks: Check[] };
export type Draft = { scenarios: Scenario[]; unplanned: { requirement: string; reason: string }[] };

/** 탐색 중 pin 도구로 확정한 대상. group은 count 검사용으로 여러 요소를 허용한다. */
export type Pinned = { target: Target; group: boolean; url: string };

export type Plan = {
  version: 1;
  requirements: Requirement[];
  scenarios: Scenario[];
  unplanned: Draft['unplanned'];
  targets: Record<string, Pinned>;
};

const NEEDS_VALUE = new Set(['fill', 'select', 'press']);
const OPS = ['click', 'fill', 'select', 'press'];
const READS = ['text', 'value', 'checked', 'visible', 'count'];
const COMPARES = ['equals', 'contains'];
const KINDS = ['requirement', 'observed', 'heuristic'];

/**
 * 모델 입력은 타입 표기를 믿을 수 없으므로 런타임에 모양을 먼저 검사한다.
 * MCP 경로는 API의 strict 검증을 거치지 않으므로 이 검사가 유일한 입구다.
 */
function shapeErrors(d: any): string[] {
  const e: string[] = [];
  const str = (v: unknown, where: string) => typeof v === 'string' || e.push(`${where} must be a string`);
  const oneOf = (v: unknown, allowed: string[], where: string) => allowed.includes(v as string) || e.push(`${where} must be one of ${allowed.join('|')}`);
  if (!d || !Array.isArray(d.scenarios) || !Array.isArray(d.unplanned)) return ['plan must have scenarios[] and unplanned[]'];
  d.scenarios.forEach((s: any, i: number) => {
    const w = `scenarios[${i}]`;
    if (!s || typeof s !== 'object') return e.push(`${w} must be an object`);
    str(s.id, `${w}.id`); str(s.title, `${w}.title`); str(s.start?.url, `${w}.start.url`);
    if (!Array.isArray(s.covers) || !s.covers.every((c: unknown) => typeof c === 'string')) e.push(`${w}.covers must be string[]`);
    if (!Array.isArray(s.steps) || !Array.isArray(s.checks)) return e.push(`${w} needs steps[] and checks[]`);
    s.steps.forEach((st: any, j: number) => {
      str(st?.id, `${w}.steps[${j}].id`); oneOf(st?.op, OPS, `${w}.steps[${j}].op`);
      for (const k of ['target', 'value']) if (st?.[k] !== undefined) str(st[k], `${w}.steps[${j}].${k}`);
    });
    s.checks.forEach((c: any, j: number) => {
      const cw = `${w}.checks[${j}]`;
      for (const k of ['id', 'after', 'target', 'expected']) str(c?.[k], `${cw}.${k}`);
      oneOf(c?.read, READS, `${cw}.read`); oneOf(c?.op, COMPARES, `${cw}.op`); oneOf(c?.source?.kind, KINDS, `${cw}.source.kind`);
      for (const k of ['id', 'quote']) if (c?.source?.[k] !== undefined) str(c.source[k], `${cw}.source.${k}`);
    });
  });
  d.unplanned.forEach((u: any, i: number) => { str(u?.requirement, `unplanned[${i}].requirement`); str(u?.reason, `unplanned[${i}].reason`); });
  return e;
}

/** Draft를 검사해 오류 목록을 돌려준다. 오류가 없으면 계획으로 고정할 수 있다. */
export function validate(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>, origins: string[]): string[] {
  const shape = shapeErrors(draft);
  if (shape.length) return shape;
  const errors: string[] = [];
  const reqs = new Map(requirements.map(r => [r.id, r]));
  const seen = new Set<string>();
  const unique = (id: string, pattern: RegExp, where: string) => {
    if (!pattern.test(id)) errors.push(`${where}: id "${id}" must match ${pattern}`);
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
  };
  const covered = new Set<string>();

  for (const s of draft.scenarios) {
    unique(s.id, /^S\d+$/, 'scenario');
    if (!s.covers.length) errors.push(`${s.id}: covers must list at least one requirement`);
    for (const r of s.covers) {
      if (!reqs.has(r)) errors.push(`${s.id}: unknown requirement "${r}"`);
      covered.add(r);
    }
    if (!sameOrigin(s.start.url, origins)) errors.push(`${s.id}: start.url "${s.start.url}" is outside the allowed origins`);
    if (!s.checks.length) errors.push(`${s.id}: needs at least one check`);

    const stepIds = new Set<string>();
    s.steps.forEach((st, i) => {
      unique(st.id, new RegExp(`^${s.id}\\.A\\d+$`), s.id);
      stepIds.add(st.id);
      if (st.op !== 'press' && !st.target) errors.push(`${st.id}: ${st.op} needs a target`);
      if (st.target) requireTarget(st.id, st.target, false, i === 0 ? s.start.url : undefined);
      if (NEEDS_VALUE.has(st.op) && st.value === undefined) errors.push(`${st.id}: ${st.op} needs a value`);
    });
    for (const c of s.checks) {
      unique(c.id, new RegExp(`^${s.id}\\.C\\d+$`), s.id);
      if (c.after !== 'start' && !stepIds.has(c.after)) errors.push(`${c.id}: after must be "start" or a step of ${s.id}`);
      requireTarget(c.id, c.target, c.read === 'count', c.after === 'start' ? s.start.url : undefined);
      if (c.read === 'count' && (c.op !== 'equals' || !/^\d+$/.test(c.expected))) errors.push(`${c.id}: count needs op equals and a whole-number expected`);
      if ((c.read === 'checked' || c.read === 'visible') && !['true', 'false'].includes(c.expected)) errors.push(`${c.id}: ${c.read} expects "true" or "false"`);
      if (c.op === 'contains' && !c.expected.trim()) errors.push(`${c.id}: contains with an empty expected always passes`);
      checkSource(c, s);
    }
    // covers는 "검사했다"는 주장이므로 각 요구사항을 실제로 인용한 검사가 있어야 한다.
    for (const r of s.covers) {
      if (!s.checks.some(c => c.source.kind === 'requirement' && c.source.id === r)) errors.push(`${s.id}: covers ${r} but no check cites ${r} as its source`);
    }
  }

  for (const u of draft.unplanned) {
    if (!reqs.has(u.requirement)) errors.push(`unplanned: unknown requirement "${u.requirement}"`);
    if (covered.has(u.requirement)) errors.push(`unplanned: "${u.requirement}" is also covered by a scenario`);
    if (!u.reason.trim()) errors.push(`unplanned: "${u.requirement}" needs a reason`);
    covered.add(u.requirement);
  }
  for (const r of requirements) if (!covered.has(r.id)) errors.push(`requirement ${r.id} is neither covered nor unplanned`);
  return errors;

  /** startUrl을 주면, 시나리오 시작 상태에서 쓰는 대상이므로 그 URL에서 pin했어야 한다. */
  function requireTarget(owner: string, id: string, group: boolean, startUrl?: string) {
    const p = pinned.get(id);
    if (!p) return errors.push(`${owner}: target "${id}" was not pinned`);
    if (p.group !== group) errors.push(`${owner}: target "${id}" ${group ? 'must be pinned as a group for count' : 'is a group; pin a single element'}`);
    if (startUrl && page(p.url) !== page(startUrl)) errors.push(`${owner}: target "${id}" was pinned on ${p.url}, not on the start page ${startUrl}`);
  }

  function checkSource(c: Check, s: Scenario) {
    if (c.source.kind !== 'requirement') return;
    const r = c.source.id ? reqs.get(c.source.id) : undefined;
    if (!r) return errors.push(`${c.id}: source.kind requirement needs a known source.id`);
    if (!s.covers.includes(r.id)) errors.push(`${c.id}: source requirement ${r.id} is not in ${s.id}.covers`);
    const q = c.source.quote ?? '';
    if (q.replace(/\s/g, '').length < 2 || !r.text.includes(q)) errors.push(`${c.id}: source.quote must be an exact excerpt (2+ characters) of ${r.id}`);
  }
}

/** 검증된 Draft를 실행 가능한 Plan으로 고정한다. 대화 기록과 객체를 공유하지 않도록 복사하고, 쓰이지 않은 pin은 버린다. */
export function freeze(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>): Plan {
  const used = new Set(draft.scenarios.flatMap(s => [...s.steps.map(st => st.target), ...s.checks.map(c => c.target)]));
  const targets = Object.fromEntries([...pinned].filter(([id]) => used.has(id)));
  return structuredClone({ version: 1 as const, requirements, scenarios: draft.scenarios, unplanned: draft.unplanned, targets });
}

function sameOrigin(url: string, origins: string[]): boolean {
  try { return origins.includes(new URL(url).origin); } catch { return false; }
}

/** 같은 페이지인지 비교하기 위한 URL (hash 제외). */
function page(url: string): string {
  try { const u = new URL(url); return u.origin + u.pathname + u.search; } catch { return url; }
}
