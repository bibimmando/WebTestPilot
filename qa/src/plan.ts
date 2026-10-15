// 계획 계약. 모델은 submit_plan으로 Draft를 내고, 하네스가 검증한 뒤 대상(T#)을 실제 Target으로 바꿔 Plan으로 고정한다.
import type { Target } from './browser.ts';

export type Requirement = { id: string; text: string };

export type Step = { id: string; op: 'click' | 'fill' | 'select' | 'press'; target?: string; value?: string };
export type Read = 'text' | 'value' | 'checked' | 'visible' | 'count' | 'url' | 'items';
export type Op = 'equals' | 'not_equals' | 'contains' | 'less' | 'greater' | 'all_equal' | 'all_contain' | 'any_equal' | 'any_contain';
/**
 * 비교 규칙의 근거. requirement = 요구사항 인용, constraint = 화면 안내·HTML 제약 인용(탐색 중 본 텍스트),
 * observed = 탐색 때 본 값(시작 시점의 기준·선행조건에만), inferred = 일반적인 웹 동작 추정(규칙 문장 필수).
 */
export type Source = { kind: 'requirement' | 'constraint' | 'observed' | 'inferred'; id?: string; quote?: string };
export type Check = {
  id: string; after: string;
  /** read url에는 없다 */
  target?: string;
  read: Read; op: Op;
  /** 고정 기대값. expected_from과 둘 중 하나만 */
  expected?: string;
  /** 관측 참조: 같은 시나리오에서 앞서 실행된 검사가 기록한 실제 값을 기대값으로 쓴다 (예: 클릭 전 카드 이름 = 상세 제목) */
  expected_from?: string;
  source: Source;
  /** 선행조건: 실패하면 뒤 행동을 멈추고 "준비 실패"로 남긴다 (결함 아님) */
  precondition?: boolean;
};
export type Scenario = { id: string; title: string; covers: string[]; start: { url: string }; steps: Step[]; checks: Check[] };
/** 탐색 중 관찰한 이상. 계획에 담지 못해도 보고서에 검토 대상으로 남긴다 */
export type Observation = { page: string; note: string };
export type Draft = { scenarios: Scenario[]; unplanned: { requirement: string; reason: string }[]; observations?: Observation[] };

/** 탐색 중 pin 도구로 확정한 대상. group은 count·items 검사용으로 여러 요소를 허용한다. */
export type Pinned = { target: Target; group: boolean; url: string };

export type Plan = {
  version: 1;
  requirements: Requirement[];
  scenarios: Scenario[];
  unplanned: Draft['unplanned'];
  observations: Observation[];
  targets: Record<string, Pinned>;
};

const NEEDS_VALUE = new Set(['fill', 'select', 'press']);
const OPS = ['click', 'fill', 'select', 'press'];
const READS: Read[] = ['text', 'value', 'checked', 'visible', 'count', 'url', 'items'];
const COMPARES: Op[] = ['equals', 'not_equals', 'contains', 'less', 'greater', 'all_equal', 'all_contain', 'any_equal', 'any_contain'];
const KINDS = ['requirement', 'constraint', 'observed', 'inferred'];
/** 읽기 종류마다 쓸 수 있는 비교 */
const ALLOWED: Record<Read, Op[]> = {
  text: ['equals', 'not_equals', 'contains', 'less', 'greater'],
  value: ['equals', 'not_equals', 'contains', 'less', 'greater'],
  url: ['equals', 'not_equals', 'contains'],
  checked: ['equals', 'not_equals'],
  visible: ['equals', 'not_equals'],
  count: ['equals', 'not_equals', 'less', 'greater'],
  items: ['all_equal', 'all_contain', 'any_equal', 'any_contain'],
};

