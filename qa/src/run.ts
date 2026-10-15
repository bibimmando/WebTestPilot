// ③ 실행. 새 실행 폴더에 입력을 고정(복사·해시)하고, plan에서 만든 spec을 playwright test로 돌린 뒤 ledger를 plan과 대조한다.
// 실행 폴더는 덮어쓰지 않는다. AI는 이 단계에 없다.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Policy } from './browser.ts';
import { validate, type Plan } from './plan.ts';
import { specs } from './generate.ts';
import { reconcile, type Entry, type Reconciled } from './reconcile.ts';

const SRC = dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_CLI = join(dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')), 'cli.js');

export type RunResult = Reconciled & { runDir: string; exitCode: number | null };

/** runDir는 qa 폴더 안이어야 한다 (spec이 qa의 ESM·TypeScript 설정과 의존성을 쓴다). */
export async function runPlan(o: { plan: Plan; policy: Policy; runDir: string; timeoutMs?: number }): Promise<RunResult> {
  if (existsSync(o.runDir)) throw new Error(`실행 폴더가 이미 있음 (덮어쓰지 않음): ${o.runDir}`);
  const errors = validate(o.plan, o.plan.requirements, new Map(Object.entries(o.plan.targets)), o.policy.origins);
  if (errors.length) throw new Error(`plan이 계약을 통과하지 못함:\n- ${errors.join('\n- ')}`);
  mkdirSync(join(o.runDir, 'specs'), { recursive: true });
  mkdirSync(join(o.runDir, 'src'));

  // 실행과 대조는 모두 이 시점에 직렬화한 사본만 쓴다. 호출자가 나중에 plan을 바꿔도 판정 기준은 바뀌지 않는다.
  const timeoutMs = o.timeoutMs ?? 5000;
  const files: Record<string, string> = {
    'plan.json': JSON.stringify(o.plan, null, 2),
    'policy.json': JSON.stringify(o.policy, null, 2),
    'playwright.config.mjs': CONFIG,
  };
  // 실행 헬퍼도 복사해서 그 사본을 실행한다. manifest의 해시가 실제로 실행된 코드의 해시가 된다.
  for (const f of RUNTIME_SOURCES) files[`src/${f}`] = readFileSync(join(SRC, f), 'utf8');
  for (const [name, code] of Object.entries(specs(o.plan, '../src/fixture.ts'))) files[`specs/${name}`] = code;
  for (const [name, text] of Object.entries(files)) writeFileSync(join(o.runDir, name), text);
  const frozen: Plan = JSON.parse(files['plan.json']);

  const manifest = {
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)])),
    timeoutMs, node: process.version,
    playwright: JSON.parse(readFileSync(join(dirname(PLAYWRIGHT_CLI), 'package.json'), 'utf8')).version,
  };
  writeFileSync(join(o.runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 비동기로 실행한다. 같은 프로세스가 대상 서버를 띄운 경우 동기 실행은 그 서버를 막아 교착된다.
  const exitCode = await new Promise<number | null>(resolve => {
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', '-c', 'playwright.config.mjs'], {
      cwd: o.runDir, env: { ...childEnv(), QA_RUN_DIR: o.runDir, QA_TIMEOUT_MS: String(timeoutMs) },
    });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', e => { output += `\n${e}`; });
    child.on('close', code => { writeFileSync(join(o.runDir, 'playwright.log'), output); resolve(code); });
  });

  // 깨진 줄은 건너뛰고 문제로 남긴다. 그 앞뒤의 유효한 기록은 보존한다.
  const ledgerPath = join(o.runDir, 'ledger.jsonl');
  const broken: string[] = [];
  const entries: Entry[] = (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n') : []).flatMap((l, i) => {
    if (!l.trim()) return [];
    try { return [JSON.parse(l)]; } catch { broken.push(`ledger ${i + 1}번째 줄을 읽을 수 없음`); return []; }
  });
  const reconciled = reconcile(frozen, entries);
  const result = { ...reconciled, problems: [...broken, ...reconciled.problems], runDir: o.runDir, exitCode };
  writeFileSync(join(o.runDir, 'results.json'), JSON.stringify(result, null, 2));
  return result;
}

const RUNTIME_SOURCES = ['fixture.ts', 'browser.ts', 'plan.ts'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 실행 코드에 키·토큰을 넘기지 않는다. */
function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|ANTHROPIC|OPENAI/i.test(k)));
}

// 시나리오는 한 번에 하나씩, 재시도 없이. trace·screenshot은 항상 남긴다 (실패 분류의 증거).
const CONFIG = `export default {
  testDir: 'specs',
  outputDir: 'artifacts',
  workers: 1,
  retries: 0,
  timeout: 120000,
  reporter: [['json', { outputFile: 'report.json' }]],
  use: { trace: 'on', screenshot: 'on', serviceWorkers: 'block', headless: true },
};
`;
