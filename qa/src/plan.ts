// 계획 계약. 모델은 submit_plan으로 Draft를 내고, 하네스가 검증한 뒤 대상(T#)을 실제 Target으로 바꿔 Plan으로 고정한다.
import type { Target } from './browser.ts';
import { RULE_IDS, ruleOf } from './rules.ts';

export type Requirement = { id: string; text: string };

export type Step = { id: string; op: 'click' | 'fill' | 'select' | 'press'; target?: string; value?: string };
export type Read = 'text' | 'value' | 'checked' | 'visible' | 'count' | 'url' | 'items';
/** record: 복제 실행(C4) 전용 "기록만" — 항상 통과하고 관측 참조용 값만 남긴다. 모델 계획에는 쓸 수 없다. */
export type Op = 'record' | 'equals' | 'not_equals' | 'contains' | 'less' | 'greater' | 'same_number' | 'all_equal' | 'all_contain' | 'any_equal' | 'any_contain';
/**
 * 비교 규칙의 근거. requirement = 요구사항 인용, constraint = 화면 안내·HTML 제약 인용(탐색 중 본 텍스트),
 * observed = 탐색 때 본 값(시작 시점의 기준·선행조건에만), inferred = 일반 규칙 목록(rules.ts)의 규칙 ID 인용(quote는 적용 조건 설명).
 */
export type Source = { kind: 'requirement' | 'constraint' | 'observed' | 'inferred'; id?: string; rule?: string; quote?: string };
export type Check = {
  id: string; after: string;
  /** read url에는 없다 */
  target?: string;
  read: Read; op: Op;
  /** 고정 기대값. expected_from과 둘 중 하나만 */
  expected?: string;
  /** 관측 참조: 같은 시나리오에서 앞서 실행된 검사가 기록한 실제 값을 기대값으로 쓴다 (예: 클릭 전 카드 이름 = 상세 제목) */
  expected_from?: string;
  /** 관측 참조에 더할 수 (예: 증가 버튼 1번이면 +1). 참조 값의 첫 숫자에 더한다 */
  offset?: number;
  source: Source;
  /** 선행조건: 실패하면 뒤 행동을 멈추고 "준비 실패"로 남긴다 (결함 아님) */
  precondition?: boolean;
};
/** covers: 요구사항(R#) 또는 탐색으로 찾은 기능(F#). variantOf: 같은 템플릿의 다른 페이지에서 실행하려고 복제한 원래 시나리오(C4) */
export type Scenario = { id: string; title: string; covers: string[]; start: { url: string }; steps: Step[]; checks: Check[]; variantOf?: string };
/** 탐색으로 찾은 기능. 요구사항에 없는 기능도 남긴다(자율 탐색). requirements는 관련 요구사항 ID */
export type Feature = { id: string; name: string; page: string; requirements?: string[] };
/** 탐색 중 ask_user로 남긴 업무 규칙 질문. 답을 기다리지 않는다. 답 받기는 M5·M7 */
export type Question = { id: string; page: string; question: string; options: string[]; feature?: string; overLimit?: boolean };
/** 탐색 중 관찰한 이상. 계획에 담지 못해도 보고서에 검토 대상으로 남긴다 */
export type Observation = { page: string; note: string };
export type Draft = { features?: Feature[]; scenarios: Scenario[]; unplanned: { requirement: string; reason: string }[]; observations?: Observation[] };

/** 탐색 중 pin 도구로 확정한 대상. group은 count·items 검사용으로 여러 요소를 허용한다. */
export type Pinned = { target: Target; group: boolean; url: string };

export type Plan = {
  version: 1;
  requirements: Requirement[];
  features: Feature[];
  scenarios: Scenario[];
  unplanned: Draft['unplanned'];
  observations: Observation[];
  /** C4 복제 기록: 원본·페이지·만든 시나리오, 뺀 검사와 사유, 복제하지 않은 사유. 분모에서 숨기지 않기 위해 남긴다 */
  variants?: { from: string; url: string; to?: string; dropped: string[]; skipped?: string }[];
  questions: Question[];
  /** 탐색 때 시작 URL을 새로 열어 있음을 확인한 "대상ID 시작URL" 쌍. 실행 단계의 재검증도 같은 계약을 쓴다 */
  startVerified?: string[];
  targets: Record<string, Pinned>;
};

