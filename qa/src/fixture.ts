// ③ 실행 헬퍼. 생성된 spec은 start·act·check만 부르고, 연산·대상·입력값·기대값은 모두 고정된 plan.json에서 읽는다.
// 모든 결과는 즉시 ledger.jsonl에 쓴다. 판정은 테스트 통과 여부가 아니라 ledger와 plan의 대조(reconcile.ts)로 한다.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { ariaText, guardContext, settle, shapeChanged, toLocator, type AriaNode, type Policy } from './browser.ts';
import { compareValues, type Plan, type Check } from './plan.ts';

const dir = process.env.QA_RUN_DIR;
if (!dir) throw new Error('QA_RUN_DIR가 없다. spec은 run.ts로 실행한다.');
const plan: Plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
const policy: Policy = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'));
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS ?? 5000);

const steps = new Map(plan.scenarios.flatMap(s => s.steps.map(st => [st.id, st] as const)));
const checks = new Map(plan.scenarios.flatMap(s => s.checks.map(c => [c.id, c] as const)));
/** 이 실행에서 검사가 읽은 실제 값. 관측 참조(expected_from)가 앞선 검사의 값을 기대값으로 쓴다. */
const actuals = new Map<string, string>();

/** 실패 시점의 접근성 snapshot과 스크린샷을 evidence/에 남기고 실행 폴더 기준 경로를 돌려준다. 수집 실패는 결과를 바꾸지 않고 따로 기록한다. */
async function capture(page: Page, id: string): Promise<{ evidence: string[]; captureErrors?: string[] }> {
  mkdirSync(join(dir!, 'evidence'), { recursive: true });
  const evidence: string[] = [];
  const captureErrors: string[] = [];
  try { writeFileSync(join(dir!, 'evidence', `${id}.aria.txt`), await page.locator('body').ariaSnapshot()); evidence.push(`evidence/${id}.aria.txt`); }
  catch (e) { captureErrors.push(`aria: ${brief(e)}`); }
  try { await page.screenshot({ path: join(dir!, 'evidence', `${id}.png`) }); evidence.push(`evidence/${id}.png`); }
  catch (e) { captureErrors.push(`screenshot: ${brief(e)}`); }
  return { evidence, ...(captureErrors.length ? { captureErrors } : {}) };
}

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
  // SPA는 load 뒤에 내용을 그리므로 화면이 멈출 때까지 기다린 뒤 시작 증거를 찍는다. 시작 상태의 확인은 선행조건 검사가 한다.
  const ready = await settle(page, TIMEOUT);
  const aria = await page.locator('body').ariaSnapshot();
  mkdirSync(join(dir!, 'evidence'), { recursive: true });
  writeFileSync(join(dir!, 'evidence', `${scenarioId}.start.aria.txt`), aria);
  log({ kind: 'start', scenario: scenarioId, status: 'ok', url: page.url(), ready, evidence: [`evidence/${scenarioId}.start.aria.txt`] });
}

/**
 * 계획된 행동 하나. 대상이 유일하지 않거나 행동할 수 없으면 not_executed, 행동 중 오류가 나면 실행 여부를 알 수 없으므로
 * uncertain_execution으로 남기고 시나리오를 멈춘다. 재시도하지 않는다.
 */
export async function act(page: Page, stepId: string): Promise<void> {
  const st = steps.get(stepId);
  if (!st) throw new Error(`plan에 없는 단계: ${stepId}`);
  const stop = async (status: string, extra: Record<string, unknown>) => {
    log({ kind: 'act', id: stepId, status, ...extra, ...(await capture(page, stepId)) });
    return new Stopped(`${stepId} ${status}`);
  };
  let loc: Locator | undefined;
  // 행동을 시도하기 전의 모든 실패(대상 조립 오류 포함)는 not_executed다.
  try {
    loc = st.target ? toLocator(page, plan.targets[st.target].target) : undefined;
    if (loc) {
      await loc.first().waitFor({ state: 'attached', timeout: TIMEOUT }).catch(() => {});
      const count = await loc.count();
      if (count !== 1 || await shapeChanged(page, plan.targets[st.target!].target)) throw await stop('not_executed', { reason: 'target_changed', count });
      // 효과 없이 행동 가능 여부만 확인한다.
      if (st.op === 'click') await loc.click({ trial: true, timeout: TIMEOUT });
      else if (st.op === 'fill' && !(await loc.isEditable())) throw new Error('not editable');
      else if (st.op === 'select' && !(await loc.isEnabled())) throw new Error('not enabled');
    }
  } catch (e) {
    if (e instanceof Stopped) throw e;
    throw await stop('not_executed', { reason: 'not_actionable', error: brief(e) });
  }
  // shortcut: 숫자 입력칸의 문자열·없는 옵션처럼 미전달이 확실한 실패도 uncertain으로 센다. 값별 사전 검증이 필요해지면 추가한다.
  try {
    if (st.op === 'click') await loc!.click({ timeout: TIMEOUT });
    else if (st.op === 'fill') await loc!.fill(st.value!, { timeout: TIMEOUT });
    else if (st.op === 'select') await loc!.selectOption({ label: st.value! }, { timeout: TIMEOUT });
    else await (loc ? loc.press(st.value!, { timeout: TIMEOUT }) : page.keyboard.press(st.value!));
  } catch (e) {
    throw await stop('uncertain_execution', { error: brief(e) });
  }
  log({ kind: 'act', id: stepId, status: 'ok', url: page.url() });
}

