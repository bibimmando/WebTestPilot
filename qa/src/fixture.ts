// ③ 실행 헬퍼. 생성된 spec은 start·act·check만 부르고, 연산·대상·입력값·기대값은 모두 고정된 plan.json에서 읽는다.
// 모든 결과는 즉시 ledger.jsonl에 쓴다. 판정은 테스트 통과 여부가 아니라 ledger와 plan의 대조(reconcile.ts)로 한다.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { ariaText, ariaTextV1, guardContext, settle, shapeChanged, toLocator, VIEWPORTS, type AriaNode, type Policy, type Signal } from './browser.ts';
import { compareValues, expectedFrom, sortKeys, type Plan, type Check } from './plan.ts';

const dir = process.env.QA_RUN_DIR;
if (!dir) throw new Error('QA_RUN_DIR가 없다. spec은 run.ts로 실행한다.');
const plan: Plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
const policy: Policy = JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'));
const TIMEOUT = Number(process.env.QA_TIMEOUT_MS ?? 5000);

const steps = new Map(plan.scenarios.flatMap(s => s.steps.map(st => [st.id, st] as const)));
const checks = new Map(plan.scenarios.flatMap(s => s.checks.map(c => [c.id, c] as const)));
/** 지금 실행 중인 단계. 오류 신호를 이 단계에 붙인다. 워커 하나는 시나리오를 하나씩 차례로 돌린다. */
let phase = 'start';
const SIGNALS_PER_STEP = 10;
const NORMAL_REJECTIONS = new Set([401, 403, 422]);
/** 페이지 객체마다의 탭 식별자(워커 프로세스 안에서 유일). 시나리오의 기록이 한 탭에서 나왔는지 대조가 확인한다 */
const tabs = new WeakMap<Page, string>();
let tabCount = 0;
const tabOf = (page: Page) => { let t = tabs.get(page); if (!t) tabs.set(page, t = `${process.pid}-${++tabCount}`); return t; };
/** 이 실행에서 검사가 읽은 실제 값. 관측 참조(expected_from)가 앞선 검사의 값을 기대값으로 쓴다. */
const actuals = new Map<string, string>();

/** 실패 시점의 접근성 snapshot과 스크린샷을 evidence/에 남기고 실행 폴더 기준 경로를 돌려준다. 수집 실패는 결과를 바꾸지 않고 따로 기록한다. */
async function capture(page: Page, id: string): Promise<{ evidence: string[]; captureErrors?: string[] }> {
  const evidence: string[] = [];
  const captureErrors: string[] = [];
  // 증거 폴더를 못 만들면 아무것도 못 찍는다. 예외를 던지면 그 행동·검사의 기록 자체가 사라지므로 수집 실패로만 남긴다.
  try { mkdirSync(join(dir!, 'evidence'), { recursive: true }); } catch (e) { return { evidence, captureErrors: [`aria: 증거 폴더 ${brief(e)}`, `screenshot: 증거 폴더 ${brief(e)}`] }; }
  try { writeFileSync(join(dir!, 'evidence', `${id}.aria.txt`), await page.locator('body').ariaSnapshot()); evidence.push(`evidence/${id}.aria.txt`); }
  catch (e) { captureErrors.push(`aria: ${brief(e)}`); }
  try { await page.screenshot({ path: join(dir!, 'evidence', `${id}.png`) }); evidence.push(`evidence/${id}.png`); }
  catch (e) { captureErrors.push(`screenshot: ${brief(e)}`); }
  return { evidence, ...(captureErrors.length ? { captureErrors } : {}) };
}

/** ledger 한 줄. 예외가 나기 전에 먼저 쓴다. */
function log(entry: Record<string, unknown>, page?: Page): void {
  appendFileSync(join(dir!, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...(page ? { tab: tabOf(page) } : {}), ...entry }) + '\n');
}

