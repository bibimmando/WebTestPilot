// ④ 실패 분류와 ⑤ 후보 재실행. 먼저 실행 기록만으로 분류하고, 애매한 항목만 AI가 증거를 인용해 분류한다.
// 분류는 판정이 아니라 후보 상태다. 결함 후보는 최초 실행에 고정된 입력으로 한 번 재실행해 재현 여부를 별도로 남긴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Policy } from './browser.ts';
import type { Plan } from './plan.ts';
import { ruleOf } from './rules.ts';
import { sequence } from './generate.ts';
import { runPlan, type RunResult } from './run.ts';
import type { ScenarioResult } from './reconcile.ts';
import { runAgent, type Budget, type Send, type Tool } from './agent.ts';

const SYSTEM = readFileSync(new URL('../prompts/triage.md', import.meta.url), 'utf8');
const EVIDENCE_CHARS = 30_000;
const MIN_QUOTE = 6;

export type Class = 'passed' | 'passed_inferred' | 'passed_observed' | 'mismatch' | 'not_run' | 'invalid' | 'uncertain_execution'
  | 'precondition_failed'
  | 'needs_triage' | 'app_defect_candidate' | 'automation_failure' | 'uncertain';
export type Quote = { file: string; text: string };
export type Verdict = {
  id: string; scenario: string; kind: 'start' | 'act' | 'check';
  /** 이 항목이 영향을 주는 요구사항. check는 출처 요구사항, start·act는 시나리오의 covers 전체(기능 F#도 포함). 자율 검사의 기능은 시나리오 covers로 찾는다. */
  requirements: string[];
  source?: string;
  /** 실행 기록에서 본 결과 (예: mismatch, not_executed:target_changed:0, error) */
  observed: string;
  error?: string;
  class: Class;
  /** not_run이면 시나리오를 멈춘 항목 */
  cause?: string;
  triage?: { reason: string; quotes: Quote[] } | { error: string };
  /** 분류 대화 기록 (실행 폴더 기준 경로) */
  triageLog?: string;
  reproduction?: 'reproduced' | 'flaky' | 'reproduction_inconclusive';
  reproductionDetail?: string;
  /** 단계별 결과 위에 붙이는 시스템 판정 (설계 3.3, 5장 6단계) */
  system?: { level: SystemLevel; reason: string };
};
export type SystemLevel = 'bug_high' | 'bug_medium' | 'not_bug' | 'hold' | 'incomplete';

/** 실행 기록만으로 하는 1차 분류. 실패 위치만으로 원인을 정하지 않고, 원인을 모르는 실패는 needs_triage로 둔다. */
export function preclassify(plan: Plan, run: RunResult): Verdict[] {
  const out: Verdict[] = [];
  for (const s of plan.scenarios) {
    const r = run.scenarios.find(x => x.id === s.id)!;
    if (!r.valid) {
      for (const c of s.checks) out.push({ id: c.id, scenario: s.id, kind: 'check', ...origin(c), observed: 'invalid', class: 'invalid', cause: r.invalid.join('; ') });
      continue;
    }
    // 실행 순서대로 훑으며, 시나리오를 멈춘 첫 항목을 뒤의 not_run 원인으로 삼는다.
    let cause: string | undefined;
    for (const x of sequence(s)) {
      if (x.call === 'start') {
        if (r.start === 'failed') {
          cause = s.id;
          out.push({ id: s.id, scenario: s.id, kind: 'start', requirements: s.covers, observed: 'start_failed', class: 'needs_triage' });
        }
      } else if (x.call === 'act') {
        const st = r.steps.find(y => y.id === x.id)!;
        if (st.status === 'not_executed' || st.status === 'uncertain_execution') {
          cause ??= st.id;
          out.push({ id: st.id, scenario: s.id, kind: 'act', requirements: s.covers, observed: [st.status, st.reason, st.count].filter(v => v !== undefined).join(':'),
            ...(st.error ? { error: st.error } : {}), class: st.status === 'uncertain_execution' ? 'uncertain_execution' : 'needs_triage' });
        }
      } else {
        const c = s.checks.find(y => y.id === x.id)!;
        const res = r.checks.find(y => y.id === x.id)!;
        const base = { id: c.id, scenario: s.id, kind: 'check' as const, ...origin(c), ...(res.error ? { error: res.error } : {}) };
        // 근거가 약한 통과는 따로 센다. 관찰값 근거의 통과는 시작 상태 확인이지 기능 검사 통과가 아니다.
        if (res.status === 'passed') out.push({ ...base, observed: 'passed', class: c.source.kind === 'inferred' ? 'passed_inferred' : c.source.kind === 'observed' ? 'passed_observed' : 'passed' });
        // 선행조건 실패는 검사할 상태를 만들지 못한 것이다. 결함 후보로 세지 않고 뒤 항목의 원인으로 남긴다.
        else if (res.status === 'not_run') out.push({ ...base, observed: 'not_run', class: 'not_run', cause: cause ?? '알 수 없음' });
        else if (c.precondition) {
          cause ??= c.id;
          out.push({ ...base, observed: `precondition:${[res.status, res.count].filter(v => v !== undefined).join(':')}`, class: 'precondition_failed' });
        }
        else if (res.status === 'mismatch') out.push({ ...base, observed: 'mismatch', class: 'mismatch' });
        else {
          if (res.status === 'error') cause ??= c.id;
          out.push({ ...base, observed: [res.status, res.count].filter(v => v !== undefined).join(':'), class: 'needs_triage' });
        }
      }
    }
  }
  return out;
}