/** 문자열 안의 첫 숫자 (쉼표 제거). "$1,450" → 1450, "장바구니 (2)" → 2. 없으면 NaN. */
export function numberIn(s: string): number {
  const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** 실행(fixture)과 대조(reconcile)가 같은 규칙으로 비교하도록 한 곳에 둔다. items의 실제 값은 JSON 배열 문자열이다. */
export function compareValues(op: Op, actual: string, expected: string): boolean {
  // 빈 기대값의 포함 비교는 항상 참이다. 관측 참조가 빈 값으로 풀려도 통과시키지 않는다.
  if (op.includes('contain') && !expected.trim()) return false;
  if (op.startsWith('all_') || op.startsWith('any_')) {
    let items: unknown;
    try { items = JSON.parse(actual); } catch { return false; }
    // 빈 목록은 "모두 만족"으로 통과시키지 않는다.
    if (!Array.isArray(items) || !items.length) return false;
    const one = (x: unknown) => op.endsWith('_equal') ? String(x) === expected : String(x).includes(expected);
    return op.startsWith('all_') ? items.every(one) : items.some(one);
  }
  if (op === 'equals') return actual === expected;
  if (op === 'not_equals') return actual !== expected;
  if (op === 'contains') return actual.includes(expected);
  const a = numberIn(actual), e = numberIn(expected);
  if (Number.isNaN(a) || Number.isNaN(e)) return false;
  return op === 'less' ? a < e : a > e;
}

/**
 * 모델 입력은 타입 표기를 믿을 수 없으므로 런타임에 모양을 먼저 검사한다.
 * MCP 경로는 API의 strict 검증을 거치지 않으므로 이 검사가 유일한 입구다.
 */
function shapeErrors(d: any): string[] {
  const e: string[] = [];
  const str = (v: unknown, where: string) => typeof v === 'string' || e.push(`${where} must be a string`);
  const optStr = (v: unknown, where: string) => v === undefined || str(v, where);
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
      for (const k of ['target', 'value']) optStr(st?.[k], `${w}.steps[${j}].${k}`);
    });
    s.checks.forEach((c: any, j: number) => {
      const cw = `${w}.checks[${j}]`;
      str(c?.id, `${cw}.id`); str(c?.after, `${cw}.after`);
      for (const k of ['target', 'expected', 'expected_from']) optStr(c?.[k], `${cw}.${k}`);
      oneOf(c?.read, READS, `${cw}.read`); oneOf(c?.op, COMPARES, `${cw}.op`); oneOf(c?.source?.kind, KINDS, `${cw}.source.kind`);
      for (const k of ['id', 'quote']) optStr(c?.source?.[k], `${cw}.source.${k}`);
      if (c?.precondition !== undefined && typeof c.precondition !== 'boolean') e.push(`${cw}.precondition must be a boolean`);
    });
  });
  d.unplanned.forEach((u: any, i: number) => { str(u?.requirement, `unplanned[${i}].requirement`); str(u?.reason, `unplanned[${i}].reason`); });
  if (d.observations !== undefined) {
    if (!Array.isArray(d.observations)) e.push('observations must be an array');
    else d.observations.forEach((o: any, i: number) => { str(o?.page, `observations[${i}].page`); str(o?.note, `observations[${i}].note`); });
  }
  return e;
}

/**
 * Draft를 검사해 오류 목록을 돌려준다. 오류가 없으면 계획으로 고정할 수 있다.
 * seenText를 주면(탐색 중 본 snapshot 텍스트) constraint 인용이 실제로 화면에 있었는지 확인한다.
 */
