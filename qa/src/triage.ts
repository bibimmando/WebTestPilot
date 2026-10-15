// ④ 실패 분류와 ⑤ 후보 재실행. 먼저 실행 기록만으로 분류하고, 애매한 항목만 AI가 증거를 인용해 분류한다.
// 분류는 판정이 아니라 후보 상태다. 결함 후보는 최초 실행에 고정된 입력으로 한 번 재실행해 재현 여부를 별도로 남긴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Policy } from './browser.ts';
import type { Plan } from './plan.ts';
import { sequence } from './generate.ts';
import { runPlan, type RunResult } from './run.ts';
import type { ScenarioResult } from './reconcile.ts';
import { runAgent, type Budget, type Send, type Tool } from './agent.ts';

const SYSTEM = readFileSync(new URL('../prompts/triage.md', import.meta.url), 'utf8');
const EVIDENCE_CHARS = 30_000;
const MIN_QUOTE = 6;

export type Class = 'passed' | 'passed_heuristic' | 'mismatch' | 'not_run' | 'invalid' | 'uncertain_execution'
  | 'needs_triage' | 'app_defect_candidate' | 'automation_failure' | 'uncertain';
export type Quote = { file: string; text: string };
export type Verdict = {
  id: string; scenario: string; kind: 'start' | 'act' | 'check';
  /** 이 항목이 영향을 주는 요구사항. check는 출처 요구사항, start·act는 시나리오의 covers 전체. */
  requirements: string[];
  source?: string;
  /** 실행 기록에서 본 결과 (예: mismatch, not_executed:target_changed:0, error) */
  observed: string;
  error?: string;
  class: Class;
  /** not_run이면 시나리오를 멈춘 항목 */
  cause?: string;
  triage?: { reason: string; quotes: Quote[] } | { error: string };
  reproduction?: 'reproduced' | 'flaky' | 'reproduction_inconclusive';
  reproductionDetail?: string;
};

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
        if (res.status === 'passed') out.push({ ...base, observed: 'passed', class: c.source.kind === 'heuristic' ? 'passed_heuristic' : 'passed' });
        else if (res.status === 'mismatch') out.push({ ...base, observed: 'mismatch', class: 'mismatch' });
        else if (res.status === 'not_run') out.push({ ...base, observed: 'not_run', class: 'not_run', cause: cause ?? '알 수 없음' });
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
 * needs_triage 항목마다 별도 대화로 AI가 분류한다. 인용은 제공한 증거 파일에 그대로 있어야 하고,
 * 실패 시점 증거가 있으면 그중 하나 이상을 인용해야 한다. 대화 기록은 triage/에 남긴다.
 */
export async function triage(o: { plan: Plan; run: RunResult; verdicts: Verdict[]; send: Send; model: string; budget: Budget;
  maxItems?: number; onUpdate?: () => void }): Promise<void> {
  let used = 0;
  for (const v of o.verdicts.filter(x => x.class === 'needs_triage')) {
    if (used++ >= (o.maxItems ?? 20)) {
      v.class = 'uncertain';
      v.triage = { error: '분류 항목 수 한도 초과' };
      continue;
    }
    const s = o.plan.scenarios.find(x => x.id === v.scenario)!;
    const r = o.run.scenarios.find(x => x.id === v.scenario)!;
    const { files, own } = evidenceFor(o.run.runDir, v, r);
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
      user: triageMessage(o.plan, s, v, files), budget: o.budget, maxTurns: 3, maxTokens: 4000 });
    mkdirSync(join(o.run.runDir, 'triage'), { recursive: true });
    writeFileSync(join(o.run.runDir, 'triage', `${v.id}.json`), JSON.stringify({ stop: result.stop, detail: result.detail, turns: result.turns }, null, 2));
    if (accepted) {
      v.class = accepted.class;
      v.triage = { reason: accepted.reason, quotes: accepted.quotes };
    } else {
      v.class = 'uncertain';
      v.triage = { error: `분류 미완료: ${result.stop}${result.detail ? ` (${result.detail})` : ''}` };
    }
    o.onUpdate?.();
  }
}