const origin = (c: Plan['scenarios'][number]['checks'][number]) =>
  ({ source: c.source.kind, requirements: c.source.kind === 'requirement' && c.source.id ? [c.source.id] : [] });

/**
 * needs_triage와 mismatch 항목마다 별도 대화로 AI가 분류한다. 결정적인 자동화 오류(예: 읽기 방식 차이)도
 * 재현되므로 mismatch도 분류한다. 분류는 원래 비교 결과(observed) 위에 덧붙이며 지우지 않는다.
 * 인용은 제공한 증거 파일에 그대로 있어야 하고, 실패 시점 증거가 있으면 그중 하나 이상을 인용해야 한다.
 * 분류하지 못한 mismatch는 mismatch로 남겨 재현 대상에 둔다. 대화 기록은 triage/에 남긴다.
 */
export async function triage(o: { plan: Plan; run: RunResult; verdicts: Verdict[]; send: Send; model: string; budget: Budget;
  maxItems?: number; onUpdate?: () => void; logDir?: string }): Promise<void> {
  // 판정 회차마다 다른 폴더에 대화를 남긴다. 다시 판정해도 이전 분류의 대화·사용량이 덮이지 않는다.
  const logDir = o.logDir ?? 'triage';
  let used = 0;
  const unclassified = (v: Verdict, error: string) => {
    v.class = v.observed === 'mismatch' ? 'mismatch' : 'uncertain';
    v.triage = { error };
  };
  for (const v of o.verdicts.filter(x => x.class === 'needs_triage' || x.class === 'mismatch')) {
    if (used++ >= (o.maxItems ?? 20)) {
      unclassified(v, '분류 항목 수 한도 초과');
      continue;
    }
    const s = o.plan.scenarios.find(x => x.id === v.scenario)!;
    const r = o.run.scenarios.find(x => x.id === v.scenario)!;
    const { files, own } = evidenceFor(o.run.runDir, v, r, o.plan);
    let accepted: { class: Class; reason: string; quotes: Quote[] } | undefined;
    const classify: Tool = {
      def: { name: 'classify', description: '실패 한 건의 분류와 근거 인용을 제출한다.', strict: true, input_schema: {
        type: 'object', additionalProperties: false, required: ['class', 'reason', 'quotes'],
        properties: {
          class: { enum: ['app_defect_candidate', 'automation_failure', 'uncertain'] },
          reason: { type: 'string' },
          quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['file', 'text'],
            properties: { file: { type: 'string' }, text: { type: 'string' } } } },
        } } },
      run: async (input: { class: Class; reason: string; quotes: Quote[] }) => {
        const errors = checkQuotes(input, files, own);
        if (errors.length) return { text: `고쳐서 다시 제출하세요:\n- ${errors.join('\n- ')}`, isError: true };
        accepted = { class: input.class, reason: input.reason, quotes: input.quotes };
        return { text: '받았습니다.', done: true };
      },
    };
    const result = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools: [classify],
      user: triageMessage(o.plan, s, v, files, r), budget: o.budget, maxTurns: 3, maxTokens: 4000 });
    mkdirSync(join(o.run.runDir, logDir), { recursive: true });
    v.triageLog = `${logDir}/${v.id}.json`;
    writeFileSync(join(o.run.runDir, v.triageLog), JSON.stringify({ stop: result.stop, detail: result.detail, turns: result.turns }, null, 2));
    if (accepted) {
      v.class = accepted.class;
      v.triage = { reason: accepted.reason, quotes: accepted.quotes };
    } else {
      unclassified(v, `분류 미완료: ${result.stop}${result.detail ? ` (${result.detail})` : ''}`);
    }
    o.onUpdate?.();
  }
}

