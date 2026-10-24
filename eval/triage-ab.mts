// 분류 프롬프트 A/B: 저장된 실행 결과(plan·results·증거)로 분류 단계만 다시 돌려 두 프롬프트를 비교한다.
// 탐색·실행·재현은 다시 하지 않는다. 정답지(bugs.json)는 페이지 단위 집계에만 쓰고 모델 입력에 넣지 않는다.
//
//   node eval/triage-ab.mts --dry                      # 유료 호출 없이 분류 대상 수만 센다
//   node eval/triage-ab.mts --repeat 2 --budget 3      # A·B를 번갈아 repeat번씩 (유료)
//   node eval/triage-ab.mts --compare input --runs maison-rerun-x/run,eval-bug-1-list-...  # 이전 입력(이미지·실패 사유 없음, 이전 프롬프트) 대 지금 입력
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { preclassify, triage, type Verdict } from '../qa/src/triage.ts';
import { Budget, type Send } from '../qa/src/agent.ts';
import type { Plan } from '../qa/src/plan.ts';
import type { RunResult } from '../qa/src/run.ts';

const EVAL = fileURLToPath(new URL('.', import.meta.url));
const QA = join(EVAL, '..', 'qa');
const { values: a } = parseArgs({ options: {
  dry: { type: 'boolean', default: false }, repeat: { type: 'string', default: '1' }, budget: { type: 'string', default: '3' },
  model: { type: 'string', default: 'claude-sonnet-5-5' }, concurrency: { type: 'string', default: '3' },
  // skill: A=지금 프롬프트, B=스킬 지식 추가. input: old=이전 프롬프트+이미지 없음+오류 첫 줄만, new=지금 그대로
  compare: { type: 'string', default: 'skill' }, runs: { type: 'string' },
} });

// 비교 대상 실행: [실행 폴더, 정답지 변형(없으면 정답 없음), 정상 앱이면 true]
const DEFAULT_DATASETS: { dir: string; variant?: string; normal?: boolean }[] = [
  { dir: 'maison-full-2026-10-19T02-22-01-023Z/run' },
  { dir: 'internet-20261019-002521/run' },
  ...['form', 'list', 'modal'].flatMap(p => [
    { dir: `eval-bug-1-${p}-2026-10-16T08-43-00-938Z`, variant: 'bug-1' },
    { dir: `eval-normal-${p}-2026-10-16T07-46-05-680Z`, normal: true },
  ]),
];
// --runs는 실행 폴더 목록. bug-1 fixture 폴더면 정답지 변형을 붙인다.
const DATASETS = a.runs ? a.runs.split(',').map(dir => ({ dir, ...(/^eval-bug-1-/.test(dir) ? { variant: 'bug-1' } : /^eval-normal-/.test(dir) ? { normal: true } : {}) })) : DEFAULT_DATASETS;
const NOW = readFileSync(join(QA, 'prompts', 'triage.md'), 'utf8');
const ARMS: Record<string, string> = a.compare === 'input'
  ? { old: readFileSync(join(EVAL, 'prompts', 'triage-old.md'), 'utf8'), new: NOW }
  : { A: NOW, B: readFileSync(join(EVAL, 'prompts', 'triage-skill.md'), 'utf8') };
const ARM_NAMES = Object.keys(ARMS);
// 이전 입력 흉내: 실패 시점 이미지와 그 안내 줄을 뺀다(오류 원문은 판정 항목에서 첫 줄만 남긴다).
const oldInput = (send: Send): Send => req => {
  const [m0, ...rest] = req.messages;
  if (!Array.isArray(m0.content)) return send(req);
  const text = m0.content.filter(b => b.type === 'text').map(b => b.text).join('\n').replace(/\n첨부 이미지: [^\n]*/, '');
  return send({ ...req, messages: [{ ...m0, content: text }, ...rest] });
};

const load = (dir: string) => {
  const runDir = join(QA, 'runs', dir);
  const plan: Plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf8'));
  const run: RunResult = { ...JSON.parse(readFileSync(join(runDir, 'results.json'), 'utf8')), runDir };
  return { plan, run };
};
const bugPages = (variant?: string): Set<string> => {
  if (!variant) return new Set();
  const answers: { bugs: { page: string; inScope: boolean }[] } = JSON.parse(readFileSync(join(EVAL, 'variants', variant, 'bugs.json'), 'utf8'));
  return new Set(answers.bugs.filter(b => b.inScope).map(b => b.page));
};

