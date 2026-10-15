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

/** Draft를 검사해 오류 목록을 돌려준다. 오류가 없으면 계획으로 고정할 수 있다. */
export function validate(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>, origins: string[]): string[] {
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
    for (const st of s.steps) {
      unique(st.id, new RegExp(`^${s.id}\\.A\\d+$`), s.id);
      stepIds.add(st.id);
      if (st.op !== 'press' && !st.target) errors.push(`${st.id}: ${st.op} needs a target`);
      if (st.target) requireTarget(st.id, st.target, false);
      if (NEEDS_VALUE.has(st.op) && st.value === undefined) errors.push(`${st.id}: ${st.op} needs a value`);
    }
    for (const c of s.checks) {
      unique(c.id, new RegExp(`^${s.id}\\.C\\d+$`), s.id);
      if (c.after !== 'start' && !stepIds.has(c.after)) errors.push(`${c.id}: after must be "start" or a step of ${s.id}`);
      requireTarget(c.id, c.target, c.read === 'count');
      if (c.read === 'count' && (c.op !== 'equals' || !/^\d+$/.test(c.expected))) errors.push(`${c.id}: count needs op equals and a whole-number expected`);
      if ((c.read === 'checked' || c.read === 'visible') && !['true', 'false'].includes(c.expected)) errors.push(`${c.id}: ${c.read} expects "true" or "false"`);
      checkSource(c, s);
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

  function requireTarget(owner: string, id: string, group: boolean) {
    const p = pinned.get(id);
    if (!p) return errors.push(`${owner}: target "${id}" was not pinned`);
    if (p.group !== group) errors.push(`${owner}: target "${id}" ${group ? 'must be pinned as a group for count' : 'is a group; pin a single element'}`);
  }

  function checkSource(c: Check, s: Scenario) {
    if (c.source.kind !== 'requirement') return;
    const r = c.source.id ? reqs.get(c.source.id) : undefined;
    if (!r) return errors.push(`${c.id}: source.kind requirement needs a known source.id`);
    if (!s.covers.includes(r.id)) errors.push(`${c.id}: source requirement ${r.id} is not in ${s.id}.covers`);
    if (!c.source.quote || !r.text.includes(c.source.quote)) errors.push(`${c.id}: source.quote must be an exact excerpt of ${r.id}`);
  }
}

/** 검증된 Draft를 실행 가능한 Plan으로 고정한다. 쓰이지 않은 pin은 버린다. */
export function freeze(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>): Plan {
  const used = new Set(draft.scenarios.flatMap(s => [...s.steps.map(st => st.target), ...s.checks.map(c => c.target)]));
  const targets = Object.fromEntries([...pinned].filter(([id]) => used.has(id)));
  return { version: 1, requirements, scenarios: draft.scenarios, unplanned: draft.unplanned, targets };
}

function sameOrigin(url: string, origins: string[]): boolean {
  try { return origins.includes(new URL(url).origin); } catch { return false; }
}