/**
 * 이 항목에 쓸 수 있는 증거: 실패 시점 snapshot(own), 같은 시나리오의 시작 snapshot, 그리고 관련 행동의 직전·직후 snapshot
 * (검사면 그 검사 직전 행동, 행동이면 그 행동의 직전). 다른 시나리오의 증거는 주지 않는다.
 */
function evidenceFor(runDir: string, v: Verdict, r: ScenarioResult, plan: Plan): { files: Map<string, string>; own: Set<string> } {
  const step = v.kind === 'act' ? r.steps.find(x => x.id === v.id) : undefined;
  const ownPaths = (v.kind === 'start' ? r.startEvidence ?? []
    : v.kind === 'act' ? (step?.evidence ?? []).filter(p => !p.includes('.before.'))
    : r.checks.find(x => x.id === v.id)?.evidence ?? []).filter(p => p.endsWith('.txt'));
  const after = v.kind === 'check' ? plan.scenarios.flatMap(s => s.checks).find(c => c.id === v.id)?.after : undefined;
  const actionPaths = v.kind === 'act' ? step?.before ?? (step?.evidence ?? []).filter(p => p.includes('.before.'))
    : after && after !== 'start' ? r.steps.find(x => x.id === after)?.evidence ?? [] : [];
  const paths = [...new Set([...ownPaths, ...(r.startEvidence ?? []), ...actionPaths])].filter(p => p.endsWith('.txt') && existsSync(join(runDir, p)));
  return { files: new Map(paths.map(p => [p, readFileSync(join(runDir, p), 'utf8')])), own: new Set(ownPaths.filter(p => paths.includes(p))) };
}

/**
 * 실패 항목까지의 행동 기록(최근 10개). 검사면 그 검사 직전 행동까지, 행동이면 그 행동까지.
 * fill의 입력 원문은 넘기지 않는다(비밀번호·토큰일 수 있다). 길이만 준다.
 */
export function actionsUpTo(s: Plan['scenarios'][number], v: Verdict, r: ScenarioResult, targets: Plan['targets'] = {}) {
  const last = v.kind === 'act' ? v.id : v.kind === 'check' ? s.checks.find(c => c.id === v.id)?.after : 'start';
  const upTo = last === 'start' ? 0 : s.steps.findIndex(st => st.id === last) + 1;
  return s.steps.slice(0, upTo).slice(-10).map(st => {
    const res = r.steps.find(x => x.id === st.id);
    const value = st.value === undefined ? {} : st.op === 'fill' ? { valueLength: st.value.length } : { value: st.value };
    // 계획된 대상 설명. 이름 없는 아이콘 버튼은 접근성 표현만으로 어느 버튼인지 모르므로, 라벨 영역·순서(anchor·nth·of)로 무엇을 눌렀는지 알린다.
    const target = st.target ? targets[st.target]?.target : undefined;
    return { id: st.id, op: st.op, ...value, ...(target ? { target } : {}), status: res?.status ?? 'not_run',
      pressed: res?.pressed ?? null, urlBefore: res?.urlBefore ?? null, urlAfter: res?.url ?? null };
  });
}