let send: Send;
// 안마다 예산을 따로 둔다. 하나를 나눠 쓰면 먼저 돈 안이 예산을 먹어 뒤 안의 분류 미완료(budget)가 늘어 비교가 기운다.
const budgets: Record<string, Budget> = Object.fromEntries(ARM_NAMES.map(n => [n, new Budget(Number(a.budget) / ARM_NAMES.length)]));
const spent = () => Object.values(budgets).reduce((n, b) => n + b.spent, 0);
if (a.dry) send = async () => { throw new Error('dry run'); };
else {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? (readFileSync(join(EVAL, '..', '.env'), 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim());
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없다');
  // SDK는 qa/node_modules에 있다(eval 폴더에는 의존성이 없다).
  const { default: Anthropic } = await import(pathToFileURL(createRequire(join(QA, 'package.json')).resolve('@anthropic-ai/sdk')).href);
  const client = new Anthropic({ apiKey });
  send = req => client.messages.create(req);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(EVAL, 'results', `triage-ab-${stamp}`);
type Row = { dataset: string; arm: string; rep: number; id: string; observed: string; class: string; reason?: string; error?: string; truth: 'defect_page' | 'normal' | 'unknown' };
const rows: Row[] = [];
// 데이터셋마다 두 안을 번갈아 돌린다(반복 회차마다 순서를 바꾼다). 실행 순서·시간대 차이가 한쪽에만 몰리지 않게 한다.
for (let rep = 1; rep <= Number(a.repeat); rep++) {
  for (const d of DATASETS) {
    if (!existsSync(join(QA, 'runs', d.dir, 'results.json'))) { console.log(`없음: ${d.dir}`); continue; }
    const arms = a.dry ? ARM_NAMES.slice(0, 1) : rep % 2 ? ARM_NAMES : [...ARM_NAMES].reverse();
    for (const arm of arms) {
      const { plan, run } = load(d.dir);
      const verdicts: Verdict[] = preclassify(plan, run);
      if (arm === 'old') for (const v of verdicts) if (v.error) v.error = v.error.split('\n')[0];
      await triage({ plan, run, verdicts, send: arm === 'old' ? oldInput(send) : send, model: a.model!, budget: budgets[arm], concurrency: Number(a.concurrency), system: ARMS[arm],
        logDir: a.dry ? 'ab-dry' : `ab-${stamp}/${arm}-${rep}` });
      // 정답은 분류가 끝난 뒤에 항목의 시나리오 시작 페이지로 매긴다(사후 채점).
      const bug = bugPages(d.variant);
      const pageOf = (v: Verdict) => new URL(plan.scenarios.find(s => s.id === v.scenario)?.start.url ?? 'http://x/').pathname.replace(/^\//, '');
      // 실제로 분류를 부른 항목(묶음의 대표)만 센다. 공유받은 복제본은 같은 답이라 표본을 부풀린다.
      for (const v of verdicts.filter(v => v.triageLog && !v.triageSharedFrom)) rows.push({ dataset: d.dir, arm, rep, id: v.id, observed: v.observed, class: v.class,
        ...(v.triage && 'reason' in v.triage ? { reason: v.triage.reason } : {}), ...(v.triage && 'error' in v.triage ? { error: v.triage.error } : {}),
        truth: d.normal ? 'normal' : d.variant ? (bug.has(pageOf(v)) ? 'defect_page' : 'normal') : 'unknown' });
    }
  }
}

if (a.dry) {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.dataset, (by.get(r.dataset) ?? 0) + 1);
  for (const [k, n] of by) console.log(`${n}\t${k}`);
  console.log(`분류 대상(묶음 대표) 합계: ${rows.length}`);
} else {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'rows.json'), JSON.stringify({ model: a.model, spent: spent(), spentByArm: Object.fromEntries(Object.entries(budgets).map(([k, b]) => [k, b.spent])), rows }, null, 2));
  const table = new Map<string, Record<string, number>>();
  for (const r of rows) { const k = `${r.arm} ${r.truth}`; const t = table.get(k) ?? {}; t[r.class] = (t[r.class] ?? 0) + 1; table.set(k, t); }
  for (const [k, t] of [...table].sort()) console.log(k.padEnd(18), JSON.stringify(t));
  for (const arm of ARM_NAMES) { const e: Record<string, number> = {}; for (const r of rows.filter(r => r.arm === arm && r.error)) { const k = r.error!.match(/분류 미완료: (\w+)/)?.[1] ?? '기타'; e[k] = (e[k] ?? 0) + 1; } console.log(`${arm}: 비용 $${budgets[arm].spent.toFixed(3)} · 분류 실패 ${JSON.stringify(e)}`); }
console.log(`비용 합계 $${spent().toFixed(3)} · 결과 ${out}`);
// shortcut: 정답은 페이지 단위다(defect_page = 버그를 심은 페이지의 항목). 그 페이지의 무관한 자동화 실패를 결함으로 분류해도 결함 쪽에 세인다. 항목 단위 정답 대응은 사람이 사후에 한다. 일반화 성능으로 쓰지 않는다.
}