export const test = base.extend<{ guard: void }>({
  // 러너의 컨텍스트에 탐색 때와 같은 정책을 건다. 막은 요청과 위반은 시나리오 끝에 ledger에 남긴다.
  guard: [async ({ context }, use, info) => {
    const g = await guardContext(context, policy);
    // 오류 신호: 콘솔 오류, 잡히지 않은 스크립트 예외, 400 이상 응답, 실패한 요청.
    // 정책 차단(우리가 막은 요청)·이동으로 취소된 요청·브라우저가 스스로 여는 /favicon.ico는 앱의 신호가 아니라 뺀다.
    const signals: Signal[] = [];
    let signalsDropped = 0;
    const add = (s: Omit<Signal, 'after'>, after = phase) => {
      if (signals.filter(x => x.after === after).length >= SIGNALS_PER_STEP) { signalsDropped++; return; }
      signals.push({ ...s, after, text: s.text.slice(0, 300) });
    };
    // 응답·실패는 늦게 도착해도 요청을 보낸 단계에 붙인다. 콘솔·스크립트 예외는 보낸 쪽을 알 수 없어 난 시점의 단계에 붙인다.
    const sentIn = new WeakMap<object, string>();
    context.on('request', r => sentIn.set(r, phase));
    const newTabs: { after: string; url: string; page: import('@playwright/test').Page }[] = [];
    // 시나리오 시작 때의 첫 탭은 테스트 러너가 연다. 그 뒤에 열린 탭만 센다.
    let opened = 0;
    context.on('page', p => { if (opened++ > 0) newTabs.push({ after: phase, url: p.url() || '(주소 없음)', page: p }); });
    const favicon = (url: string) => new URL(url).pathname === '/favicon.ico';
    context.on('console', m => {
      // "Failed to load resource"는 브라우저가 실패한 요청을 다시 알리는 문구라 요청 신호와 겹친다.
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) add({ kind: 'console', url: m.page()?.url() ?? '', text: m.text() });
    });
    context.on('weberror', e => add({ kind: 'pageerror', url: e.page()?.url() ?? '', text: String(e.error()?.message ?? e.error()) }));
    context.on('response', r => {
      if (r.status() < 400 || favicon(r.url())) return;
      add({ kind: 'http', url: r.url(), status: r.status(), text: `${r.request().method()} ${r.status()}`, ...(NORMAL_REJECTIONS.has(r.status()) ? { normal: true as const } : {}) }, sentIn.get(r.request()));
    });
    context.on('requestfailed', r => {
      const why = r.failure()?.errorText ?? '';
      if (/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/.test(why) || favicon(r.url())) return;
      add({ kind: 'requestfailed', url: r.url(), text: `${r.method()} ${why}` }, sentIn.get(r));
    });
    await use();
    log({ kind: 'policy', scenario: info.title.split(' ')[0], blocked: g.blocked, violations: g.violations, signals, ...(signalsDropped ? { signalsDropped } : {}),
      ...(newTabs.length ? { newTabs: newTabs.map(t => ({ after: t.after, url: (!t.page.isClosed() && t.page.url()) || t.url })) } : {}) });
  }, { auto: true }],
});

export async function start(page: Page, scenarioId: string): Promise<void> {
  const s = plan.scenarios.find(x => x.id === scenarioId);
  if (!s) throw new Error(`plan에 없는 시나리오: ${scenarioId}`);
  phase = 'start';
  try {
    if (s.viewport) await page.setViewportSize(VIEWPORTS[s.viewport]);
    await page.goto(s.start.url);
  } catch (e) {
    log({ kind: 'start', scenario: scenarioId, status: 'failed', error: brief(e) }, page);
    throw e;
  }
  // SPA는 load 뒤에 내용을 그리므로 화면이 멈출 때까지 기다린 뒤 시작 증거를 찍는다. 시작 상태의 확인은 선행조건 검사가 한다.
  const ready = await settle(page, TIMEOUT);
  let evidence: string[] = [], captureErrors: string[] = [];
  try {
    const aria = await page.locator('body').ariaSnapshot();
    mkdirSync(join(dir!, 'evidence'), { recursive: true });
    writeFileSync(join(dir!, 'evidence', `${scenarioId}.start.aria.txt`), aria);
    evidence = [`evidence/${scenarioId}.start.aria.txt`];
  } catch (e) { captureErrors = [`aria: ${brief(e)}`]; }
  log({ kind: 'start', scenario: scenarioId, status: 'ok', url: page.url(), ready, viewport: page.viewportSize(), evidence,
    ...(captureErrors.length ? { captureErrors } : {}) }, page);
}

/**
 * 계획된 행동 하나. 대상이 유일하지 않거나 행동할 수 없으면 not_executed, 행동 중 오류가 나면 실행 여부를 알 수 없으므로
 * uncertain_execution으로 남기고 시나리오를 멈춘다. 재시도하지 않는다.
 * 행동 직전·직후 화면(접근성 snapshot·스크린샷)과 행동 직전에 관측한 대상(접근성 표현·화면 위치)을 남긴다.
 * "앱이 반응하지 않았다"와 "자동화가 다른 것을 눌렀다"를 분류에서 가르기 위해서다.
 */