export function checkQuotes(input: { class: string; quotes: Quote[] }, files: Map<string, string>, own: Set<string>): string[] {
  const errors: string[] = [];
  if (input.class !== 'uncertain' && !input.quotes.length) errors.push('uncertain이 아니면 근거 인용이 하나 이상 필요하다');
  if (input.class !== 'uncertain' && own.size && !input.quotes.some(q => own.has(q.file))) {
    errors.push(`실패 시점 증거(${[...own].join(', ')})에서 하나 이상 인용해야 한다`);
  }
  for (const q of input.quotes) {
    const text = files.get(q.file);
    if (text === undefined) errors.push(`제공되지 않은 파일: ${q.file}`);
    else if (q.text.replace(/\s/g, '').length < MIN_QUOTE || !text.includes(q.text)) {
      errors.push(`${q.file}에 그대로 있는 원문이어야 하고 공백 제외 ${MIN_QUOTE}자 이상이어야 함: ${JSON.stringify(q.text)}`);
    }
  }
  return errors;
}

function triageMessage(plan: Plan, s: Plan['scenarios'][number], v: Verdict, files: Map<string, string>, r: ScenarioResult): string {
  const item = v.kind === 'start' ? { start: s.start }
    : v.kind === 'act' ? s.steps.find(x => x.id === v.id)
    : s.checks.find(x => x.id === v.id);
  const targetId = (item as { target?: string } | undefined)?.target;
  // 검사는 기대·실제·읽기 방식·시점을 필드로 넘긴다. 문장 요약만 주면 읽기 방식 차이 같은 자동화 원인을 가리기 어렵다.
  const c = v.kind === 'check' ? s.checks.find(x => x.id === v.id)! : undefined;
  const res = c ? r.checks.find(x => x.id === c.id) : undefined;
  // 관측 참조면 expected는 참조한 검사가 실제로 읽은 값이고, 무엇을 참조했는지(expectedFrom)도 함께 넘긴다.
  const comparison = c && res ? { read: c.read, op: c.op, expected: res.expected ?? null, ...(c.expected_from ? { expectedFrom: c.expected_from } : {}),
    actual: res.actual ?? null, matchedElements: res.count ?? null, after: c.after, expectationBasis: c.source.kind,
    reads: res.reads ?? null, waitedMs: res.waitedMs ?? null, ...(res.first ? { firstRead: res.first } : {}),
    ...(res.reason ? { reason: res.reason } : {}), evidenceFiles: res.evidence ?? [] } : undefined;
  return [
    '요구사항:', ...plan.requirements.filter(q => s.covers.includes(q.id)).map(q => `- ${q.id}: ${q.text}`),
    `시나리오 ${s.id}: ${s.title}`,
    `실패한 항목 ${v.id}: ${JSON.stringify(item)}`,
    ...(targetId ? [`대상 ${targetId}: ${JSON.stringify(plan.targets[targetId])} (탐색 때 유일하게 찾은 요소)`] : []),
    `실행 기록: ${v.observed}`,
    `시작 화면: ${r.ready === false ? '기한 안에 멈추지 않음(로딩 중일 수 있음)' : '멈춘 뒤 기록'}, 선행조건 ${r.precondition}`,
    ...(comparison ? [`비교 기록: ${JSON.stringify(comparison)}`] : []),
    // 이 항목까지 실제로 한 행동: 누른 요소의 접근성 표현·화면 위치, 행동 전후 URL. 자동화가 다른 것을 눌렀는지 가르는 근거다.
    `행동 기록: ${JSON.stringify(actionsUpTo(s, v, r, plan.targets))}`,
    // 일반 규칙 근거면 규칙 본문·적용 조건·정상 예외를 함께 준다. 예외에 해당하면 결함이 아니다.
    ...(ruleOf(c?.source.rule) ? [`일반 규칙 ${c!.source.rule}: ${JSON.stringify(ruleOf(c!.source.rule))}`] : []),
    ...(v.error ? [`오류 원문: ${v.error}`] : []),
    '증거 파일 (*.start는 시작 직후, *.before·*.after는 그 행동의 직전·직후, 나머지는 실패 시점):',
    ...[...files].map(([name, text]) => `--- ${name}\n${text.length > EVIDENCE_CHARS ? `${text.slice(0, EVIDENCE_CHARS)}\n(이후 생략: 생략된 부분 없이 판단할 수 없으면 uncertain)` : text}`),
  ].join('\n');
}