export function validate(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>, origins: string[], seenText?: string): string[] {
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
    // 관측 참조는 실행 순서상 앞선 검사만 가리킬 수 있다 (자기 자신·순환 참조 불가). 순서는 generate.sequence와 같다:
    // 시작 뒤 검사 → 행동마다 그 뒤 검사, 같은 시점은 checks 순서. 실행 사본(run/src)에 generate.ts가 없어 여기서 계산한다.
    const points = ['start', ...s.steps.map(st => st.id)];
    const order = points.flatMap(p => s.checks.filter(c => c.after === p).map(c => c.id));
    for (const c of s.checks) {
      unique(c.id, new RegExp(`^${s.id}\\.C\\d+$`), s.id);
      if (c.after !== 'start' && !stepIds.has(c.after)) errors.push(`${c.id}: after must be "start" or a step of ${s.id}`);
      // 선행조건 실패는 결함 후보에서 빠지므로, 기능 검사(행동 뒤·요구사항 근거)를 선행조건으로 표시해 숨기지 못하게 한다.
      if (c.precondition && (c.after !== 'start' || c.source.kind === 'requirement')) {
        errors.push(`${c.id}: precondition is only for start-state checks (after "start") whose basis is not a requirement`);
      }
      checkRead(c, s);
      checkExpectation(c, s, order);
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
    if (p.group !== group) errors.push(`${owner}: target "${id}" ${group ? 'must be pinned as a group for count/items' : 'is a group; pin a single element'}`);
    if (startUrl && page(p.url) !== page(startUrl)) errors.push(`${owner}: target "${id}" was pinned on ${p.url}, not on the start page ${startUrl}`);
  }

  function checkRead(c: Check, s: Scenario) {
    if (!ALLOWED[c.read].includes(c.op)) errors.push(`${c.id}: read ${c.read} allows op ${ALLOWED[c.read].join('|')}`);
    if (c.read === 'url') {
      if (c.target !== undefined) errors.push(`${c.id}: read url takes no target`);
    } else if (!c.target) errors.push(`${c.id}: read ${c.read} needs a target`);
    else requireTarget(c.id, c.target, c.read === 'count' || c.read === 'items', c.after === 'start' ? s.start.url : undefined);
  }

  function checkExpectation(c: Check, s: Scenario, order: string[]) {
    if ((c.expected === undefined) === (c.expected_from === undefined)) return errors.push(`${c.id}: give exactly one of expected or expected_from`);
    if (c.expected_from !== undefined) {
      const at = order.indexOf(c.expected_from);
      if (at < 0 || at >= order.indexOf(c.id)) errors.push(`${c.id}: expected_from must name a check of the same scenario that runs before it`);
      // 같은 시점에 같은 대상을 같은 방식으로 다시 읽어 비교하면 항상 통과한다.
      const ref = s.checks.find(x => x.id === c.expected_from);
      if (ref && ref.after === c.after && ref.target === c.target && ref.read === c.read) errors.push(`${c.id}: expected_from re-reads the same value at the same point and always passes`);
      // 관측 참조는 비교할 값의 출처일 뿐이다. 비교 규칙의 근거는 따로 있어야 한다.
      if (c.source.kind === 'observed') errors.push(`${c.id}: expected_from needs a rule basis (requirement, constraint or inferred), not observed`);
      return;
    }
    const e = c.expected!;
    if (c.read === 'count' && !/^\d+$/.test(e)) errors.push(`${c.id}: count expects a whole-number`);
    if ((c.read === 'checked' || c.read === 'visible') && !['true', 'false'].includes(e)) errors.push(`${c.id}: ${c.read} expects "true" or "false"`);
    if ((c.op === 'less' || c.op === 'greater') && Number.isNaN(numberIn(e))) errors.push(`${c.id}: ${c.op} needs a number in expected`);
    if (c.op.includes('contain') && !e.trim()) errors.push(`${c.id}: contains with an empty expected always passes`);
    // 탐색은 결함이 있을 수 있는 앱을 보고 하므로, 행동 뒤 결과를 지금 본 값으로 기대하면 결함을 정답으로 고정한다.
    if (c.source.kind === 'observed' && c.after !== 'start') {
      errors.push(`${c.id}: a check after an action cannot use an observed value as its expectation; cite a requirement or constraint, use inferred (general web behavior), or compare with expected_from`);
    }
  }

  function checkSource(c: Check, s: Scenario) {
    const q = c.source.quote ?? '';
    const len = q.replace(/\s/g, '').length;
    if (c.source.kind === 'inferred') {
      // shortcut: 규칙 문장의 의미는 검사하지 않아 관찰을 규칙처럼 적는 우회는 남는다. 관측 참조(expected_from)로 기대를 표현하도록 프롬프트가 유도한다.
      if (len < 10) errors.push(`${c.id}: inferred needs source.quote stating the general rule it relies on (10+ characters)`);
      return;
    }
    if (c.source.kind === 'constraint') {
      if (len < 3) errors.push(`${c.id}: constraint needs source.quote of the on-screen text or HTML constraint (3+ characters)`);
      else if (seenText !== undefined && !seenText.includes(q)) errors.push(`${c.id}: constraint quote was not seen during exploration: ${JSON.stringify(q)}`);
      return;
    }
    if (c.source.kind !== 'requirement') return;
    const r = c.source.id ? reqs.get(c.source.id) : undefined;
    if (!r) return errors.push(`${c.id}: source.kind requirement needs a known source.id`);
    if (!s.covers.includes(r.id)) errors.push(`${c.id}: source requirement ${r.id} is not in ${s.id}.covers`);
    if (len < 2 || !r.text.includes(q)) errors.push(`${c.id}: source.quote must be an exact excerpt (2+ characters) of ${r.id}`);
  }
}

/** 검증된 Draft를 실행 가능한 Plan으로 고정한다. 대화 기록과 객체를 공유하지 않도록 복사하고, 쓰이지 않은 pin은 버린다. */
export function freeze(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>): Plan {
  const used = new Set(draft.scenarios.flatMap(s => [...s.steps.map(st => st.target), ...s.checks.map(c => c.target)]));
  const targets = Object.fromEntries([...pinned].filter(([id]) => used.has(id)));
  return structuredClone({ version: 1 as const, requirements, scenarios: draft.scenarios, unplanned: draft.unplanned,
    observations: draft.observations ?? [], targets });
}

function sameOrigin(url: string, origins: string[]): boolean {
  try { return origins.includes(new URL(url).origin); } catch { return false; }
}

/** 같은 페이지인지 비교하기 위한 URL (hash 제외). */
function page(url: string): string {
  try { const u = new URL(url); return u.origin + u.pathname + u.search; } catch { return url; }
}
