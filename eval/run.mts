// 고정 계획 평가: 정상 앱 또는 버그 변형을 띄우고, plans/의 계획을 2·3단계로 끝까지 돌려 정답지와 비교한다.
// 정답지(bugs.json)는 집계에만 쓰고 계획·실행·분류에는 넣지 않는다. 유료 API는 부르지 않는다
// (AI 분류가 필요한 항목은 uncertain으로 남는다).
//
//   node eval/run.mts                 정상 앱 (후보는 모두 오탐 후보로 센다)
//   node eval/run.mts --variant bug-1 버그 변형
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runPlan } from '../qa/src/run.ts';
import { judge, type Verdict } from '../qa/src/triage.ts';
import { Budget, type Send } from '../qa/src/agent.ts';
import type { Plan } from '../qa/src/plan.ts';

const EVAL = fileURLToPath(new URL('.', import.meta.url));
const BASE_APP = join(EVAL, '..', 'qa', 'test', 'fixtures');
const RUNS = join(EVAL, '..', 'qa', 'runs');
const PORT = 8765; // 계획에 고정된 origin (plans/meta.json)

const { values: a } = parseArgs({ options: { variant: { type: 'string' } } });
const variantDir = a.variant ? join(EVAL, 'variants', a.variant) : undefined;
if (variantDir && !existsSync(variantDir)) throw new Error(`변형이 없음: ${a.variant}`);
const answers: { bugs: { id: string; page: string; summary: string; inScope: boolean }[] } =
  variantDir ? JSON.parse(readFileSync(join(variantDir, 'bugs.json'), 'utf8')) : { bugs: [] };

// 변형에 있는 파일은 변형에서, 없는 파일은 정상 앱에서 준다. 쓰기 요청은 기록만 한다 (0이어야 한다).
const writes: string[] = [];
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') { writes.push(`${req.method} ${req.url}`); res.end('ok'); return; }
  const path = new URL(req.url!, 'http://x').pathname.replace(/^\/+/, '');
  const file = variantDir && existsSync(join(variantDir, path)) && path.endsWith('.html') ? join(variantDir, path) : join(BASE_APP, path);
  try { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(await readFile(file)); }
  catch { res.statusCode = 404; res.end(); }
});
await new Promise<void>(r => server.listen(PORT, '127.0.0.1', r));

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const label = a.variant ?? 'normal';
const noPaidApi: Send = async () => { throw new Error('유료 API 미사용: AI 분류 생략'); };
const CANDIDATE = new Set(['mismatch', 'app_defect_candidate']);

type PlanSummary = { plan: string; page: string; runDir: string; counts: Record<string, number>; candidates: Verdict[]; problems: string[] };
const perPlan: PlanSummary[] = [];
try {
  for (const name of readdirSync(join(EVAL, 'plans')).filter(f => f.endsWith('.plan.json')).sort()) {
    const plan: Plan = JSON.parse(readFileSync(join(EVAL, 'plans', name), 'utf8'));
    const tag = `eval-${label}-${name.replace('.plan.json', '')}-${stamp}`;
    const run = await runPlan({ plan, policy: { origins: [`http://127.0.0.1:${PORT}`] }, runDir: join(RUNS, tag) });
    const j = await judge({ plan, run, send: noPaidApi, model: 'claude-sonnet-5-5', budget: new Budget(1), reproduceDir: join(RUNS, `${tag}-repro`) });
    const counts: Record<string, number> = {};
    for (const v of j.verdicts) counts[v.class] = (counts[v.class] ?? 0) + 1;
    perPlan.push({ plan: name, page: new URL(plan.scenarios[0]?.start.url ?? 'http://x/').pathname.replace(/^\//, ''), runDir: run.runDir,
      counts, candidates: j.verdicts.filter(v => CANDIDATE.has(v.class)), problems: run.problems });
  }
} finally {
  server.close();
}

// 정답지와 비교: 범위 안 버그는 그 페이지에서 시작한 계획에 재현된 후보가 있으면 탐지로 센다.
// 범위 밖 버그에는 후보를 연결하지 않는다 (페이지만으로는 같은 페이지의 다른 버그 후보와 구분할 수 없다).
// shortcut: 페이지 단위로만 맞춘다. 한 페이지에 범위 안 버그가 여럿이면 어느 후보가 어느 버그인지 구분하지 못한다.
// 버그별 기대 검사(대상·값)를 정답지에 적으면 검사 단위로 맞출 수 있다.
const reproduced = (p: PlanSummary) => p.candidates.filter(v => v.reproduction === 'reproduced');
const bugs = answers.bugs.map(b => {
  if (!b.inScope) return { ...b, result: 'out_of_scope', hits: [] as string[] };
  const hits = perPlan.filter(p => p.page === b.page).flatMap(p => reproduced(p).map(v => `${p.plan}:${v.id}`));
  return { ...b, result: hits.length ? 'detected' : 'missed', hits };
});
const bugPages = new Set(answers.bugs.filter(b => b.inScope).map(b => b.page));
const unexplained = perPlan.flatMap(p => bugPages.has(p.page) ? [] : p.candidates.map(v => `${p.plan}:${v.id} (${v.reproduction ?? '재현 미시도'})`));

const summary = {
  variant: label, stamp, writesReachedServer: writes,
  plans: perPlan.map(p => ({ plan: p.plan, page: p.page, runDir: p.runDir, counts: p.counts, problems: p.problems,
    candidates: p.candidates.map(v => ({ id: v.id, observed: v.observed, reproduction: v.reproduction ?? null })) })),
  bugs, unexplainedCandidates: unexplained,
};
const out = join(EVAL, 'results', `${label}-${stamp}`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`=== ${label}  (결과: ${out})`);
for (const p of summary.plans) console.log(`  ${p.plan}: ${JSON.stringify(p.counts)}${p.problems.length ? `  problems=${p.problems.length}` : ''}`);
for (const b of bugs) console.log(`  ${b.id} ${b.result}  ${b.summary}${b.hits.length ? `  ← ${b.hits.join(', ')}` : ''}`);
console.log(`  정답지로 설명되지 않는 후보: ${unexplained.length ? unexplained.join(', ') : '없음'}`);
console.log(`  서버에 도달한 쓰기 요청: ${writes.length}`);