/**
 * 결함 후보(원래 불일치이거나 AI가 결함 후보로 본 항목)의 시나리오를 최초 실행 폴더에 고정된 plan·정책으로 한 번 재실행한다.
 * 실행 코드가 최초와 다르거나, 재실행이 무효이거나, 재실행에서 선행조건(시작 조건)이 통과하지 못하면 reproduction_inconclusive.
 * 화면 전체 지문은 쓰지 않는다: 목록 순서·추천처럼 매번 바뀌는 영역 때문에 같은 시작 상태도 다르게 보인다.
 * 선행조건이 없는 시나리오는 시작 URL만 같다는 뜻이므로 결과에 그렇게 적는다.
 */
export async function reproduce(o: { run: RunResult; verdicts: Verdict[]; runDir: string; timeoutMs?: number }): Promise<RunResult | undefined> {
  // 원래 불일치는 AI 분류 결과와 상관없이 재현한다. 자동화 문제로 분류돼도 재현 여부는 별도 정보다.
  const candidates = o.verdicts.filter(isCandidate);
  if (!candidates.length) return undefined;
  const plan: Plan = JSON.parse(readFileSync(join(o.run.runDir, 'plan.json'), 'utf8'));
  const policy: Policy = JSON.parse(readFileSync(join(o.run.runDir, 'policy.json'), 'utf8'));
  const firstManifest = JSON.parse(readFileSync(join(o.run.runDir, 'manifest.json'), 'utf8'));
  const again = await runPlan({ plan, policy, runDir: o.runDir, timeoutMs: o.timeoutMs ?? firstManifest.timeoutMs,
    only: [...new Set(candidates.map(v => v.scenario))] });
  const secondManifest = JSON.parse(readFileSync(join(o.runDir, 'manifest.json'), 'utf8'));
  const changed = Object.keys(firstManifest.files).filter(k => k.startsWith('src/') && firstManifest.files[k] !== secondManifest.files[k]);
  for (const v of candidates) {
    const first = o.run.scenarios.find(x => x.id === v.scenario)!;
    const second = again.scenarios.find(x => x.id === v.scenario)!;
    const inconclusive = (detail: string) => { v.reproduction = 'reproduction_inconclusive'; v.reproductionDetail = detail; };
    if (changed.length) { inconclusive(`실행 코드가 최초와 다름: ${changed.join(', ')}`); continue; }
    if (!second.valid) { inconclusive(`재실행 무효: ${second.invalid.join('; ')}`); continue; }
    if (second.precondition === 'failed') { inconclusive('재실행에서 선행조건(시작 조건)이 통과하지 못함'); continue; }
    const relative = plan.scenarios.flatMap(s => s.checks).find(c => c.id === v.id)?.expected_from !== undefined;
    const before = signature(first, v, relative);
    const after = signature(second, v, relative);
    if (after === before) {
      v.reproduction = 'reproduced';
      const c2 = second.checks.find(x => x.id === v.id);
      v.reproductionDetail = [second.precondition === 'none' ? '시작 조건 미선언(URL만 확인)' : '',
        relative && c2 ? `관측 참조 재실행: 기대 ${JSON.stringify(c2.expected ?? null)}, 실제 ${JSON.stringify(c2.actual ?? null)}` : ''].filter(Boolean).join('; ') || undefined;
    }
    else if (after === 'passed' || after === 'ok') { v.reproduction = 'flaky'; v.reproductionDetail = `재실행 결과: ${after}`; }
    else inconclusive(`재실행 결과가 다름: ${after}`);
  }
  return again;
}

/**
 * 시스템 판정. 실행·분류·재현이 끝나지 않은 항목은 판정하지 않고(incomplete) 사유를 남긴다. 끝난 항목은 반드시 판정한다.
 * 확신 높음은 명시 근거(요구사항·화면 제약) 위반이 재현되고 AI 분류가 자동화 실패가 아님을 보였을 때만이다.
 * 일반 규칙(inferred) 위반은 Q22 팀 확인 전까지 최대 확신 중간이다.
 * shortcut: 업무 규칙 질문에 걸린 판단 보류와 UI 결함·개선 제안은 아직 없다. 질문은 plan.questions로 따로 보고한다.
 */
