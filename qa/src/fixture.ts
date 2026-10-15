// ③ 실행 헬퍼. 생성된 spec은 start·act·check만 부르고, 연산·대상·입력값·기대값은 모두 고정된 plan.json에서 읽는다.
// 모든 결과는 즉시 ledger.jsonl에 쓴다. 판정은 테스트 통과 여부가 아니라 ledger와 plan의 대조(reconcile.ts)로 한다.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { guardContext, toLocator, type Policy } from './browser.ts';
import type { Plan, Check } from './plan.ts';

const dir = process.env.QA_RUN_DIR;
if (!dir) throw new Error('QA_RUN_DIR가 없다. spec은 run.ts로 실행한다.');
const plan: Plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
const policy: Policy = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'));
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS ?? 5000);

const steps = new Map(plan.scenarios.flatMap(s => s.steps.map(st => [st.id, st] as const)));
const checks = new Map(plan.scenarios.flatMap(s => s.checks.map(c => [c.id, c] as const)));

/** ledger 한 줄. 예외가 나기 전에 먼저 쓴다. */
function log(entry: Record<string, unknown>): void {
  appendFileSync(join(dir!, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

export const test = base.extend<{ guard: void }>({
  // 러너의 컨텍스트에 탐색 때와 같은 정책을 건다. 막은 요청과 위반은 시나리오 끝에 ledger에 남긴다.
  guard: [async ({ context }, use, info) => {
    const g = await guardContext(context, policy);
    await use();
    log({ kind: 'policy', scenario: info.title.split(' ')[0], blocked: g.blocked, violations: g.violations });
  }, { auto: true }],
});

export async function start(page: Page, scenarioId: string): Promise<void> {
  const s = plan.scenarios.find(x => x.id === scenarioId);
  if (!s) throw new Error(`plan에 없는 시나리오: ${scenarioId}`);
  try {
    await page.goto(s.start.url);
  } catch (e) {
    log({ kind: 'start', scenario: scenarioId, status: 'failed', error: brief(e) });
    throw e;
  }
  log({ kind: 'start', scenario: scenarioId, status: 'ok', url: page.url() });
}

/**
 * 계획된 행동 하나. 대상이 유일하지 않거나 행동할 수 없으면 not_executed, 행동 중 오류가 나면 실행 여부를 알 수 없으므로
 * uncertain_execution으로 남기고 시나리오를 멈춘다. 재시도하지 않는다.
 */
export async function act(page: Page, stepId: string): Promise<void> {
  const st = steps.get(stepId);
  if (!st) throw new Error(`plan에 없는 단계: ${stepId}`);
  const stop = (status: string, extra: Record<string, unknown>) => {
    log({ kind: 'act', id: stepId, status, ...extra });
    return new Stopped(`${stepId} ${status}`);
  };
  let loc: Locator | undefined;
  // 행동을 시도하기 전의 모든 실패(대상 조립 오류 포함)는 not_executed다.
  try {
    loc = st.target ? toLocator(page, plan.targets[st.target].target) : undefined;
    if (loc) {
      await loc.first().waitFor({ state: 'attached', timeout: TIMEOUT }).catch(() => {});
      const count = await loc.count();
      if (count !== 1) throw stop('not_executed', { reason: 'target_changed', count });
      // 효과 없이 행동 가능 여부만 확인한다.
      if (st.op === 'click') await loc.click({ trial: true, timeout: TIMEOUT });
      else if (st.op === 'fill' && !(await loc.isEditable())) throw new Error('not editable');
      else if (st.op === 'select' && !(await loc.isEnabled())) throw new Error('not enabled');
    }
  } catch (e) {
    if (e instanceof Stopped) throw e;
    throw stop('not_executed', { reason: 'not_actionable', error: brief(e) });
  }
  // shortcut: 숫자 입력칸의 문자열·없는 옵션처럼 미전달이 확실한 실패도 uncertain으로 센다. 값별 사전 검증이 필요해지면 추가한다.
  try {
    if (st.op === 'click') await loc!.click({ timeout: TIMEOUT });
    else if (st.op === 'fill') await loc!.fill(st.value!, { timeout: TIMEOUT });
    else if (st.op === 'select') await loc!.selectOption({ label: st.value! }, { timeout: TIMEOUT });
    else await (loc ? loc.press(st.value!, { timeout: TIMEOUT }) : page.keyboard.press(st.value!));
  } catch (e) {
    throw stop('uncertain_execution', { error: brief(e) });
  }
  log({ kind: 'act', id: stepId, status: 'ok', url: page.url() });
}

/**
 * 계획된 검사 하나. 비동기 화면을 위해 기한까지 다시 읽어 "기한 안의 최종 상태"를 비교한다.
 * 첫 읽기 값도 남겨, 처음엔 틀렸다가 맞게 바뀐 경우를 나중에 구분할 수 있게 한다.
 * 불일치·대상 미해결은 시나리오를 멈추지 않고 soft 실패로 표시한다. 읽기 중 예외는 error로 남기고 시나리오를 멈춘다.
 */
export async function check(page: Page, checkId: string): Promise<void> {
  const c = checks.get(checkId);
  if (!c) throw new Error(`plan에 없는 검사: ${checkId}`);
  let r: Reading;
  let first: Reading | undefined;
  let reads = 0;
  try {
    const loc = toLocator(page, plan.targets[c.target].target);
    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      r = await read(loc, c);
      first ??= r;
      reads++;
      if (r.status === 'passed' || Date.now() >= deadline) break;
      await page.waitForTimeout(100);
    }
  } catch (e) {
    log({ kind: 'check', id: checkId, status: 'error', error: brief(e), reads, url: page.url() });
    throw e;
  }
  log({ kind: 'check', id: checkId, ...r, expected: c.expected, op: c.op, read: c.read, reads,
    ...(reads > 1 ? { first: { status: first!.status, actual: first!.actual } } : {}), url: page.url() });
  expect.soft(r.status, `${checkId}: ${c.read} ${c.op} ${JSON.stringify(c.expected)}, 실제 ${JSON.stringify(r.actual ?? null)}`).toBe('passed');
}

/** ledger에 이미 기록하고 멈출 때 쓰는 예외. */
class Stopped extends Error {}

type Reading = { status: 'passed' | 'mismatch' | 'unresolved'; actual?: string; count?: number };

async function read(loc: Locator, c: Check): Promise<Reading> {
  const count = await loc.count();
  let actual: string;
  if (c.read === 'count') actual = String(count);
  else if (c.read === 'visible' && count === 0) actual = 'false';
  else if (count !== 1) return { status: 'unresolved', count };
  else if (c.read === 'text') actual = (await loc.innerText()).replace(/\s+/g, ' ').trim();
  else if (c.read === 'value') actual = await loc.inputValue();
  else if (c.read === 'checked') actual = String(await loc.isChecked());
  else actual = String(await loc.isVisible());
  const ok = c.op === 'equals' ? actual === c.expected : actual.includes(c.expected);
  return { status: ok ? 'passed' : 'mismatch', actual, count };
}

const brief = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];