/** 이 항목에 쓸 수 있는 증거: 실패 시점 snapshot(own)과 같은 시나리오의 시작 snapshot. 다른 시나리오의 증거는 주지 않는다. */
function evidenceFor(runDir: string, v: Verdict, r: ScenarioResult): { files: Map<string, string>; own: Set<string> } {
  const ownPaths = (v.kind === 'start' ? r.startEvidence ?? []
    : v.kind === 'act' ? r.steps.find(x => x.id === v.id)?.evidence ?? []
    : r.checks.find(x => x.id === v.id)?.evidence ?? []).filter(p => p.endsWith('.txt'));
  const paths = [...new Set([...ownPaths, ...(r.startEvidence ?? [])])].filter(p => p.endsWith('.txt') && existsSync(join(runDir, p)));
  return { files: new Map(paths.map(p => [p, readFileSync(join(runDir, p), 'utf8')])), own: new Set(ownPaths.filter(p => paths.includes(p))) };
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

function triageMessage(plan: Plan, s: Plan['scenarios'][number], v: Verdict, files: Map<string, string>): string {
  const item = v.kind === 'start' ? { start: s.start }
    : v.kind === 'act' ? s.steps.find(x => x.id === v.id)
    : s.checks.find(x => x.id === v.id);
  const targetId = (item as { target?: string } | undefined)?.target;
  return [
    '요구사항:', ...plan.requirements.filter(r => s.covers.includes(r.id)).map(r => `- ${r.id}: ${r.text}`),
    `시나리오 ${s.id}: ${s.title}`,
    `실패한 항목 ${v.id}: ${JSON.stringify(item)}`,
    ...(targetId ? [`대상 ${targetId}: ${JSON.stringify(plan.targets[targetId])} (탐색 때 유일하게 찾은 요소)`] : []),
    `실행 기록: ${v.observed}`,
    ...(v.error ? [`오류 원문: ${v.error}`] : []),
    '증거 파일 (*.start.aria.txt는 시작 직후, 나머지는 실패 시점):',
    ...[...files].map(([name, text]) => `--- ${name}\n${text.length > EVIDENCE_CHARS ? `${text.slice(0, EVIDENCE_CHARS)}\n(이후 생략: 생략된 부분 없이 판단할 수 없으면 uncertain)` : text}`),
  ].join('\n');
}

/**
 * 결함 후보(mismatch, app_defect_candidate)의 시나리오를 최초 실행 폴더에 고정된 plan·정책으로 한 번 재실행한다.
 * 실행 코드가 최초와 다르거나, 재실행이 무효이거나, 시작 상태 지문이 다르면 reproduction_inconclusive.
 * shortcut: 시작 지문은 URL과 화면(접근성 snapshot)만 본다. 서버 상태가 다른 경우는 앱별 시작 fixture를 만들 때 포함한다.
 */
export async function reproduce(o: { run: RunResult; verdicts: Verdict[]; runDir: string; timeoutMs?: number }): Promise<RunResult | undefined> {
  const candidates = o.verdicts.filter(v => v.class === 'mismatch' || v.class === 'app_defect_candidate');
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
    if (!first.startHash || first.startHash !== second.startHash) { inconclusive('시작 화면이 최초 실행과 다름'); continue; }
    const before = signature(first, v);
    const after = signature(second, v);
    if (after === before) v.reproduction = 'reproduced';
    else if (after === 'passed' || after === 'ok') { v.reproduction = 'flaky'; v.reproductionDetail = `재실행 결과: ${after}`; }
    else inconclusive(`재실행 결과가 다름: ${after}`);
  }
  return again;
}

/** 같은 결과인지 비교하는 서명. 오류 문구의 숫자(시간 등)는 지우고 비교한다. */
function signature(r: ScenarioResult, v: Verdict): string {
  const err = (e?: string) => (e ?? '').replace(/\d+/g, '#');
  if (v.kind === 'check') {
    const c = r.checks.find(x => x.id === v.id)!;
    return c.status === 'passed' ? 'passed' : `${c.status}|${c.actual ?? ''}|${c.count ?? ''}|${err(c.error)}`;
  }
  if (v.kind === 'act') {
    const st = r.steps.find(x => x.id === v.id)!;
    return st.status === 'ok' ? 'ok' : `${st.status}|${st.reason ?? ''}|${st.count ?? ''}|${err(st.error)}`;
  }
  return r.start;
}

export type Judgment = { file: string; verdicts: Verdict[]; requirements: { id: string; plan: string; classes: Partial<Record<Class, number>> }[] };

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
  const judgment = (stage: string): Judgment & { stage: string } => ({ file, stage, verdicts, requirements: o.run.requirements.map(r => {
    const classes: Partial<Record<Class, number>> = {};
    for (const v of verdicts) if (v.requirements.includes(r.id)) classes[v.class] = (classes[v.class] ?? 0) + 1;
    return { id: r.id, plan: r.plan, classes };
  }) });
  const save = (stage: string) => writeFileSync(file, JSON.stringify(judgment(stage), null, 2));
  save('preclassified');
  await triage({ plan: o.plan, run: o.run, verdicts, send: o.send, model: o.model, budget: o.budget, maxItems: o.maxTriageItems, onUpdate: () => save('triage') });
  save('triaged');
  try {
    await reproduce({ run: o.run, verdicts, runDir: o.reproduceDir, timeoutMs: o.timeoutMs });
  } catch (e) {
    for (const v of verdicts) if ((v.class === 'mismatch' || v.class === 'app_defect_candidate') && !v.reproduction) {
      v.reproduction = 'reproduction_inconclusive';
      v.reproductionDetail = `재실행 실패: ${(e as Error).message.split('\n')[0]}`;
    }
  }
  save('done');
  return judgment('done');
}
