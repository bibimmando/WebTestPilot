// Claude API로 끝까지 실행: ① 탐색·계획(계획 모델) → ②③ spec 생성·실행·대조 → ④ 분류(분류 모델) → ⑤ 재현.
// 모든 모델 호출이 하나의 비용 장부(--budget)를 공유하고, 한도를 넘을 호출은 보내지 않는다.
//
//   node src/cli.ts --url <시작 URL> [--requirements <요구사항.json>] [--app <앱 설정.json>] [--budget 10] [--name maison]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import { explore } from './explore.ts';
import { runPlan } from './run.ts';
import { judge } from './triage.ts';
import { writeReport } from './report.ts';
import { writeHeadlines } from './headline.ts';
import { login, readAppConfig, type StorageState } from './login.ts';
import { resetApp, type ResetResult } from './reset.ts';
import { Budget, type Send } from './agent.ts';
import type { Requirement } from './plan.ts';

const QA = fileURLToPath(new URL('..', import.meta.url));
const { values: a } = parseArgs({ options: {
  // 기본 한도(설계 5장 0단계): 예산 $10 중 30%는 분류·재현 몫으로 남기고, 탐색은 40분이 지나면 새 대화를 시작하지 않는다.
  url: { type: 'string' }, requirements: { type: 'string' }, budget: { type: 'string', default: '10' }, 'explore-minutes': { type: 'string', default: '40' },
  name: { type: 'string', default: 'live' }, origins: { type: 'string' },
  // 앱 설정: 로그인 절차(비밀값은 환경 변수 이름만)와 요청하지 않을 주소
  app: { type: 'string' },
  'plan-model': { type: 'string', default: 'claude-opus-5-5' }, 'triage-model': { type: 'string', default: 'claude-sonnet-5-5' },
  'max-turns': { type: 'string', default: '40' }, 'allow-writes': { type: 'boolean', default: false },
  // 여러 페이지 종류가 있는 사이트: 사이트 지도 방문 한도, 탐색할 페이지 종류 수, 종류마다 대화 턴 수
  'max-pages': { type: 'string', default: '30' }, 'max-templates': { type: 'string', default: '8' }, 'turns-per-template': { type: 'string', default: '25' },
  // 같은 템플릿에서 계획을 실행할 페이지 수(대표 포함, C4)
  'pages-per-template': { type: 'string', default: '3' },
  // 동시에 여는 탐색·분류 대화 수와 동시에 실행할 시나리오 수. 순차와 판정이 같은지 확인하기 전까지 기본 1
  concurrency: { type: 'string', default: '1' }, workers: { type: 'string', default: '1' },
} });
if (!a.url || !(Number(a.budget) > 0)) {
  console.error('사용법: node src/cli.ts --url <시작 URL> [--requirements <요구사항.json>] [--budget <USD, 기본 10>] [--name 이름]');
  process.exit(2);
}

// 키는 환경변수가 우선이고, 없으면 저장소 루트 .env에서 읽는다. 값은 출력하지 않는다.
const apiKey = process.env.ANTHROPIC_API_KEY ?? readDotEnv(join(QA, '..', '.env')).ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없다 (환경변수 또는 루트 .env)');
const client = new Anthropic({ apiKey });
const calls: { at: string; model: string; ms: number; usage?: Anthropic.Usage; error?: string }[] = [];
const send: Send = async req => {
  const started = Date.now();
  try {
    const res = await client.messages.create(req);
    calls.push({ at: new Date().toISOString(), model: req.model, ms: Date.now() - started, usage: res.usage });
    return res;
  } catch (e) {
    calls.push({ at: new Date().toISOString(), model: req.model, ms: Date.now() - started, error: String((e as Error).message).slice(0, 300) });
    throw e;
  }
};

// 숫자 옵션은 양의 정수여야 한다(NaN이면 한도가 작동하지 않는다).
for (const k of ['max-turns', 'max-pages', 'max-templates', 'turns-per-template', 'pages-per-template', 'concurrency', 'workers', 'explore-minutes'] as const) {
  if (!Number.isInteger(Number(a[k])) || Number(a[k]) < 1) { console.error(`--${k}는 1 이상의 정수여야 한다: ${a[k]}`); process.exit(2); }
}
const requirements: Requirement[] = a.requirements ? JSON.parse(readFileSync(a.requirements, 'utf8').replace(/^﻿/, '')) : [];  // 요구사항은 선택 입력(설계 3.3)
const app = a.app ? readAppConfig(a.app) : {};
const policy = { origins: a.origins ? a.origins.split(',') : [new URL(a.url).origin], allowWrites: a['allow-writes'], ...(app.deny ? { deny: app.deny } : {}) };
const budget = new Budget(Number(a.budget));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(QA, 'runs', `${a.name}-${stamp}`);
if (existsSync(out)) throw new Error(`이미 있음: ${out}`);
mkdirSync(out, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data, null, 2));
const t0 = Date.now();
const timing: Record<string, number> = {};