const NEEDS_VALUE = new Set(['fill', 'select', 'press']);
const OPS = ['click', 'fill', 'select', 'press'];
const READS: Read[] = ['text', 'value', 'checked', 'visible', 'count', 'url', 'items'];
const COMPARES: Op[] = ['record', 'equals', 'not_equals', 'contains', 'less', 'greater', 'same_number', 'all_equal', 'all_contain', 'any_equal', 'any_contain'];
const KINDS = ['requirement', 'constraint', 'observed', 'inferred'];
/** 읽기 종류마다 쓸 수 있는 비교 */
const ALLOWED: Record<Read, Op[]> = {
  text: ['equals', 'not_equals', 'contains', 'less', 'greater', 'same_number'],
  value: ['equals', 'not_equals', 'contains', 'less', 'greater', 'same_number'],
  url: ['equals', 'not_equals', 'contains'],
  checked: ['equals', 'not_equals'],
  visible: ['equals', 'not_equals'],
  count: ['equals', 'not_equals', 'less', 'greater', 'same_number'],
  items: ['all_equal', 'all_contain', 'any_equal', 'any_contain'],
};

/** 문자열 안의 첫 숫자 (쉼표 제거). "$1,450" → 1450, "장바구니 (2)" → 2. 없으면 NaN. */
export function numberIn(s: string): number {
  const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** 관측 참조를 기대값으로 푼다. offset이 있으면 참조 값의 첫 숫자에 더한다. 풀 수 없으면 undefined. */
export function expectedFrom(c: Check, ref: string | undefined): string | undefined {
  if (ref === undefined || c.offset === undefined) return ref;
  const n = numberIn(ref);
  // 참조 문구 안의 숫자만 바꾼다: "장바구니 (0)" + 1 → "장바구니 (1)". shortcut: 천 단위 쉼표는 다시 붙이지 않는다.
  return Number.isNaN(n) ? undefined : ref.replace(/-?\d[\d,]*(?:\.\d+)?/, String(n + c.offset));
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
  if (op === 'record') return true;
  if (op === 'equals') return actual === expected;
  if (op === 'not_equals') return actual !== expected;
  if (op === 'contains') return actual.includes(expected);
  const a = numberIn(actual), e = numberIn(expected);
  if (Number.isNaN(a) || Number.isNaN(e)) return false;
  // same_number: 문구 안의 숫자끼리 비교한다 ("7개 상품"과 목록 개수 7).
  return op === 'less' ? a < e : op === 'greater' ? a > e : a === e;
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
      for (const k of ['id', 'rule', 'quote']) optStr(c?.source?.[k], `${cw}.source.${k}`);
      if (c?.precondition !== undefined && typeof c.precondition !== 'boolean') e.push(`${cw}.precondition must be a boolean`);
      if (c?.offset !== undefined && !Number.isInteger(c.offset)) e.push(`${cw}.offset must be an integer`);
    });
  });
  if (d.features !== undefined) {
    if (!Array.isArray(d.features)) e.push('features must be an array');
    else d.features.forEach((f: any, i: number) => {
      str(f?.id, `features[${i}].id`); str(f?.name, `features[${i}].name`); str(f?.page, `features[${i}].page`);
      if (f?.requirements !== undefined && !(Array.isArray(f.requirements) && f.requirements.every((r: unknown) => typeof r === 'string'))) e.push(`features[${i}].requirements must be string[]`);
    });
  }
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
/**
 * onStart: 다른 페이지에서 pin했지만 시작 URL을 새로 열어 그 대상이 있음을 확인한 "대상ID 시작URL" 쌍. 시작 페이지 pin 규칙을 대신한다.
 */
/**
 * part: 템플릿별 대화의 부분 계획을 검사할 때. taken = 앞선 대화에서 이미 쓴 S#·F# ID, partial = 요구사항 분모는 합친 계획에서 따진다.
 */