export async function act(page: Page, stepId: string): Promise<void> {
  const st = steps.get(stepId);
  if (!st) throw new Error(`plan에 없는 단계: ${stepId}`);
  phase = stepId;
  const stop = async (status: string, extra: Record<string, unknown>, prior: string[] = []) => {
    const c = await capture(page, stepId);
    const captureErrors = [...prior, ...(c.captureErrors ?? [])];
    log({ kind: 'act', id: stepId, status, ...extra, evidence: c.evidence, ...(captureErrors.length ? { captureErrors } : {}) }, page);
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
  const urlBefore = page.url();
  const before = await capture(page, `${stepId}.before`);
  // shortcut: 관측과 실제 행동은 locator를 따로 평가하므로, 그 사이 재렌더링으로 다른 요소가 눌릴 수 있다. 행동 시점 trace 연결이 필요해지면 바꾼다.
  const pressed = loc ? { aria: clip(await loc.ariaSnapshot().catch(e => `읽기 실패: ${brief(e)}`)), box: await loc.boundingBox().catch(() => null) }
    : { key: st.value };
  // shortcut: 숫자 입력칸의 문자열·없는 옵션처럼 미전달이 확실한 실패도 uncertain으로 센다. 값별 사전 검증이 필요해지면 추가한다.
  try {
    if (st.op === 'click') await loc!.click({ timeout: TIMEOUT });
    else if (st.op === 'fill') await loc!.fill(st.value!, { timeout: TIMEOUT });
    else if (st.op === 'select') await loc!.selectOption({ label: st.value! }, { timeout: TIMEOUT });
    else await (loc ? loc.press(st.value!, { timeout: TIMEOUT }) : page.keyboard.press(st.value!));
  } catch (e) {
    throw await stop('uncertain_execution', { error: brief(e), urlBefore, pressed, before: before.evidence }, (before.captureErrors ?? []).map(x => `직전 ${x}`));
  }
  // 직후 화면은 기다리지 않고 바로 찍는다. 기다리면 뒤 검사의 시작이 늦어져 결과가 바뀐다. 찍는 데 걸린 시간은 남긴다.
  // capture는 예외를 던지지 않으므로 행동 성공 기록이 증거 수집 때문에 사라지지 않는다.
  const t = Date.now();
  const after = await capture(page, `${stepId}.after`);
  const afterCaptureMs = Date.now() - t;
  const captureErrors = [...(before.captureErrors ?? []).map(x => `직전 ${x}`), ...(after.captureErrors ?? []).map(x => `직후 ${x}`)];
  log({ kind: 'act', id: stepId, status: 'ok', urlBefore, url: page.url(), pressed, afterCaptureMs, evidence: [...before.evidence, ...after.evidence],
    ...(captureErrors.length ? { captureErrors } : {}) }, page);
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
  let started = Date.now();
  if (c.read === 'visual') return visual(page, c);
  // 관측 참조: 참조한 검사가 값을 읽지 못했으면 비교할 기대값이 없다.
  const expected = c.expected_from !== undefined ? expectedFrom(c, actuals.get(c.expected_from)) : c.expected;
  try {
    if (expected === undefined) r = { status: 'unresolved', reason: `expected_from ${c.expected_from}의 실제 값 없음` };
    else {
      const loc = c.target === undefined ? undefined : toLocator(page, plan.targets[c.target].target);
      const deadline = Date.now() + TIMEOUT;
      started = Date.now();
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
    log({ kind: 'check', id: checkId, status: 'error', error: brief(e), reads, url: page.url(), ...(await capture(page, checkId)) }, page);
    throw e;
  }
  if (r.actual !== undefined) actuals.set(checkId, r.actual);
  // 몇 번, 얼마 동안 다시 읽었는지 남긴다. "너무 일찍 읽었다"와 "기다려도 그대로였다"를 분류에서 가른다.
  log({ kind: 'check', id: checkId, ...r, expected, op: c.op, read: c.read, reads, waitedMs: Date.now() - started,
    ...(reads > 1 ? { first: { status: first!.status, actual: first!.actual } } : {}), url: page.url(),
    ...(r.status === 'passed' ? {} : await capture(page, checkId)) }, page);
  if (c.precondition && r.status !== 'passed') throw new Stopped(`${checkId} 선행조건 ${r.status}`);
  expect.soft(r.status, `${checkId}: ${c.read} ${c.op} ${JSON.stringify(expected ?? null)}, 실제 ${JSON.stringify(r.actual ?? null)}`).toBe('passed');
}

/**
 * 시각 검사: 판단하지 않고 화면이 멈추길 기다려 현재 화면(전체 페이지가 아니라 보이는 영역)을 찍고, 화면 크기·스크롤·대상 위치를 남긴다.
 * 대상이 하나로 찾아지지 않으면 무엇을 봐야 할지 모르므로 unresolved다. 촬영에 실패하면 판정할 증거가 없어 error다.
 */
async function visual(page: Page, c: Check): Promise<void> {
  let r: Record<string, unknown>;
  // 대상 조회·대기·촬영·위치 읽기 중 어느 단계의 예외도 기록 없이 사라지지 않게 한 곳에서 error로 남긴다.
  try {
    const loc = c.target === undefined ? undefined : toLocator(page, plan.targets[c.target].target);
    let ready = await settle(page, TIMEOUT);
    const count = loc ? await loc.count() : undefined;
    if (loc && (count !== 1 || await shapeChanged(page, plan.targets[c.target!].target))) {
      r = { status: 'unresolved', count, reason: '시각 검사 대상을 하나로 찾지 못함', ...(await capture(page, c.id)) };
    } else {
      // 대상이 화면 밖이면 보이게 옮긴 뒤 찍는다. 옮겼으면 다시 멈추길 기다린다. 스크롤 위치는 재현 비교에 남긴다.
      if (loc && !(await loc.evaluate(e => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }))) {
        await loc.scrollIntoViewIfNeeded({ timeout: TIMEOUT });
        ready = (await settle(page, TIMEOUT)) && ready;
      }
      const image = `evidence/${c.id}.visual.png`;
      mkdirSync(join(dir!, 'evidence'), { recursive: true });
      await page.screenshot({ path: join(dir!, image) });
      const scroll = await page.evaluate(() => ({ x: Math.round(scrollX), y: Math.round(scrollY) }));
      const box = loc ? await loc.boundingBox() : null;
      // ready=false: 기한 안에 화면이 멈추지 않았다(로딩·전환 중일 수 있음). 판정은 이 촬영으로 결함을 만들지 않는다.
      r = { status: 'visual_pending', count, visual: { viewport: page.viewportSize(), scroll, box, image, ready }, evidence: [image] };
    }
  } catch (e) {
    log({ kind: 'check', id: c.id, status: 'error', error: brief(e), read: c.read, url: page.url(), ...(await capture(page, c.id)) }, page);
    throw e;
  }
  log({ kind: 'check', id: c.id, expected: c.expected, op: c.op, read: c.read, url: page.url(), ...r }, page);
  if (r.status === 'unresolved') expect.soft('unresolved', `${c.id}: 시각 검사 대상을 하나로 찾지 못함`).toBe('passed');
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
  // 읽기 규칙 버전이 없는 예전 계획은 예전 규칙으로 읽는다(기대값이 그 규칙으로 만들어졌다).
  const read2 = plan.textRead === 'name+content' ? ariaText : ariaTextV1;
  const text = async (l: Locator) => read2(await l.ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]);
  if (c.read === 'items') {
    const items: string[] = [];
    for (const l of await loc.all()) items.push(await text(l));
    const actual = JSON.stringify(items);
    // 정렬 기준 값을 특정할 수 없으면 결함이 아니라 값을 못 읽은 것이다.
    if ((c.op === 'sorted_asc' || c.op === 'sorted_desc') && !sortKeys(actual, expected)) return { status: 'unresolved', actual, count, reason: '정렬 기준 값을 특정할 수 없음(항목 2개 미만, 기준 숫자가 없거나 여러 개, 모르는 기준)' };
    return done(actual, count);
  }
  if (c.read === 'visible' && count === 0) return done('false', count);
  if (count !== 1) return { status: 'unresolved', count };
  if (c.read === 'text') return done(await text(loc), count);
  // 선택 상자는 화면(snapshot)과 select 동작이 쓰는 옵션 라벨로 읽는다. 내부 value는 모델이 볼 수 없다.
  if (c.read === 'value') {
    // 다중 선택은 라벨 배열(JSON)로 남겨 "A, B" 같은 라벨끼리 섞이지 않게 한다.
    const label = await loc.evaluate(e => !(e instanceof HTMLSelectElement) ? null
      : e.multiple ? JSON.stringify([...e.selectedOptions].map(o => o.label)) : e.selectedOptions[0]?.label ?? '');
    return done(label ?? await loc.inputValue(), count);
  }
  if (c.read === 'checked') return done(String(await loc.isChecked()), count);
  return done(String(await loc.isVisible()), count);
}

/** 분류 입력이 커지지 않도록 대상 표현을 자른다. 원본 화면은 evidence에 있다. */
const clip = (s: string) => s.length > 2000 ? `${s.slice(0, 2000)}
(이후 생략)` : s;
const brief = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];