const browser = await chromium.launch();
let summary: Record<string, unknown> = {};
// 로그인: 실패해도 멈추지 않고 로그인 없이 검사하며, 보고서에 "로그인 이후 기능 미검사"로 남긴다. 사유에 비밀값은 없다.
let storageState: StorageState | undefined;
// 계정 비밀값 환경 변수는 실행 프로세스에 넘기지 않는다.
const hideEnv = app.login ? [app.login.env.username, app.login.env.password] : [];
let loginStatus: { status: 'none' | 'ok' | 'failed'; reason?: string } = { status: 'none' };
// 등록된 초기화: 쓰기 허용 실행에서만 실행 전에 한 번, 재현 전에 한 번. 결과는 보고서 범위에 남긴다.
// 초기화가 서버 세션을 지울 수 있어, 로그인하는 앱이면 초기화 뒤 다시 로그인한 상태로 실행·재현한다.
const resetLog: { at: 'run' | 'repro'; ok: boolean; reason?: string }[] = [];
const reset = app.reset && policy.allowWrites ? async (): Promise<ResetResult> => {
  let r: ResetResult = await resetApp(policy, app.reset!, storageState);
  if (r.ok && app.login) {
    const again = await login(browser, policy, app.login);
    r = again.ok ? { ok: true, storageState: again.state } : { ok: false, reason: `초기화 뒤 다시 로그인 실패: ${again.reason}` };
    if (again.ok) storageState = again.state;
  }
  resetLog.push({ at: resetLog.length ? 'repro' : 'run', ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
  return r;
} : undefined;
if (app.login) {
  const r = await login(browser, policy, app.login);
  if (r.ok) { storageState = r.state; loginStatus = { status: 'ok' }; } else loginStatus = { status: 'failed', reason: r.reason };
  console.log(`로그인: ${r.ok ? '성공' : `실패 — ${r.reason}`}`);
}
try {
  const e = await explore({ browser, policy, startUrl: a.url, requirements, send, model: a['plan-model']!, budget, maxTurns: Number(a['max-turns']),
    maxPages: Number(a['max-pages']), maxTemplates: Number(a['max-templates']), turnsPerTemplate: Number(a['turns-per-template']), pagesPerTemplate: Number(a['pages-per-template']), concurrency: Number(a.concurrency),
    keepUsd: budget.limitUsd * 0.3, deadline: t0 + Number(a['explore-minutes']) * 60_000, storageState });
  timing.explore = Date.now() - t0;
  save('explore.json', { stop: e.stop, detail: e.detail, blocked: e.blocked, violations: e.violations, sitemap: e.sitemap, conversations: e.conversations,
    complete: e.complete, exploredUrls: e.exploredUrls, turns: e.turns });
  summary = { explore: { stop: e.stop, detail: e.detail, turns: e.turns.length, spentUsd: budget.spent, conversations: e.conversations,
    templates: e.sitemap?.templates.map(t => ({ key: t.key, pages: t.pages.length })), unvisited: e.sitemap?.unvisited.length } };
  if (!e.plan) throw new Error(`계획 없음: ${e.stop} ${e.detail ?? ''}`);
  save('plan.json', e.plan);

  // 실행 전 초기화가 실패하면 시작 상태를 모른다. 실행은 하되 보고서 범위에 남기고, 재현은 판단하지 않는다(reset_failed).
  const startReset = reset ? await reset() : undefined;
  if (startReset) console.log(`초기화: ${startReset.ok ? '확인됨' : `실패 — ${startReset.reason}`}`);
  const run = await runPlan({ plan: e.plan, policy, runDir: join(out, 'run'), workers: Number(a.workers), storageState, hideEnv });
  timing.run = Date.now() - t0 - timing.explore;
  const j = await judge({ plan: e.plan, run, send, model: a['triage-model']!, budget, reproduceDir: join(out, 'repro'), concurrency: Number(a.concurrency), storageState, hideEnv, reset, startReset });
  timing.judge = Date.now() - t0 - timing.explore - timing.run;
  summary = { ...summary, run: { exitCode: run.exitCode, problems: run.problems,
    scenarios: run.scenarios.map(s => ({ id: s.id, valid: s.valid, start: s.start, ready: s.ready, precondition: s.precondition, steps: s.steps.map(x => x.status), checks: s.checks.map(c => c.status) })) },
    verdicts: j.verdicts.map(v => ({ id: v.id, observed: v.observed, class: v.class, reproduction: v.reproduction, system: v.system })), requirements: j.requirements,
    system: j.system, features: j.features, questions: j.pendingQuestions, observations: e.plan.observations };
} finally {
  const persist = () => {
    save('calls.json', calls);
    save('summary.json', { startUrl: a.url, login: loginStatus, reset: { registered: !!app.reset, used: !!reset, calls: resetLog }, ...summary, timingMs: { ...timing, total: Date.now() - t0 }, spentUsd: budget.spent, budgetUsd: budget.limitUsd,
      models: { plan: a['plan-model'], triage: a['triage-model'] }, calls: calls.length });
  };
  persist();
  // 판정까지 끝났으면 저장된 결과로 report.json·PDF를 만든다. 실패해도 실행 결과는 그대로 남고, node src/report.ts <폴더>로 다시 만들 수 있다.
  if (existsSync(join(out, 'run', 'verdicts.json'))) {
    // 발견 제목(AI): 판정은 바꾸지 않는다. 실패하면 보고서는 기대 동작 + 실제 한 줄로 만든다.
    try { await writeHeadlines({ dir: out, send, model: a['triage-model']!, budget }); } catch (e) { console.error(`발견 제목을 만들지 못함: ${(e as Error).message}`); }
    // 제목 호출까지 비용·호출 기록에 넣는다(보고서의 비용이 콘솔 비용과 같게).
    persist();
    try {
      const r = await writeReport(out, browser);
      console.log(`보고서: report.json · report.html${r.pdf ? ' · report.pdf' : ` (PDF 실패: ${r.pdfError})`}`);
    } catch (e) { console.error(`보고서를 만들지 못함: ${(e as Error).message}`); }
  }
  await browser.close();
  console.log(`결과: ${out}`);
  console.log(`비용(토큰 기준 추정): $${budget.spent.toFixed(4)} / 한도 $${budget.limitUsd}  호출 ${calls.length}회  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