export function validate(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>, origins: string[], seenText?: string, onStart?: Set<string>,
  part?: { taken: Set<string> }): string[] {
  const shape = shapeErrors(draft);
  if (shape.length) return shape;
  const errors: string[] = [];
  const reqs = new Map(requirements.map(r => [r.id, r]));
  const seen = new Set<string>();
  const unique = (id: string, pattern: RegExp, where: string) => {
    if (!pattern.test(id)) errors.push(`${where}: id "${id}" must match ${pattern}`);
    if (seen.has(id)) errors.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
    if (part?.taken.has(id)) errors.push(`${where}: id "${id}" is already used in another page type's plan`);
  };
  const covered = new Set<string>();
  const features = new Set<string>();
  for (const f of draft.features ?? []) {
    unique(f.id, /^F\d+$/, 'feature');
    features.add(f.id);
    for (const r of f.requirements ?? []) if (!reqs.has(r)) errors.push(`${f.id}: unknown requirement "${r}"`);
  }

  for (const s of draft.scenarios) {
    unique(s.id, /^S\d+$/, 'scenario');
    // 복제 표식은 하네스만 붙인다. 원본이 같은 계획에 있어야 한다(위조로 시작 페이지 검증을 피하지 못하게).
    if (s.variantOf !== undefined && !draft.scenarios.some(x => x.id === s.variantOf && x.variantOf === undefined)) errors.push(`${s.id}: variantOf "${s.variantOf}" must name an original scenario of this plan`);
    if (!s.covers.length) errors.push(`${s.id}: covers must list at least one requirement (R#) or feature (F#)`);
    // 기능 하나에 시나리오 하나: 여러 기능이 검사 하나에 편승하지 못하게 한다.
    if (s.covers.filter(r => features.has(r)).length > 1) errors.push(`${s.id}: a scenario covers at most one feature (F#); split it`);
    for (const r of s.covers) {
      if (!reqs.has(r) && !features.has(r)) errors.push(`${s.id}: unknown requirement or feature "${r}"`);
      covered.add(r);
    }
    if (!sameOrigin(s.start.url, origins)) errors.push(`${s.id}: start.url "${s.start.url}" is outside the allowed origins`);
    if (!s.checks.length) errors.push(`${s.id}: needs at least one check`);

    const stepIds = new Set<string>();
    s.steps.forEach((st, i) => {
      unique(st.id, new RegExp(`^${s.id}\\.A\\d+$`), s.id);
      stepIds.add(st.id);
      if (st.op !== 'press' && !st.target) errors.push(`${st.id}: ${st.op} needs a target`);
      // 복제 시나리오는 다른 페이지에서 시작한다. 대상이 그 페이지에 있는지는 실행이 확인하고 없으면 "적용 불가"로 남긴다.
      if (st.target) requireTarget(st.id, st.target, false, i === 0 && !s.variantOf ? s.start.url : undefined);
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
      if (reqs.has(r) && !s.checks.some(c => c.source.kind === 'requirement' && c.source.id === r)) errors.push(`${s.id}: covers ${r} but no check cites ${r} as its source`);
    }
    // 기능을 다루는 시나리오는 그 기능을 규칙 근거로 검사해야 한다. 관찰값·선행조건·요구사항 인용 검사로 대신하지 않는다.
    if (s.covers.some(r => features.has(r)) && !s.checks.some(c => !c.precondition && (c.source.kind === 'inferred' || c.source.kind === 'constraint'))) {
      errors.push(`${s.id}: covers a feature but has no non-precondition check with an inferred rule or constraint basis`);
    }
  }

  for (const u of draft.unplanned) {
    if (!reqs.has(u.requirement) && !features.has(u.requirement)) errors.push(`unplanned: unknown requirement or feature "${u.requirement}"`);
    if (covered.has(u.requirement)) errors.push(`unplanned: "${u.requirement}" is also covered by a scenario`);
    if (!u.reason.trim()) errors.push(`unplanned: "${u.requirement}" needs a reason`);
    covered.add(u.requirement);
  }
  if (!part) for (const r of requirements) if (!covered.has(r.id)) errors.push(`requirement ${r.id} is neither covered nor unplanned`);
  // 찾았다고 적은 기능은 검사하거나 미계획 사유를 남긴다(분모 보존).
  for (const f of features) if (!covered.has(f)) errors.push(`feature ${f} is neither covered nor unplanned`);
  return errors;

  /** startUrl을 주면, 시나리오 시작 상태에서 쓰는 대상이므로 그 URL에서 pin했어야 한다. */
  function requireTarget(owner: string, id: string, group: boolean, startUrl?: string) {
    const p = pinned.get(id);
    if (!p) return errors.push(`${owner}: target "${id}" was not pinned`);
    if (p.group !== group) errors.push(`${owner}: target "${id}" ${group ? 'must be pinned as a group for count/items' : 'is a group; pin a single element'}`);
    if (startUrl && page(p.url) !== page(startUrl) && !onStart?.has(`${id} ${startUrl}`)) errors.push(`${owner}: target "${id}" was pinned on ${p.url}, not on the start page ${startUrl}`);
  }

  function checkRead(c: Check, s: Scenario) {
    if (c.op === 'record') {
      if (!s.variantOf) errors.push(`${c.id}: op record is internal to copied scenarios`);
    } else if (!ALLOWED[c.read].includes(c.op)) errors.push(`${c.id}: read ${c.read} allows op ${ALLOWED[c.read].join('|')}`);
    if (c.read === 'url') {
      if (c.target !== undefined) errors.push(`${c.id}: read url takes no target`);
    } else if (!c.target) errors.push(`${c.id}: read ${c.read} needs a target`);
    else requireTarget(c.id, c.target, c.read === 'count' || c.read === 'items', c.after === 'start' && !s.variantOf ? s.start.url : undefined);
  }

  function checkExpectation(c: Check, s: Scenario, order: string[]) {
    if ((c.expected === undefined) === (c.expected_from === undefined)) return errors.push(`${c.id}: give exactly one of expected or expected_from`);
    if (c.offset !== undefined && c.expected_from === undefined) errors.push(`${c.id}: offset is only for expected_from`);
    if (c.expected_from !== undefined) {
      const at = order.indexOf(c.expected_from);
      if (at < 0 || at >= order.indexOf(c.id)) errors.push(`${c.id}: expected_from must name a check of the same scenario that runs before it`);
      // 같은 시점에 같은 대상을 같은 방식으로 다시 읽어 비교하면 항상 통과한다.
      const ref = s.checks.find(x => x.id === c.expected_from);
      // 같은 요소를 다른 ID로 두 번 고정한 별칭도 같은 대상으로 본다.
      const sameTarget = ref?.target === c.target || (!!ref?.target && !!c.target && JSON.stringify(pinned.get(ref.target)?.target) === JSON.stringify(pinned.get(c.target)?.target));
      if (ref && ref.after === c.after && sameTarget && ref.read === c.read) errors.push(`${c.id}: expected_from re-reads the same value at the same point and always passes`);
      // 관측 참조는 비교할 값의 출처일 뿐이다. 비교 규칙의 근거는 따로 있어야 한다.
      if (c.source.kind === 'observed') errors.push(`${c.id}: expected_from needs a rule basis (requirement, constraint or inferred), not observed`);
      return;
    }
    const e = c.expected!;
    if (c.read === 'count' && !/^\d+$/.test(e)) errors.push(`${c.id}: count expects a whole-number`);
    if ((c.read === 'checked' || c.read === 'visible') && !['true', 'false'].includes(e)) errors.push(`${c.id}: ${c.read} expects "true" or "false"`);
    if ((c.op === 'less' || c.op === 'greater' || c.op === 'same_number') && Number.isNaN(numberIn(e))) errors.push(`${c.id}: ${c.op} needs a number in expected`);
    if (c.op.includes('contain') && !e.trim()) errors.push(`${c.id}: contains with an empty expected always passes`);
    // 탐색은 결함이 있을 수 있는 앱을 보고 하므로, 행동 뒤 결과를 지금 본 값으로 기대하면 결함을 정답으로 고정한다.
    if (c.source.kind === 'observed' && c.after !== 'start' && c.op !== 'record') {
      errors.push(`${c.id}: a check after an action cannot use an observed value as its expectation; cite a requirement or constraint, use inferred (general web behavior), or compare with expected_from`);
    }
  }

  function checkSource(c: Check, s: Scenario) {
    const q = c.source.quote ?? '';
    const len = q.replace(/\s/g, '').length;
    if (c.source.kind === 'inferred') {
      // 일반 규칙은 고정된 목록에서만 고르고, 규칙마다 정한 비교 형태를 지켜야 한다. 관찰한 값을 규칙 ID만 붙여 정답으로 쓰는 우회를 막는다.
      const rule = ruleOf(c.source.rule);
      if (!rule) return errors.push(`${c.id}: inferred needs source.rule from the general rule list (${[...RULE_IDS].join(', ')})`);
      if (len < 10) errors.push(`${c.id}: inferred needs source.quote explaining why rule ${rule.id} applies here (10+ characters)`);
      if (rule.form === 'relation' && c.expected_from === undefined) errors.push(`${c.id}: rule ${rule.id} compares with a value read earlier; use expected_from`);
      if (rule.offset && !c.offset) errors.push(`${c.id}: rule ${rule.id} needs offset (how many steps up or down from the value read earlier)`);
      if (rule.form === 'bound' && c.op !== 'less' && c.op !== 'greater') errors.push(`${c.id}: rule ${rule.id} is a bound; use op less or greater`);
      if (rule.form === 'items' && c.read !== 'items') errors.push(`${c.id}: rule ${rule.id} checks every item; use read items`);
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

/**
 * 템플릿별 대화의 계획을 하나로 합친다. ID(S#·F#·T#·Q#)는 대화 사이에 겹치지 않게 만들어졌다.
 * 어느 대화에서도 계획하지 않은 요구사항은 미계획으로 남겨 분모에서 숨기지 않는다. 한 대화에서 미계획이어도 다른 대화가 다뤘으면 지운다.
 */
export function mergePlans(plans: Plan[], requirements: Requirement[]): Plan {
  const covered = new Set(plans.flatMap(p => p.scenarios.flatMap(s => s.covers)));
  const unplanned: Draft['unplanned'] = [];
  for (const u of plans.flatMap(p => p.unplanned)) {
    if (!covered.has(u.requirement) && !unplanned.some(x => x.requirement === u.requirement)) unplanned.push(u);
  }
  for (const r of requirements) {
    if (!covered.has(r.id) && !unplanned.some(u => u.requirement === r.id)) unplanned.push({ requirement: r.id, reason: '어느 페이지 종류의 대화에서도 계획하지 않음' });
  }
  const questions = new Map(plans.flatMap(p => p.questions).map(q => [q.id, q]));
  return { version: 1, requirements, features: plans.flatMap(p => p.features), scenarios: plans.flatMap(p => p.scenarios), unplanned,
    observations: plans.flatMap(p => p.observations), questions: [...questions.values()],
    ...(plans.some(p => p.startVerified?.length) ? { startVerified: plans.flatMap(p => p.startVerified ?? []) } : {}),
    targets: Object.assign({}, ...plans.map(p => p.targets)) };
}

/**
 * 같은 템플릿의 다른 페이지에서 같은 계획을 실행하도록 시나리오를 복제한다(C4). pages: 시나리오 ID → 추가로 실행할 시작 URL들.
 * 대표 페이지에서 정한 고정값은 다른 페이지에서 맞는다는 근거가 없다.
 * - 관찰값 고정 검사(visible·checked 제외)는 "기록만"(record)으로 바꾼다. 관측 참조는 그 페이지에서 새로 읽은 값을 쓴다.
 * - 요구사항·화면 제약 근거의 고정값 검사는 페이지마다 다를 수 있어 뺀다(관측 참조가 가리키면 기록만으로 바꾼다). 뺀 검사는 사유와 함께 남긴다.
 * 규칙 근거 검사가 남지 않거나 복제본이 계약을 어기면 복제하지 않고 사유를 남긴다.
 */
export function cloneScenarios(plan: Plan, pages: Record<string, string[]>): Plan {
  let next = Math.max(0, ...plan.scenarios.map(s => Number(s.id.slice(1)))) + 1;
  const pinned = new Map(Object.entries(plan.targets));
  const clones: Scenario[] = [];
  const variants: NonNullable<Plan['variants']> = [];
  for (const s of plan.scenarios) for (const url of pages[s.id] ?? []) {
    const id = `S${next}`;
    const ren = (x: string) => x.startsWith(`${s.id}.`) ? id + x.slice(s.id.length) : x;
    const referenced = new Set(s.checks.map(c => c.expected_from).filter(Boolean));
    const dropped: string[] = [];
    const checks = s.checks.flatMap((c): Check[] => {
      const base: Check = { ...c, id: ren(c.id), after: ren(c.after), ...(c.expected_from ? { expected_from: ren(c.expected_from) } : {}) };
      const record: Check = { ...base, op: 'record', expected: '', source: { kind: 'observed' }, precondition: undefined };
      if (c.expected === undefined) return [base];
      if (c.source.kind === 'requirement' || c.source.kind === 'constraint') {
        if (referenced.has(c.id)) return [record];
        dropped.push(`${c.id}: 페이지마다 다를 수 있는 ${c.source.kind === 'requirement' ? '요구사항' : '화면 제약'} 고정값`);
        return [];
      }
      return c.source.kind === 'observed' && c.read !== 'visible' && c.read !== 'checked' ? [record] : [base];
    });
    const clone: Scenario = { ...structuredClone(s), id, variantOf: s.id, title: `${s.title} (같은 템플릿 다른 페이지)`, start: { url },
      steps: s.steps.map(st => ({ ...st, id: ren(st.id) })), checks };
    if (!checks.some(c => c.op !== 'record' && c.source.kind !== 'observed')) {
      variants.push({ from: s.id, url, dropped, skipped: '규칙 근거 검사가 남지 않음' });
      continue;
    }
    const errors = validate({ features: plan.features, scenarios: [s, clone], unplanned: [] }, plan.requirements, pinned, [new URL(url).origin],
      undefined, new Set(plan.startVerified ?? []), { taken: new Set() }).filter(e => e.startsWith(`${id}`));
    if (errors.length) {
      variants.push({ from: s.id, url, dropped, skipped: `계약 위반: ${errors.join('; ')}` });
      continue;
    }
    next++;
    clones.push(clone);
    variants.push({ from: s.id, url, to: id, dropped });
  }
  return { ...plan, scenarios: [...plan.scenarios, ...clones], variants: [...(plan.variants ?? []), ...variants] };
}

/** 검증된 Draft를 실행 가능한 Plan으로 고정한다. 대화 기록과 객체를 공유하지 않도록 복사하고, 쓰이지 않은 pin은 버린다. */
export function freeze(draft: Draft, requirements: Requirement[], pinned: Map<string, Pinned>, questions: Question[] = [], startVerified: string[] = []): Plan {
  const used = new Set(draft.scenarios.flatMap(s => [...s.steps.map(st => st.target), ...s.checks.map(c => c.target)]));
  const targets = Object.fromEntries([...pinned].filter(([id]) => used.has(id)));
  return structuredClone({ version: 1 as const, requirements, features: draft.features ?? [], scenarios: draft.scenarios, unplanned: draft.unplanned,
    observations: draft.observations ?? [], questions, ...(startVerified.length ? { startVerified } : {}), targets });
}

function sameOrigin(url: string, origins: string[]): boolean {
  try { return origins.includes(new URL(url).origin); } catch { return false; }
}

/** 시작 상태에서 쓰는 대상 중 시작 URL이 아닌 페이지에서 pin한 것: 시작 URL을 새로 열어 확인할 후보. */
export function startTargetsElsewhere(draft: Draft, pinned: Map<string, Pinned>): { id: string; url: string }[] {
  const out = new Map<string, { id: string; url: string }>();
  for (const s of draft.scenarios ?? []) {
    const ids = [s.steps?.[0]?.target, ...(s.checks ?? []).filter(c => c.after === 'start').map(c => c.target)];
    for (const id of ids) {
      const p = id ? pinned.get(id) : undefined;
      if (id && p && page(p.url) !== page(s.start?.url ?? '')) out.set(`${id} ${s.start.url}`, { id, url: s.start.url });
    }
  }
  return [...out.values()];
}

/** 같은 페이지인지 비교하기 위한 URL (hash 제외). */
function page(url: string): string {
  try { const u = new URL(url); return u.origin + u.pathname + u.search; } catch { return url; }
}