export function systemVerdict(plan: Plan, v: Verdict): NonNullable<Verdict['system']> {
  const incomplete = (reason: string) => ({ level: 'incomplete' as const, reason });
  if (v.class === 'passed' || v.class === 'passed_inferred' || v.class === 'passed_observed') return { level: 'not_bug', reason: '검사 통과' };
  if (v.class === 'automation_failure') return { level: 'not_bug', reason: '자동화 실패로 분류(원래 결과는 보존)' };
  if (v.class !== 'app_defect_candidate') return incomplete(({ invalid: '무효 시나리오', not_run: `실행 안 됨(원인 ${v.cause ?? '알 수 없음'})`,
    uncertain_execution: '실행 여부 불명확', precondition_failed: '시작 조건 준비 실패', uncertain: 'AI 분류가 판단 불가',
    mismatch: '분류 미완료', needs_triage: '분류 미완료' } as Partial<Record<Class, string>>)[v.class] ?? v.class);
  // 값을 읽어 비교한 불일치만 판정한다. 대상 미해결·오류는 같은 실패가 재현돼도 결함 근거가 아니다.
  if (v.kind === 'check' && v.observed !== 'mismatch') return incomplete(`실제 값을 읽지 못함(${v.observed})`);
  if (v.reproduction === 'flaky') return { level: 'hold', reason: `재실행에서 재현 안 됨${v.reproductionDetail ? `: ${v.reproductionDetail}` : ''}` };
  if (v.reproduction !== 'reproduced') return incomplete(`재현 판단 불가${v.reproductionDetail ? `: ${v.reproductionDetail}` : ''}`);
  if (v.source === 'requirement' || v.source === 'constraint') return { level: 'bug_high', reason: `${v.source === 'requirement' ? '요구사항' : '화면 제약'} 위반, 재현됨, 증거 인용으로 자동화 실패 아님` };
  if (v.source === 'observed') return incomplete('탐색 때 본 값과 시작 상태가 다름(결함 근거 아님)');
  // 행동 실패(대상 사라짐 등)는 규칙 근거가 없다. 앱 변경인지 결함인지 사람이 볼 항목으로 둔다.
  if (v.kind !== 'check') return { level: 'hold', reason: `행동 실패가 재현됨(${v.observed}). 의도된 변경인지 근거 없음` };
  const c = plan.scenarios.flatMap(s => s.checks).find(x => x.id === v.id);
  return { level: 'bug_medium', reason: `일반 규칙 ${c?.source.rule ?? '?'} 위반, 재현됨 (Q22 팀 확인 전 상한)` };
}

const isCandidate = (v: Verdict) => v.observed === 'mismatch' || v.class === 'app_defect_candidate';

/** 같은 결과인지 비교하는 서명. 오류 문구의 숫자(시간 등)는 지우고 비교한다. */
function signature(r: ScenarioResult, v: Verdict, relative = false): string {
  const err = (e?: string) => (e ?? '').replace(/\d+/g, '#');
  if (v.kind === 'check') {
    const c = r.checks.find(x => x.id === v.id)!;
    // 관측 참조 검사는 참조한 값(예: 바뀌는 추천 카드 이름)이 회차마다 달라도 같은 규칙이 다시 깨지면 같은 결과다. 값은 detail에 남긴다.
    if (relative) return c.status === 'passed' ? 'passed' : `${c.status}|${c.count ?? ''}|${err(c.error)}`;
    return c.status === 'passed' ? 'passed' : `${c.status}|${c.actual ?? ''}|${c.count ?? ''}|${err(c.error)}`;
  }
  if (v.kind === 'act') {
    const st = r.steps.find(x => x.id === v.id)!;
    return st.status === 'ok' ? 'ok' : `${st.status}|${st.reason ?? ''}|${st.count ?? ''}|${err(st.error)}`;
  }
  return r.start;
}

