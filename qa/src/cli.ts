// Claude API로 끝까지 실행: ① 탐색·계획(계획 모델) → ②③ spec 생성·실행·대조 → ④ 분류(분류 모델) → ⑤ 재현.
// 모든 모델 호출이 하나의 비용 장부(--budget)를 공유하고, 한도를 넘을 호출은 보내지 않는다.
//
//   node src/cli.ts --url <시작 URL> --requirements <요구사항.json> --budget 10 [--name maison]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import { explore } from './explore.ts';
import { runPlan } from './run.ts';
import { judge } from './triage.ts';
import { Budget, type Send } from './agent.ts';
import type { Requirement } from './plan.ts';

const QA = fileURLToPath(new URL('..', import.meta.url));
const { values: a } = parseArgs({ options: {
  url: { type: 'string' }, requirements: { type: 'string' }, budget: { type: 'string' },
  name: { type: 'string', default: 'live' }, origins: { type: 'string' },
  'plan-model': { type: 'string', default: 'claude-opus-5-5' }, 'triage-model': { type: 'string', default: 'claude-sonnet-5-5' },
  'max-turns': { type: 'string', default: '40' }, 'allow-writes': { type: 'boolean', default: false },
} });
if (!a.url || !a.requirements || !a.budget) {
  console.error('사용법: node src/cli.ts --url <시작 URL> --requirements <요구사항.json> --budget <USD> [--name 이름]');
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

const requirements: Requirement[] = JSON.parse(readFileSync(a.requirements, 'utf8').replace(/^﻿/, ''));
const policy = { origins: a.origins ? a.origins.split(',') : [new URL(a.url).origin], allowWrites: a['allow-writes'] };
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
try {
  const e = await explore({ browser, policy, startUrl: a.url, requirements, send, model: a['plan-model']!, budget, maxTurns: Number(a['max-turns']) });
  timing.explore = Date.now() - t0;
  save('explore.json', { stop: e.stop, detail: e.detail, blocked: e.blocked, violations: e.violations, turns: e.turns });
  summary = { explore: { stop: e.stop, detail: e.detail, turns: e.turns.length, spentUsd: budget.spent } };
  if (!e.plan) throw new Error(`계획 없음: ${e.stop} ${e.detail ?? ''}`);
  save('plan.json', e.plan);

  const run = await runPlan({ plan: e.plan, policy, runDir: join(out, 'run') });
  timing.run = Date.now() - t0 - timing.explore;
  const j = await judge({ plan: e.plan, run, send, model: a['triage-model']!, budget, reproduceDir: join(out, 'repro') });
  timing.judge = Date.now() - t0 - timing.explore - timing.run;
  summary = { ...summary, run: { exitCode: run.exitCode, problems: run.problems,
    scenarios: run.scenarios.map(s => ({ id: s.id, valid: s.valid, start: s.start, steps: s.steps.map(x => x.status), checks: s.checks.map(c => c.status) })) },
    verdicts: j.verdicts.map(v => ({ id: v.id, observed: v.observed, class: v.class, reproduction: v.reproduction })), requirements: j.requirements };
} finally {
  await browser.close();
  save('calls.json', calls);
  save('summary.json', { ...summary, timingMs: { ...timing, total: Date.now() - t0 }, spentUsd: budget.spent, budgetUsd: budget.limitUsd,
    models: { plan: a['plan-model'], triage: a['triage-model'] }, calls: calls.length });
  console.log(`결과: ${out}`);
  console.log(`비용(토큰 기준 추정): $${budget.spent.toFixed(4)} / 한도 $${budget.limitUsd}  호출 ${calls.length}회  ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(l => /^\s*[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
