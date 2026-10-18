// ledger ↔ plan 대조. ledger가 판정의 기준이지만 ledger를 그대로 믿지 않는다.
// 비교 결과는 고정된 plan의 기대값과 기록된 실제 값으로 다시 계산하고, 순서·중복·정책 위반이 있는 시나리오는 무효로 집계한다.
// 코드에 있어도 실행되지 않은 검사는 not_run이다. 상태는 차원별로 나누고 분모에서 빼지 않는다.
import { compareValues, sortKeys, expectedFrom, type Plan, type Check } from './plan.ts';
import { sequence } from './generate.ts';
import type { Signal } from './browser.ts';

export type Entry = { kind: 'start' | 'act' | 'check' | 'policy'; at: string; scenario?: string; id?: string; status?: string;
  actual?: string; expected?: string; count?: number; reason?: string; error?: string; blocked?: string[]; violations?: string[]; signals?: Signal[]; signalsDropped?: number;
  ready?: boolean; evidence?: string[];
  /** act: 행동 직전에 관측한 대상의 접근성 표현·화면 위치(또는 누른 키), 행동 직전 URL, 실패한 행동의 직전 증거, 직후 증거를 찍는 데 걸린 시간 */
  pressed?: { aria?: string; box?: { x: number; y: number; width: number; height: number } | null; key?: string };
  urlBefore?: string; url?: string; before?: string[]; afterCaptureMs?: number;
  /** check: 다시 읽은 횟수·기다린 시간·첫 읽기 */
  reads?: number; waitedMs?: number; first?: { status: string; actual?: string };
  /** check(visual): 촬영 때 화면 크기·스크롤 위치·대상 위치. 재현은 같은 크기·스크롤일 때만 비교한다 */
  visual?: VisualShot };
export type VisualShot = { viewport: { width: number; height: number } | null; scroll: { x: number; y: number }; box: { x: number; y: number; width: number; height: number } | null; image: string; ready?: boolean };

export type StepResult = { id: string; status: 'ok' | 'not_executed' | 'uncertain_execution' | 'not_run'; reason?: string; error?: string;
  count?: number; evidence?: string[]; pressed?: Entry['pressed']; urlBefore?: string; url?: string; before?: string[] };
/** visual_pending: 시각 검사를 촬영했고 판정은 시각 판정이 한다 */
export type CheckStatus = 'passed' | 'mismatch' | 'unresolved' | 'error' | 'not_run' | 'visual_pending';
/** expected는 관측 참조면 참조한 검사의 실제 값으로 푼 값이다 (없으면 비어 있다). */
export type CheckResult = { id: string; status: CheckStatus; source: string; precondition?: boolean; expected?: string; actual?: string; count?: number;
  reason?: string; error?: string; evidence?: string[]; reads?: number; waitedMs?: number; first?: Entry['first']; visual?: VisualShot };
export type ScenarioResult = {
  id: string; valid: boolean; invalid: string[];
  start: 'ok' | 'failed' | 'not_run'; ready?: boolean; startEvidence?: string[];
  /** 선행조건 검사 결과: 없음(시작 조건 미선언) · 모두 통과 · 실패 */
  precondition: 'none' | 'met' | 'failed';
  steps: StepResult[]; checks: CheckResult[];
  blocked: string[]; violations: string[];
  /** 기대값 없이 잡힌 콘솔·요청 오류. 판정이 아니라 검토 대상이다 */
  signals?: Signal[];
  /** 단계별 상한을 넘어 버린 신호 수 */
  signalsDropped?: number;
};
/** checks의 invalid는 무효 시나리오에 속해 결과를 믿을 수 없는 검사 수다. */
export type RequirementResult = { id: string; plan: 'planned' | 'unplanned' | 'missing'; checks: Record<CheckStatus | 'invalid', number> };
export type Reconciled = { scenarios: ScenarioResult[]; requirements: RequirementResult[]; problems: string[] };

const STEP = new Set(['ok', 'not_executed', 'uncertain_execution']);
const CHECK = new Set(['passed', 'mismatch', 'unresolved', 'error', 'visual_pending']);