/**
 * 계획된 검사 하나. 비동기 화면을 위해 기한까지 다시 읽어 "기한 안의 최종 상태"를 비교한다.
 * 첫 읽기 값도 남겨, 처음엔 틀렸다가 맞게 바뀐 경우를 나중에 구분할 수 있게 한다.
 * 불일치·대상 미해결은 시나리오를 멈추지 않고 soft 실패로 표시한다. 읽기 중 예외는 error로 남기고 시나리오를 멈춘다.
 * 선행조건 검사가 통과하지 못하면 준비 실패이므로 뒤 행동을 하지 않고 멈춘다.
 */
export async function check(page: Page, checkId: string): Promise<void> {
  const c = checks.get(checkId);
  if (!c) throw new Error(`plan에 없는 검사: ${checkId}`);
  let r: Reading;
  let first: Reading | undefined;
  let reads = 0;
  // 관측 참조: 참조한 검사가 값을 읽지 못했으면 비교할 기대값이 없다.
  const expected = c.expected_from !== undefined ? actuals.get(c.expected_from) : c.expected;
  try {
    if (expected === undefined) r = { status: 'unresolved', reason: `expected_from ${c.expected_from}의 실제 값 없음` };
    else {
      const loc = c.target === undefined ? undefined : toLocator(page, plan.targets[c.target].target);
      const deadline = Date.now() + TIMEOUT;
      for (;;) {
        r = loc && await shapeChanged(page, plan.targets[c.target!].target)
          ? { status: 'unresolved', reason: '순서로 고정한 영역의 요소 수가 바뀜' } : await read(page, loc, c, expected);
        first ??= r;
        reads++;
        if (r.status === 'passed' || Date.now() >= deadline) break;
        await page.waitForTimeout(100);
      }
    }
  } catch (e) {
    log({ kind: 'check', id: checkId, status: 'error', error: brief(e), reads, url: page.url(), ...(await capture(page, checkId)) });
    throw e;
  }
  if (r.actual !== undefined) actuals.set(checkId, r.actual);
  log({ kind: 'check', id: checkId, ...r, expected, op: c.op, read: c.read, reads,
    ...(reads > 1 ? { first: { status: first!.status, actual: first!.actual } } : {}), url: page.url(),
    ...(r.status === 'passed' ? {} : await capture(page, checkId)) });
  if (c.precondition && r.status !== 'passed') throw new Stopped(`${checkId} 선행조건 ${r.status}`);
  expect.soft(r.status, `${checkId}: ${c.read} ${c.op} ${JSON.stringify(expected ?? null)}, 실제 ${JSON.stringify(r.actual ?? null)}`).toBe('passed');
}

/** ledger에 이미 기록하고 멈출 때 쓰는 예외. */
class Stopped extends Error {}

type Reading = { status: 'passed' | 'mismatch' | 'unresolved'; actual?: string; count?: number; reason?: string };

async function read(page: Page, loc: Locator | undefined, c: Check, expected: string): Promise<Reading> {
  const done = (actual: string, count?: number): Reading =>
    ({ status: compareValues(c.op, actual, expected) ? 'passed' : 'mismatch', actual, ...(count === undefined ? {} : { count }) });
  if (!loc) return done(page.url());
  const count = await loc.count();
  if (c.read === 'count') return done(String(count), count);
  // 탐색 때 모델이 본 접근성 snapshot과 같은 기준으로 읽는다. innerText는 CSS 대소문자 변환이, textContent는 숨긴 텍스트가 섞인다.
  const text = async (l: Locator) => ariaText(await l.ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]);
  if (c.read === 'items') {
    const items: string[] = [];
    for (const l of await loc.all()) items.push(await text(l));
    return done(JSON.stringify(items), count);
  }
  if (c.read === 'visible' && count === 0) return done('false', count);
  if (count !== 1) return { status: 'unresolved', count };
  if (c.read === 'text') return done(await text(loc), count);
  if (c.read === 'value') return done(await loc.inputValue(), count);
  if (c.read === 'checked') return done(String(await loc.isChecked()), count);
  return done(String(await loc.isVisible()), count);
}

const brief = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];