export type Judgment = { file: string; verdicts: Verdict[]; requirements: { id: string; plan: string; classes: Partial<Record<Class, number>> }[];
  /** 시스템 판정 집계. 요구사항 검사 · 자율 검사 · 준비 확인(선행조건)을 나눈다 */
  system: Record<'requirement' | 'autonomous' | 'preparation', Partial<Record<SystemLevel, number>>>;
  /** 기능(F#)별 계획 여부와 판정 집계(준비 확인 제외), 걸린 질문 */
  features: { id: string; plan: 'planned' | 'unplanned' | 'missing'; system: Partial<Record<SystemLevel, number>>; questions: string[] }[];
  /** 답을 받지 못한 업무 규칙 질문. 관련 기능은 판단 보류 */
  pendingQuestions: Plan['questions'];
};

/**
 * 1차 분류 → AI 분류 → 재현을 거쳐 판정 파일을 쓴다. 단계마다 바로 저장하고, 이전 판정 파일은 덮어쓰지 않는다 (verdicts.json, verdicts-2.json …).
 * 요구사항 분모는 대조 결과를 그대로 쓴다.
 */
export async function judge(o: { plan: Plan; run: RunResult; send: Send; model: string; budget: Budget;
  reproduceDir: string; timeoutMs?: number; maxTriageItems?: number }): Promise<Judgment> {
  let n = 1;
  while (existsSync(join(o.run.runDir, n === 1 ? 'verdicts.json' : `verdicts-${n}.json`))) n++;
  const file = join(o.run.runDir, n === 1 ? 'verdicts.json' : `verdicts-${n}.json`);
  const verdicts = preclassify(o.plan, o.run);
  const checks = new Map(o.plan.scenarios.flatMap(s => s.checks.map(c => [c.id, c] as const)));
  const reqIds = new Set(o.plan.requirements.map(r => r.id));
  const groupOf = (v: Verdict) => checks.get(v.id)?.precondition ? 'preparation' as const
    : v.requirements.some(r => reqIds.has(r)) ? 'requirement' as const : 'autonomous' as const;
  const count = (vs: Verdict[]) => { const n: Partial<Record<SystemLevel, number>> = {}; for (const v of vs) if (v.system) n[v.system.level] = (n[v.system.level] ?? 0) + 1; return n; };
  const judgment = (stage: string): Judgment & { stage: string } => ({ file, stage, verdicts, requirements: o.run.requirements.map(r => {
    const classes: Partial<Record<Class, number>> = {};
    for (const v of verdicts) if (v.requirements.includes(r.id)) classes[v.class] = (classes[v.class] ?? 0) + 1;
    return { id: r.id, plan: r.plan, classes };
  }),
  system: { requirement: count(verdicts.filter(v => groupOf(v) === 'requirement')), autonomous: count(verdicts.filter(v => groupOf(v) === 'autonomous')),
    preparation: count(verdicts.filter(v => groupOf(v) === 'preparation')) },
  // M3 이전에 저장한 계획에는 features·questions가 없다.
  features: (o.plan.features ?? []).map(f => {
    const scenarios = new Set(o.plan.scenarios.filter(s => s.covers.includes(f.id)).map(s => s.id));
    return { id: f.id, plan: scenarios.size ? 'planned' as const : o.plan.unplanned.some(u => u.requirement === f.id) ? 'unplanned' as const : 'missing' as const,
      system: count(verdicts.filter(v => scenarios.has(v.scenario) && groupOf(v) !== 'preparation')),
      questions: (o.plan.questions ?? []).filter(q => q.feature === f.id).map(q => q.id) };
  }),
  pendingQuestions: o.plan.questions ?? [] });
  const save = (stage: string) => writeFileSync(file, JSON.stringify(judgment(stage), null, 2));
  save('preclassified');
  await triage({ plan: o.plan, run: o.run, verdicts, send: o.send, model: o.model, budget: o.budget, maxItems: o.maxTriageItems,
    onUpdate: () => save('triage'), logDir: n === 1 ? 'triage' : `triage-${n}` });
  save('triaged');
  try {
    await reproduce({ run: o.run, verdicts, runDir: o.reproduceDir, timeoutMs: o.timeoutMs });
  } catch (e) {
    for (const v of verdicts) if (isCandidate(v) && !v.reproduction) {
      v.reproduction = 'reproduction_inconclusive';
      v.reproductionDetail = `재실행 실패: ${(e as Error).message.split('\n')[0]}`;
    }
  }
  for (const v of verdicts) v.system = systemVerdict(o.plan, v);
  save('done');
  return judgment('done');
}