export function reconcile(plan: Plan, entries: Entry[]): Reconciled {
  const problems: string[] = [];
  const checksById = new Map(plan.scenarios.flatMap(s => s.checks.map(c => [c.id, c] as const)));

  const scenarios = plan.scenarios.map((s): ScenarioResult => {
    const invalid: string[] = [];
    const flag = (msg: string) => { invalid.push(msg); problems.push(`${s.id}: ${msg}`); };
    const mine = entries.filter(e => (e.kind === 'start' || e.kind === 'policy') ? e.scenario === s.id : e.id?.startsWith(`${s.id}.`));
    const records = mine.filter(e => e.kind !== 'policy');
    const policy = mine.filter(e => e.kind === 'policy');

    // 실행된 기록은 계획된 순서의 앞부분과 정확히 같아야 한다. 중복도 여기서 순서 위반으로 드러난다.
    const expected = sequence(s).map(x => `${x.call}:${x.id}`);
    records.forEach((e, i) => {
      const k = `${e.kind}:${e.kind === 'start' ? e.scenario : e.id}`;
      if (k !== expected[i]) flag(`${i + 1}번째 기록이 ${k} (계획 순서는 ${expected[i] ?? '끝'})`);
    });
    const get = (kind: string, id: string) => records.find(e => e.kind === kind && (kind === 'start' ? e.scenario : e.id) === id);

    // 관측 참조는 ledger에 기록된 기대값을 믿지 않고, 참조한 검사의 기록된 실제 값으로 다시 푼다.
    const expectedOf = (c: Check) => {
      if (c.expected_from === undefined) return c.expected;
      // 값을 정상적으로 읽은 기록(통과·불일치)만 참조값이 된다. 미해결·오류 기록의 actual은 쓰지 않는다.
      const ref = get('check', c.expected_from);
      return ref && (ref.status === 'passed' || ref.status === 'mismatch') && typeof ref.actual === 'string' ? expectedFrom(c, ref.actual) : undefined;
    };
    const startEntry = get('start', s.id);
    const start = startEntry?.status === 'ok' || startEntry?.status === 'failed' ? startEntry.status : 'not_run';
    if (start !== 'ok' && records.length > (startEntry ? 1 : 0)) flag('시작하지 못했는데 뒤 기록이 있음');
    if (records.length && !policy.length) flag('정책 기록(policy)이 없음');
    const violations = policy.flatMap(e => e.violations ?? []);
    if (violations.length) flag(`정책 위반: ${violations.join(', ')}`);

    const steps = s.steps.map((st): StepResult => {
      const e = get('act', st.id);
      if (e && !STEP.has(e.status ?? '')) flag(`${st.id}: 알 수 없는 상태 ${e.status}`);
      const status = e && STEP.has(e.status ?? '') ? e.status as StepResult['status'] : 'not_run';
      return { id: st.id, status, ...pick(e, 'reason', 'error', 'count', 'evidence', 'pressed', 'urlBefore', 'url', 'before') };
    });
    // 멈춘 행동 뒤에 기록이 더 있으면 헬퍼 계약이 깨진 것이다.
    const stoppedAt = steps.findIndex(x => x.status === 'not_executed' || x.status === 'uncertain_execution');
    if (stoppedAt >= 0 && s.steps.slice(stoppedAt + 1).some(st => get('act', st.id))) flag(`${steps[stoppedAt].id}에서 멈췄는데 뒤 행동 기록이 있음`);

    const checks = s.checks.map((c): CheckResult => {
      const e = get('check', c.id);
      let status: CheckStatus = 'not_run';
      if (e) {
        status = CHECK.has(e.status ?? '') ? e.status as CheckStatus : 'error';
        // 시각 검사는 촬영만 기록한다. 다른 상태(통과·불일치)를 적은 기록은 헬퍼 계약 위반이다.
        if ((c.read === 'visual') !== (status === 'visual_pending') && (status === 'passed' || status === 'mismatch' || status === 'visual_pending')) {
          flag(`${c.id}: 시각 검사와 기록 상태가 맞지 않음(${e.status})`);
          status = 'error';
        }
        if (status === 'passed' || status === 'mismatch') {
          const recomputed = compare(c, e.actual, expectedOf(c));
          if (recomputed !== status) flag(`${c.id}: 기록된 ${e.status}와 다시 계산한 ${recomputed}가 다름`);
          status = recomputed;
        }
      }
      const expected = expectedOf(c);
      return { id: c.id, status, source: c.source.kind, ...(c.precondition ? { precondition: true } : {}), ...(expected === undefined ? {} : { expected }),
        ...pick(e, 'actual', 'count', 'reason', 'error', 'evidence', 'reads', 'waitedMs', 'first', 'visual') };
    });
    // 선행조건이 통과하지 못하면 fixture가 멈춘다. 그 뒤 행동 기록이 있으면 헬퍼 계약이 깨진 것이다.
    const pre = s.checks.filter(c => c.precondition);
    const failedPre = pre.find(c => checks.find(x => x.id === c.id)!.status !== 'passed' && get('check', c.id));
    if (failedPre) {
      const at = expected.indexOf(`check:${failedPre.id}`);
      if (records.length > at + 1) flag(`선행조건 ${failedPre.id}가 통과하지 못했는데 뒤 기록이 있음`);
    }
    const precondition = !pre.length ? 'none' : failedPre ? 'failed'
      : pre.every(c => checks.find(x => x.id === c.id)!.status === 'passed') ? 'met' : 'failed';

    return { id: s.id, valid: invalid.length === 0, invalid, start, precondition, ...(startEntry?.ready !== undefined ? { ready: startEntry.ready } : {}),
      ...(startEntry?.evidence ? { startEvidence: startEntry.evidence } : {}), steps, checks, blocked: policy.flatMap(e => e.blocked ?? []), violations,
      signals: policy.flatMap(e => e.signals ?? []), ...(policy.some(e => e.signalsDropped) ? { signalsDropped: policy.reduce((n, e) => n + (e.signalsDropped ?? 0), 0) } : {}) };
  });

  const known = new Set(plan.scenarios.flatMap(s => [s.id, ...s.steps.map(x => x.id), ...s.checks.map(x => x.id)]));
  for (const e of entries) {
    const id = e.kind === 'start' || e.kind === 'policy' ? e.scenario : e.id;
    if (!id || !known.has(id)) problems.push(`plan에 없는 ID가 ledger에 있음: ${id}`);
  }

  const resultOf = new Map(scenarios.flatMap(s => s.checks.map(c => [c.id, { c, valid: s.valid }] as const)));
  const requirements = plan.requirements.map((r): RequirementResult => {
    const counts = { passed: 0, mismatch: 0, unresolved: 0, error: 0, not_run: 0, visual_pending: 0, invalid: 0 };
    for (const [id, c] of checksById) {
      if (c.source.kind !== 'requirement' || c.source.id !== r.id) continue;
      const { c: res, valid } = resultOf.get(id)!;
      counts[valid ? res.status : 'invalid']++;
    }
    const covered = plan.scenarios.some(s => s.covers.includes(r.id));
    const plan_ = covered ? 'planned' : plan.unplanned.some(u => u.requirement === r.id) ? 'unplanned' : 'missing';
    return { id: r.id, plan: plan_, checks: counts };
  });
  return { scenarios, requirements, problems };
}

/** 기록에서 값이 있는 필드만 옮긴다. */
function pick<K extends keyof Entry>(e: Entry | undefined, ...keys: K[]): Partial<Pick<Entry, K>> {
  return Object.fromEntries(keys.filter(k => e?.[k] !== undefined).map(k => [k, e![k]])) as Partial<Pick<Entry, K>>;
}

/** 고정된 plan의 연산·기대값으로 비교를 다시 계산한다. 실제 값이나 기대값이 없으면 비교할 수 없다. */
function compare(c: Check, actual: string | undefined, expected: string | undefined): CheckStatus {
  if (typeof actual !== 'string' || expected === undefined) return 'error';
  // 실행기와 같이, 정렬 기준을 특정할 수 없으면 결함이 아니라 값을 못 읽은 것이다.
  if (c.op.startsWith('sorted_') && !sortKeys(actual, expected)) return 'unresolved';
  return compareValues(c.op, actual, expected) ? 'passed' : 'mismatch';
}
