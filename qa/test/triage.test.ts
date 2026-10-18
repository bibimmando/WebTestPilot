import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { runPlan, type RunResult } from '../src/run.ts';
import { actionsUpTo, checkQuotes, judge, preclassify, systemVerdict, triage, type Verdict } from '../src/triage.ts';
import { Budget, type Send } from '../src/agent.ts';
import type { Plan } from '../src/plan.ts';

let server: Server | undefined;
let origin = '';
let counter = 0;
const FLAKY = `<!doctype html><meta charset="utf-8"><title>번갈아</title><h1>결과 확인</h1><button>확인</button><p role="status"></p>
<script>document.querySelector('button').onclick = async () => {
  document.querySelector('p').textContent = await (await fetch('/counter')).text();
};</script>`;

before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://x').pathname;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (path === '/counter') return res.end(++counter % 2 ? '홀수' : '짝수');
    if (path === '/flaky.html') return res.end(FLAKY);
    try { res.end(await readFile(new URL(`./fixtures${path}`, import.meta.url))); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server?.close(); });

const dir = (name: string) => fileURLToPath(new URL(`../runs/test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, import.meta.url));
const src = (id: string, quote: string) => ({ kind: 'requirement' as const, id, quote });

function plan(): Plan {
  return {
    version: 1, observations: [], features: [], questions: [],
    requirements: [
      { id: 'R1', text: '담기를 누르면 장바구니에 5개가 담긴다' },
      { id: 'R2', text: '쿠폰 적용 창에서 확인을 누를 수 있다' },
      { id: 'R3', text: '확인을 누르면 결과가 짝수로 표시된다' },
    ],
    targets: {
      T1: { target: { role: 'listitem' }, group: true, url: `${origin}/list.html` },
      T2: { target: { role: 'button', name: '^담기$', within: { role: 'listitem', text: '상품 걡 .*?원' } }, group: false, url: `${origin}/list.html` },
      T3: { target: { text: '장바구니 \\(.*?\\)' }, group: false, url: `${origin}/list.html` },
      T4: { target: { role: 'button', name: '^없어진 버튼$' }, group: false, url: `${origin}/modal.html` },
      T5: { target: { role: 'button', name: '^확인$' }, group: false, url: `${origin}/flaky.html` },
      T6: { target: { role: 'status' }, group: false, url: `${origin}/flaky.html` },
    },
    scenarios: [
      { id: 'S1', title: '담기', covers: ['R1'], start: { url: `${origin}/list.html` },
        steps: [{ id: 'S1.A1', op: 'click', target: 'T2' }],
        checks: [
          { id: 'S1.C1', after: 'start', target: 'T1', read: 'count', op: 'equals', expected: '30', source: { kind: 'inferred', rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } },
          { id: 'S1.C2', after: 'S1.A1', target: 'T3', read: 'text', op: 'equals', expected: '장바구니 (5)', source: src('R1', '5개가 담긴다') },
        ] },
      { id: 'S2', title: '사라진 버튼', covers: ['R2'], start: { url: `${origin}/modal.html` },
        steps: [{ id: 'S2.A1', op: 'click', target: 'T4' }],
        checks: [{ id: 'S2.C1', after: 'S2.A1', target: 'T4', read: 'visible', op: 'equals', expected: 'true', source: src('R2', '확인을 누를 수 있다') }] },
      { id: 'S3', title: '번갈아 바뀌는 결과', covers: ['R3'], start: { url: `${origin}/flaky.html` },
        steps: [{ id: 'S3.A1', op: 'click', target: 'T5' }],
        checks: [{ id: 'S3.C1', after: 'S3.A1', target: 'T6', read: 'text', op: 'equals', expected: '짝수', source: src('R3', '짝수로 표시된다') }] },
    ],
    unplanned: [],
  };
}

// 가짜 분류 모델. 항목마다 다르게 답한다.
// - S2.A1(사라진 버튼): 첫 답은 시작 snapshot만 인용해 거부되고, 다시 실패 시점 snapshot을 인용한다.
// - S3.C1(불일치): 자동화 실패로 분류한다. 원래 불일치는 남아야 한다.
// - 그 밖(S1.C2 불일치): 분류하지 않고 끝낸다. 분류 못 한 불일치는 mismatch로 남아야 한다.
function fakeTriage(): Send & { calls: number; firstMessages: string[] } {
  const send = async (req: Anthropic.MessageCreateParamsNonStreaming) => {
    send.calls++;
    const first = String(req.messages[0].content);
    if (req.messages.length === 1) send.firstMessages.push(first);
    const last = req.messages.at(-1)!;
    const rejected = Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result' && b.is_error);
    const classify = (input: Record<string, unknown>) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${send.calls}`, name: 'classify', input }] });
    const answer = first.includes('실패한 항목 S2.A1')
      ? classify({ class: 'app_defect_candidate', reason: '시작 화면에 계획한 버튼이 없다',
        quotes: [{ file: rejected ? 'evidence/S2.A1.aria.txt' : 'evidence/S2.start.aria.txt', text: 'button "쿠폰 적용"' }] })
      : first.includes('실패한 항목 S3.C1')
        ? classify({ class: 'automation_failure', reason: '값이 응답 타이밍에 따라 바뀐다', quotes: [{ file: 'evidence/S3.C1.aria.txt', text: 'heading "결과 확인"' }] })
        : { stop_reason: 'end_turn', content: [{ type: 'text', text: '판단하지 않음' }] };
    return {
      id: 'm', type: 'message', role: 'assistant', model: req.model, stop_sequence: null, ...answer,
      usage: { input_tokens: 500, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
  send.calls = 0;
  send.firstMessages = [] as string[];
  return send;
}

test('분류·재현: 재현되는 불일치, AI가 인용으로 분류한 사라진 대상, 재실행에서 바뀌는 결과를 구분한다', async () => {
  counter = 0;
  const p = plan();
  const policy = { origins: [origin] };
  const run = await runPlan({ plan: p, policy, runDir: dir('judge'), timeoutMs: 1500 });
  const budget = new Budget(1);
  const send = fakeTriage();
  const j = await judge({ plan: p, run, send, model: 'claude-sonnet-5-5', budget, reproduceDir: dir('judge-repro'), timeoutMs: 1500 });
  const v = Object.fromEntries(j.verdicts.map(x => [x.id, x]));

  // 분류 입력에 행동 전후 증거·누른 요소·재시도 기록이 들어간다.
  const msg = send.firstMessages.find(m => m.includes('실패한 항목 S1.C2'))!;
  assert.ok(msg.includes('--- evidence/S1.A1.before.aria.txt') && msg.includes('--- evidence/S1.A1.after.aria.txt'), msg.slice(0, 2000));
  const actions = JSON.parse(msg.match(/행동 기록: (.*)/)![1]);
  assert.match(actions[0].pressed.aria, /담기/);
  assert.ok(actions[0].pressed.box && actions[0].urlBefore, JSON.stringify(actions));
  const comparison = JSON.parse(msg.match(/비교 기록: (.*)/)![1]);
  assert.ok(comparison.reads > 1 && comparison.waitedMs > 0, JSON.stringify(comparison));

  assert.equal(v['S1.C1'].class, 'passed_inferred');
  // 불일치도 AI 분류에 보낸다. 분류하지 못하면 mismatch로 남고 재현은 그대로 한다.
  assert.deepEqual([v['S1.C2'].observed, v['S1.C2'].class, v['S1.C2'].reproduction], ['mismatch', 'mismatch', 'reproduced']);
  assert.match(JSON.stringify(v['S1.C2'].triage), /분류 미완료: no_submit/);

  assert.equal(v['S2.A1'].observed, 'not_executed:target_changed:0');
  assert.equal(v['S2.A1'].class, 'app_defect_candidate');
  assert.deepEqual(v['S2.A1'].triage, { reason: '시작 화면에 계획한 버튼이 없다', quotes: [{ file: 'evidence/S2.A1.aria.txt', text: 'button "쿠폰 적용"' }] });
  assert.equal(send.calls, 4, 'S1.C2 1번 + S2.A1 2번(첫 답 거부) + S3.C1 1번');
  assert.ok(existsSync(`${run.runDir}/triage/S2.A1.json`), 'AI 분류 대화 기록을 남긴다');
  assert.equal(v['S2.A1'].reproduction, 'reproduced');
  assert.deepEqual([v['S2.C1'].class, v['S2.C1'].cause], ['not_run', 'S2.A1']);

  // 자동화 실패로 분류돼도 원래 불일치는 남고 재현도 한다.
  assert.deepEqual([v['S3.C1'].observed, v['S3.C1'].class, v['S3.C1'].reproduction], ['mismatch', 'automation_failure', 'flaky']);
  const s3Message = send.firstMessages.find(m => m.includes('실패한 항목 S3.C1'))!;
  assert.match(s3Message, /비교 기록: \{"read":"text","op":"equals","expected":"짝수","actual":"홀수"/, '기대·실제·읽기 방식을 필드로 전달');

  assert.ok(existsSync(`${run.runDir}/verdicts.json`));
  assert.ok(existsSync(`${run.runDir}/evidence/S2.A1.aria.txt`) && existsSync(`${run.runDir}/evidence/S2.A1.png`));
  assert.ok(budget.spent > 0);
  assert.deepEqual(j.requirements.map(r => [r.id, r.classes]), [
    ['R1', { mismatch: 1 }], ['R2', { app_defect_candidate: 1, not_run: 1 }], ['R3', { automation_failure: 1 }],
  ]);
});

test('AI 분류가 끝나지 않으면 uncertain으로 남기고 이유를 기록한다', async () => {
  const p = plan();
  p.scenarios = [p.scenarios[1]];
  p.requirements = [p.requirements[1]];
  const policy = { origins: [origin] };
  const run = await runPlan({ plan: p, policy, runDir: dir('triage-fail'), timeoutMs: 1000 });
  const j = await judge({ plan: p, run, send: fakeTriage(), model: 'claude-sonnet-5-5', budget: new Budget(0.0001),
    reproduceDir: dir('triage-fail-repro'), timeoutMs: 1000 });
  const a1 = j.verdicts.find(x => x.id === 'S2.A1')!;
  assert.equal(a1.class, 'uncertain');
  assert.match(JSON.stringify(a1.triage), /budget/);
  assert.equal(a1.reproduction, undefined, 'uncertain은 재실행하지 않는다');
  const again = await judge({ plan: p, run, send: fakeTriage(), model: 'claude-sonnet-5-5', budget: new Budget(0.0001),
    reproduceDir: dir('triage-fail-repro2'), timeoutMs: 1000 });
  assert.ok(j.file.endsWith('verdicts.json') && again.file.endsWith('verdicts-2.json'), '이전 판정 파일을 덮어쓰지 않는다');
  assert.deepEqual([j.verdicts.find(x => x.id === 'S2.A1')!.triageLog, again.verdicts.find(x => x.id === 'S2.A1')!.triageLog],
    ['triage/S2.A1.json', 'triage-2/S2.A1.json'], '분류 대화도 판정 회차별로 남는다');
  assert.ok(existsSync(`${run.runDir}/triage/S2.A1.json`) && existsSync(`${run.runDir}/triage-2/S2.A1.json`));
});

test('1차 분류: 무효 시나리오와 실행 불명확 행동은 AI에 보내지 않는다', () => {
  const p = plan();
  const scenario = (id: string, extra: Partial<RunResult['scenarios'][number]>) => ({
    id, valid: true, invalid: [], start: 'ok' as const, precondition: 'none' as const, steps: [], checks: [], blocked: [], violations: [], ...extra });
  const run = {
    runDir: '', exitCode: 1, problems: [], requirements: [],
    scenarios: [
      scenario('S1', { valid: false, invalid: ['정책 위반: redirect'] }),
      scenario('S2', { steps: [{ id: 'S2.A1', status: 'uncertain_execution', error: 'timeout' }],
        checks: [{ id: 'S2.C1', status: 'not_run', source: 'requirement', expected: 'true' }] }),
      scenario('S3', { steps: [{ id: 'S3.A1', status: 'ok' }], checks: [{ id: 'S3.C1', status: 'unresolved', count: 2, source: 'requirement', expected: '짝수' }] }),
    ],
  } satisfies RunResult;
  const v = Object.fromEntries(preclassify(p, run).map(x => [x.id, x]));
  assert.deepEqual([v['S1.C1'].class, v['S1.C2'].class], ['invalid', 'invalid']);
  assert.equal(v['S2.A1'].class, 'uncertain_execution');
  assert.deepEqual(v['S2.A1'].requirements, ['R2'], '행동 실패는 시나리오가 다루는 요구사항에 집계된다');
  assert.deepEqual([v['S2.C1'].class, v['S2.C1'].cause], ['not_run', 'S2.A1']);
  assert.deepEqual([v['S3.C1'].class, v['S3.C1'].observed], ['needs_triage', 'unresolved:2']);

  const errored = { ...run, scenarios: [scenario('S1', { steps: [{ id: 'S1.A1', status: 'not_run' }], checks: [
    { id: 'S1.C1', status: 'error', error: 'locator.count: Target closed', source: 'inferred', expected: '30' },
    { id: 'S1.C2', status: 'not_run', source: 'requirement', expected: '장바구니 (5)' }] }), run.scenarios[1], run.scenarios[2]] } satisfies RunResult;
  const w = Object.fromEntries(preclassify(p, errored).map(x => [x.id, x]));
  assert.deepEqual([w['S1.C1'].class, w['S1.C1'].error], ['needs_triage', 'locator.count: Target closed']);
  assert.equal(w['S1.C2'].cause, 'S1.C1', '검사 예외로 멈춘 경우도 원인으로 연결한다');
});

test('인용 검증: 실패 시점 증거 인용 필수, 짧은 인용과 없는 문장은 거부', () => {
  const files = new Map([['evidence/S2.start.aria.txt', '- button "쿠폰 적용"'], ['evidence/S2.A1.aria.txt', '- heading "주문 요약"']]);
  const own = new Set(['evidence/S2.A1.aria.txt']);
  const q = (file: string, text: string) => ({ class: 'app_defect_candidate', quotes: [{ file, text }] });
  assert.deepEqual(checkQuotes(q('evidence/S2.A1.aria.txt', 'heading "주문 요약"'), files, own), []);
  assert.ok(checkQuotes(q('evidence/S2.start.aria.txt', 'button "쿠폰 적용"'), files, own).some(e => e.includes('실패 시점 증거')));
  assert.ok(checkQuotes(q('evidence/S2.A1.aria.txt', 'head'), files, own).some(e => e.includes('6자 이상')));
  assert.ok(checkQuotes(q('evidence/S2.A1.aria.txt', 'heading "결제"'), files, own).some(e => e.includes('그대로 있는')));
  assert.deepEqual(checkQuotes({ class: 'uncertain', quotes: [] }, files, own), []);
});

test('시스템 판정: 끝난 항목은 반드시 판정하고, 끝나지 않은 항목은 사유와 함께 미완료로 둔다', () => {
  const p = plan();
  const v = (extra: Partial<Verdict>): Verdict => ({ id: 'S1.C1', scenario: 'S1', kind: 'check', requirements: [], observed: 'mismatch', class: 'mismatch', ...extra });
  const level = (extra: Partial<Verdict>) => systemVerdict(p, v(extra)).level;
  assert.equal(level({ class: 'passed_inferred' }), 'not_bug');
  assert.equal(level({ class: 'automation_failure' }), 'not_bug');
  assert.equal(level({ class: 'app_defect_candidate', source: 'requirement', reproduction: 'reproduced' }), 'bug_high');
  assert.equal(level({ class: 'app_defect_candidate', source: 'constraint', reproduction: 'reproduced' }), 'bug_medium', '화면 제약 근거는 확신 중간까지');
  assert.equal(level({ class: 'app_defect_candidate', source: 'inferred', reproduction: 'reproduced' }), 'bug_medium', '일반 규칙은 최대 확신 중간');
  assert.equal(level({ class: 'app_defect_candidate', source: 'requirement', reproduction: 'flaky' }), 'hold');
  assert.equal(level({ class: 'app_defect_candidate', source: 'requirement', reproduction: 'reproduction_inconclusive' }), 'incomplete');
  assert.equal(level({ class: 'app_defect_candidate', source: 'observed', reproduction: 'reproduced' }), 'incomplete');
  // 실패 시점 snapshot을 못 남긴 항목의 AI 결함 분류는 증거로 확인할 수 없다. 스크린샷만 빠진 것은 판정을 막지 않는다.
  const triaged = { class: 'app_defect_candidate' as const, source: 'requirement', reproduction: 'reproduced' as const, triage: { reason: '안 늘어남', quotes: [] } };
  assert.equal(level({ ...triaged, captureErrors: ['aria: 페이지 닫힘'] }), 'incomplete');
  assert.match(systemVerdict(p, v({ ...triaged, captureErrors: ['aria: 페이지 닫힘'] })).reason, /증거 부족/);
  assert.equal(level({ ...triaged, captureErrors: ['screenshot: 시간 초과'] }), 'bug_high');
  // 기술적 미완료는 억지로 판정하지 않는다.
  for (const c of ['mismatch', 'uncertain', 'uncertain_execution', 'precondition_failed', 'not_run', 'invalid', 'policy_blocked'] as const) assert.equal(level({ class: c }), 'incomplete', c);
});

test('행동 기록: 입력 원문은 넘기지 않고, 그 항목 직전까지의 행동만 최근 10개로 준다', () => {
  const steps = Array.from({ length: 12 }, (_, i) => ({ id: `S9.A${i + 1}`, op: 'click' as const, target: 'T1' }));
  steps[0] = { id: 'S9.A1', op: 'fill', target: 'T1', value: 'secret-password' } as any;
  steps[11] = { ...steps[11], op: 'press', value: 'Enter' } as any;
  const s = { id: 'S9', title: 't', covers: [], start: { url: 'http://x/' }, steps,
    checks: [{ id: 'S9.C1', after: 'S9.A3', target: 'T1', read: 'text' as const, op: 'equals' as const, expected: 'x', source: { kind: 'observed' as const } }] };
  const r = { id: 'S9', valid: true, invalid: [], start: 'ok' as const, precondition: 'none' as const, blocked: [], violations: [], checks: [],
    steps: steps.map(st => ({ id: st.id, status: 'ok' as const })) };
  const v = (id: string, kind: 'check' | 'act'): Verdict => ({ id, scenario: 'S9', kind, requirements: [], observed: 'mismatch', class: 'mismatch' });
  const forCheck = actionsUpTo(s, v('S9.C1', 'check'), r, { T1: { target: { role: 'button', anchor: '^Quantity$', nth: 1, of: 2 }, group: false, url: 'http://x/' } });
  assert.deepEqual((forCheck[1] as any).target, { role: 'button', anchor: '^Quantity$', nth: 1, of: 2 }, '계획된 대상 설명을 함께 준다');
  assert.deepEqual(forCheck.map(a => a.id), ['S9.A1', 'S9.A2', 'S9.A3'], '검사 뒤의 행동은 주지 않는다');
  assert.ok(!JSON.stringify(forCheck).includes('secret-password') && (forCheck[0] as any).valueLength === 15);
  const forLast = actionsUpTo(s, v('S9.A12', 'act'), r);
  assert.equal(forLast.length, 10);
  assert.equal((forLast.at(-1) as any).value, 'Enter', '누른 키는 그대로 준다');
});

test('Q22 제한: 결정적 관계 규칙 위반만 확신 높음, 다른 일반 규칙은 확신 중간', () => {
  const p = plan();
  const s = p.scenarios[0];
  s.checks.push(
    { id: 'S1.C8', after: 'S1.A1', target: 'T1', read: 'count', op: 'same_number', expected_from: 'S1.C2', source: { kind: 'inferred', rule: 'count-matches-list', quote: '개수 문구가 목록 수를 나타낸다' } },
    { id: 'S1.C10', after: 'start', target: 'T1', read: 'count', op: 'same_number', expected_from: 'S1.C1', source: { kind: 'inferred', rule: 'count-matches-list', quote: '같은 대상 같은 시점 재비교(별칭)' } },
    { id: 'S1.C9', after: 'start', target: 'T1', read: 'count', op: 'greater', expected: '0', source: { kind: 'inferred', rule: 'quantity-bounds', quote: '수량은 0보다 커야 한다는 규칙' } });
  const v = (id: string): Verdict => ({ id, scenario: 'S1', kind: 'check', requirements: [], source: 'inferred', observed: 'mismatch', class: 'app_defect_candidate', reproduction: 'reproduced' });
  assert.equal(systemVerdict(p, v('S1.C8')).level, 'bug_high');
  assert.equal(systemVerdict(p, v('S1.C9')).level, 'bug_medium');
  assert.equal(systemVerdict(p, v('S1.C10')).level, 'bug_medium', '같은 대상·같은 시점 재비교는 관계 비교가 아니다');
  assert.equal(systemVerdict(p, { ...v('S1.C8'), class: 'not_applicable' }).level, 'hold');
});

test('분류: 같은 검사의 복제본은 원본 분류를 공유하고, 불일치를 먼저·원본을 복제본보다 먼저 분류한다', async () => {
  const p = plan();
  const orig = p.scenarios[0];
  p.scenarios.push({ ...structuredClone(orig), id: 'S9', variantOf: 'S1', start: { url: orig.start.url },
    steps: orig.steps.map(st => ({ ...st, id: st.id.replace('S1.', 'S9.') })),
    checks: orig.checks.map(c => ({ ...c, id: c.id.replace('S1.', 'S9.'), after: c.after.replace('S1.', 'S9.') })) });
  const order: string[] = [];
  const send: Send = async req => {
    order.push(String(req.messages[0].content).match(/실패한 항목 (\S+):/)![1]);
    return { id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: 'classify', input: { class: 'uncertain', reason: '증거 부족', quotes: [] } }],
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message;
  };
  const sr = (id: string) => ({ id, valid: true, invalid: [], start: 'ok' as const, precondition: 'none' as const, steps: [], checks: [], blocked: [], violations: [] });
  const run = { runDir: dir('share'), exitCode: 1, problems: [], requirements: [], scenarios: [sr('S1'), sr('S9')] } satisfies RunResult;
  const v = (id: string, scenario: string, kind: 'check' | 'act', observed: string): Verdict =>
    ({ id, scenario, kind, requirements: [], observed, class: observed === 'mismatch' ? 'mismatch' : 'needs_triage' });
  const verdicts = [v('S9.C2', 'S9', 'check', 'mismatch'), v('S1.A1', 'S1', 'act', 'not_executed:not_actionable'), v('S1.C2', 'S1', 'check', 'mismatch')];
  await triage({ plan: p, run, verdicts, send, model: 'claude-sonnet-5-5', budget: new Budget(1) });
  assert.deepEqual(order, ['S1.C2', 'S1.A1'], '원본 불일치 → 행동 실패 순, 복제본은 따로 분류하지 않는다');
  assert.deepEqual([verdicts[0].class, verdicts[0].triageSharedFrom], ['uncertain', 'S1.C2']);

  // 실제 값이 다르면(페이지마다 원인이 다를 수 있다) 공유하지 않고 따로 분류한다.
  order.length = 0;
  const withValues = { ...run, scenarios: [{ ...sr('S1'), checks: [{ id: 'S1.C2', status: 'mismatch' as const, source: 'inferred', actual: '1', expected: '2' }] },
    { ...sr('S9'), checks: [{ id: 'S9.C2', status: 'mismatch' as const, source: 'inferred', actual: '배송비는 얼마인가요?', expected: '$25' }] }] } satisfies RunResult;
  const again = [v('S9.C2', 'S9', 'check', 'mismatch'), v('S1.C2', 'S1', 'check', 'mismatch')];
  await triage({ plan: p, run: withValues, verdicts: again, send, model: 'claude-sonnet-5-5', budget: new Budget(1) });
  assert.deepEqual([order, again[0].triageSharedFrom], [['S1.C2', 'S9.C2'], undefined]);

  // 동시에 분류해도 같은 검사 묶음은 한 번만 분류하고, 복제본은 원본 분류를 공유한다.
  order.length = 0;
  let open = 0, peak = 0;
  const slow: Send = async req => { open++; peak = Math.max(peak, open); await new Promise(res => setTimeout(res, 30)); open--; return send(req); };
  const par = [v('S9.C2', 'S9', 'check', 'mismatch'), v('S1.A1', 'S1', 'act', 'not_executed:not_actionable'), v('S1.C2', 'S1', 'check', 'mismatch')];
  await triage({ plan: p, run, verdicts: par, send: slow, model: 'claude-sonnet-5-5', budget: new Budget(1), concurrency: 3 });
  assert.deepEqual([[...order].sort(), peak, par[0].class, par[0].triageSharedFrom], [['S1.A1', 'S1.C2'], 2, 'uncertain', 'S1.C2']);
});
