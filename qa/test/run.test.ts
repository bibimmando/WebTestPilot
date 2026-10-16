import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPlan } from '../src/run.ts';
import { specFor, sequence } from '../src/generate.ts';
import { reconcile, type Entry } from '../src/reconcile.ts';
import { cloneScenarios, validate, type Plan } from '../src/plan.ts';
import { preclassify, systemVerdict } from '../src/triage.ts';

let server: Server | undefined;
let origin = '';
const writes: string[] = [];
before(async () => {
  server = createServer(async (req, res) => {
    if (req.method !== 'GET') { writes.push(`${req.method} ${req.url}`); return res.end('ok'); }
    try {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(await readFile(new URL(`./fixtures${new URL(req.url!, 'http://x').pathname}`, import.meta.url)));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server?.close(); });

const runDir = (name: string) =>
  fileURLToPath(new URL(`../runs/test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, import.meta.url));
const src = (id: string, quote: string) => ({ kind: 'requirement' as const, id, quote });

function plan(): Plan {
  return {
    version: 1, observations: [], features: [], questions: [],
    requirements: [
      { id: 'R1', text: '담기를 누르면 장바구니 개수가 1 늘어난다' },
      { id: 'R2', text: '쿠폰 적용 창에서 확인을 누를 수 있다' },
      { id: 'R3', text: '이메일을 넣고 가입하면 가입 요청을 보낸다' },
      { id: 'R4', text: '주문 내역은 마이페이지에 남는다' },
      { id: 'R5', text: '카테고리 표시는 Textiles이다' },
    ],
    targets: {
      T1: { target: { role: 'listitem' }, group: true, url: `${origin}/list.html` },
      T2: { target: { role: 'button', name: '^담기$', within: { role: 'listitem', text: '상품 걡 .*?원' } }, group: false, url: `${origin}/list.html` },
      T3: { target: { text: '장바구니 \\(.*?\\)' }, group: false, url: `${origin}/list.html` },
      T4: { target: { role: 'button', name: '^없어진 버튼$' }, group: false, url: `${origin}/modal.html` },
      T5: { target: { role: 'textbox', name: '^이메일$' }, group: false, url: `${origin}/form.html` },
      T6: { target: { role: 'button', name: '^가입$' }, group: false, url: `${origin}/form.html` },
      T7: { target: { role: 'heading', name: '^가입 완료$' }, group: false, url: `${origin}/form.html` },
      T8: { target: { role: 'paragraph', text: '^Textiles$' }, group: false, url: `${origin}/styled.html` },
    },
    scenarios: [
      { id: 'S1', title: '담기', covers: ['R1'], start: { url: `${origin}/list.html` },
        steps: [{ id: 'S1.A1', op: 'click', target: 'T2' }],
        checks: [
          { id: 'S1.C1', after: 'start', target: 'T1', read: 'count', op: 'equals', expected: '30', source: { kind: 'observed' } },
          { id: 'S1.C2', after: 'S1.A1', target: 'T3', read: 'text', op: 'equals', expected: '장바구니 (1)', source: src('R1', '1 늘어난다') },
          { id: 'S1.C3', after: 'S1.A1', target: 'T3', read: 'text', op: 'equals', expected: '장바구니 (5)', source: { kind: 'inferred', rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } },
        ] },
      { id: 'S2', title: '사라진 버튼', covers: ['R2'], start: { url: `${origin}/modal.html` },
        steps: [{ id: 'S2.A1', op: 'click', target: 'T4' }],
        checks: [{ id: 'S2.C1', after: 'S2.A1', target: 'T4', read: 'visible', op: 'equals', expected: 'true', source: src('R2', '확인을 누를 수 있다') }] },
      { id: 'S3', title: '가입 요청', covers: ['R3'], start: { url: `${origin}/form.html` },
        steps: [{ id: 'S3.A1', op: 'fill', target: 'T5', value: 'a@b.c' }, { id: 'S3.A2', op: 'click', target: 'T6' }],
        checks: [{ id: 'S3.C1', after: 'S3.A2', target: 'T7', read: 'visible', op: 'equals', expected: 'false', source: src('R3', '가입 요청을 보낸다') }] },
      // CSS text-transform으로 대문자로 보이지만 DOM 텍스트(모델이 본 값)는 Textiles다. 첫 실측의 오탐 원인 회귀.
      { id: 'S4', title: '표시 변환', covers: ['R5'], start: { url: `${origin}/styled.html` }, steps: [],
        checks: [{ id: 'S4.C1', after: 'start', target: 'T8', read: 'text', op: 'equals', expected: 'Textiles', source: src('R5', 'Textiles') }] },
    ],
    unplanned: [{ requirement: 'R4', reason: '로그인 필요' }],
  };
}

test('spec은 ID만 담은 고정 템플릿이고, 같은 plan이면 같은 코드다', () => {
  const s = plan().scenarios[0];
  const code = specFor(s, '../../src/fixture.ts');
  assert.equal(code, specFor(s, '../../src/fixture.ts'));
  assert.deepEqual(sequence(s).map(x => x.id), ['S1', 'S1.C1', 'S1.A1', 'S1.C2', 'S1.C3']);
  assert.ok(!code.includes('장바구니') && !code.includes('expect('), code);
  const evil = { ...s, id: 'S9', title: '"); require("child_process"); ("' };
  assert.ok(specFor(evil, 'x').includes(JSON.stringify(`S9 ${evil.title}`)));
});

test('실행: 통과·불일치·대상 사라짐·쓰기 차단을 ledger로 구분한다', async () => {
  writes.length = 0;
  const p = plan();
  const r = await runPlan({ plan: p, policy: { origins: [origin] }, runDir: runDir('mixed'), timeoutMs: 1500 });
  const log = readFileSync(`${r.runDir}/playwright.log`, 'utf8');
  assert.deepEqual(r.problems, [], log);
  const [s1, s2, s3, s4] = r.scenarios;
  assert.deepEqual(s4.checks.map(c => [c.status, c.actual]), [['passed', 'Textiles']]);

  assert.equal(s1.start, 'ok', log);
  assert.deepEqual(s1.checks.map(c => [c.id, c.status, c.actual]), [
    ['S1.C1', 'passed', '30'], ['S1.C2', 'passed', '장바구니 (1)'], ['S1.C3', 'mismatch', '장바구니 (1)'],
  ]);

  assert.equal(s2.steps[0].status, 'not_executed');
  assert.equal(s2.steps[0].reason, 'target_changed');
  assert.equal(s2.checks[0].status, 'not_run');

  assert.deepEqual(s3.steps.map(x => x.status), ['ok', 'ok']);
  assert.equal(s3.checks[0].status, 'passed');
  assert.ok(s3.blocked.some(b => b.startsWith('POST') && b.includes('/signup')), JSON.stringify(s3));
  assert.deepEqual(writes, []);

  const n = (o: Partial<Record<string, number>>) => ({ passed: 0, mismatch: 0, unresolved: 0, error: 0, not_run: 0, invalid: 0, ...o });
  assert.deepEqual(r.scenarios.map(s => [s.id, s.valid]), [['S1', true], ['S2', true], ['S3', true], ['S4', true]], JSON.stringify(r.scenarios.map(s => s.invalid)));
  assert.deepEqual(r.requirements.map(q => [q.id, q.plan, q.checks]), [
    ['R1', 'planned', n({ passed: 1 })],
    ['R2', 'planned', n({ not_run: 1 })],
    ['R3', 'planned', n({ passed: 1 })],
    ['R4', 'unplanned', n({})],
    ['R5', 'planned', n({ passed: 1 })],
  ]);
  assert.notEqual(r.exitCode, 0, 'mismatch와 실패한 행동이 있으면 playwright 종료 코드도 실패');
  const manifest = JSON.parse(readFileSync(`${r.runDir}/manifest.json`, 'utf8'));
  assert.ok(manifest.files['src/fixture.ts'] && manifest.playwright && manifest.timeoutMs === 1500, JSON.stringify(manifest));
});

test('실행 중 호출자가 plan을 바꿔도 판정은 실행 시작 때의 사본으로 한다', async () => {
  const p = plan();
  p.scenarios = [p.scenarios[0]];
  p.requirements = p.requirements.filter(r => r.id === 'R1');
  p.unplanned = [];
  const pending = runPlan({ plan: p, policy: { origins: [origin] }, runDir: runDir('frozen'), timeoutMs: 1500 });
  p.scenarios[0].checks[1].expected = '바뀐 기대값';
  const r = await pending;
  assert.deepEqual(r.scenarios[0].checks.map(c => [c.status, c.expected]).slice(1, 2), [['passed', '장바구니 (1)']]);
});

test('계약을 통과하지 못한 plan은 실행하지 않고, 같은 실행 폴더는 덮어쓰지 않는다', async () => {
  const bad = plan();
  bad.unplanned = [];
  await assert.rejects(runPlan({ plan: bad, policy: { origins: [origin] }, runDir: runDir('bad') }), /R4 is neither covered/);
  const p = plan();
  p.scenarios = [];
  p.unplanned = p.requirements.map(r => ({ requirement: r.id, reason: '테스트' }));
  const dir = runDir('twice');
  await runPlan({ plan: p, policy: { origins: [origin] }, runDir: dir });
  await assert.rejects(runPlan({ plan: p, policy: { origins: [origin] }, runDir: dir }), /덮어쓰지 않음/);
});

const e = (kind: Entry['kind'], id: string, extra: Partial<Entry> = {}): Entry =>
  ({ kind, at: '', ...(kind === 'start' || kind === 'policy' ? { scenario: id } : { id }), ...extra });
const policyOk = (id: string) => e('policy', id, { blocked: [], violations: [] });

test('reconcile: 건너뛴 검사·중복·모르는 ID는 그 시나리오를 무효로 만든다', () => {
  const r = reconcile(plan(), [
    e('start', 'S1', { status: 'ok' }),
    e('act', 'S1.A1', { status: 'ok' }),                               // S1.C1을 건너뜀
    e('check', 'S1.C2', { status: 'passed', actual: '장바구니 (1)' }),
    e('check', 'S1.C2', { status: 'passed', actual: '장바구니 (1)' }),  // 중복
    e('check', 'S9.C1', { status: 'passed' }),                          // 모르는 ID
    policyOk('S1'),
  ]);
  const s1 = r.scenarios[0];
  assert.equal(s1.valid, false);
  assert.deepEqual(s1.checks.map(c => c.status), ['not_run', 'passed', 'not_run']);
  assert.ok(r.problems.some(x => x.startsWith('S1: 2번째 기록이 act:S1.A1')), r.problems.join('\n'));
  assert.ok(r.problems.some(x => x.includes('S9.C1')));
  assert.equal(r.requirements[0].checks.invalid, 1, '무효 시나리오의 통과는 통과로 세지 않는다');
  assert.equal(r.requirements[0].checks.passed, 0);
});

test('reconcile: 기록된 상태를 믿지 않고 고정된 기대값으로 다시 계산한다', () => {
  const r = reconcile(plan(), [
    e('start', 'S1', { status: 'ok' }),
    e('check', 'S1.C1', { status: 'passed', actual: '29' }),
    policyOk('S1'),
  ]);
  assert.equal(r.scenarios[0].checks[0].status, 'mismatch');
  assert.equal(r.scenarios[0].valid, false);
  assert.ok(r.problems.some(x => x.includes('다시 계산한 mismatch')));
});

test('reconcile: 정렬 기준을 특정할 수 없는 기록은 결함이 아니라 못 읽은 값으로 다시 계산한다', () => {
  const p = plan();
  p.scenarios[0].checks[0] = { ...p.scenarios[0].checks[0], target: 'T1', read: 'items', op: 'sorted_asc', expected: 'number', expected_from: undefined, offset: undefined };
  const r = reconcile(p, [e('start', 'S1', { status: 'ok' }), e('check', 'S1.C1', { status: 'mismatch', actual: '["글 · 조회 5"]' }), policyOk('S1')]);
  assert.equal(r.scenarios[0].checks[0].status, 'unresolved');
  assert.ok(r.problems.some(x => x.includes('다시 계산한 unresolved')), '실행기 기록과 다르면 표시한다');
});

test('reconcile: 정책 기록이 없거나 위반이 있으면 무효, 시작 실패 뒤 기록도 무효', () => {
  const ok = [e('start', 'S1', { status: 'ok' }), e('check', 'S1.C1', { status: 'passed', actual: '30' })];
  assert.equal(reconcile(plan(), ok).scenarios[0].valid, false);
  assert.equal(reconcile(plan(), [...ok, policyOk('S1')]).scenarios[0].valid, true);
  const violated = reconcile(plan(), [...ok, e('policy', 'S1', { blocked: [], violations: ['redirect http://evil/'] })]);
  assert.deepEqual(violated.scenarios[0].invalid, ['정책 위반: redirect http://evil/']);
  const failedStart = reconcile(plan(), [e('start', 'S1', { status: 'failed' }), e('check', 'S1.C1', { status: 'passed', actual: '30' }), policyOk('S1')]);
  assert.ok(failedStart.scenarios[0].invalid.some(x => x.includes('시작하지 못했는데')));
});

test('reconcile: 계획도 unplanned도 아닌 요구사항은 missing이다', () => {
  const p = plan();
  p.unplanned = [];
  assert.equal(reconcile(p, []).requirements[3].plan, 'missing');
});
test('M2 실행: 준비 대기 뒤 시작 증거, 관측 참조·url·items 비교, 선행조건 실패는 멈춤', async () => {
  const shop = `${origin}/shop.html`;
  const rule = { kind: 'inferred' as const, rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' };
  const p: Plan = {
    version: 1, observations: [], features: [], questions: [],
    requirements: [{ id: 'R1', text: '카드를 누르면 그 상품의 상세가 열린다' }],
    targets: {
      T1: { target: { role: 'link', name: '^Orb Lamp$' }, group: false, url: shop },
      T2: { target: { role: 'heading' }, group: false, url: `${shop}?item=Orb%20Lamp` },
      T3: { target: { role: 'link' }, group: true, url: shop },
      T4: { target: { role: 'heading', name: '^없는 제목$' }, group: false, url: shop },
    },
    scenarios: ['', '#bug'].map((q, i) => ({
      id: `S${i + 1}`, title: q ? '결함 버전' : '정상', covers: ['R1'], start: { url: shop + q },
      steps: [{ id: `S${i + 1}.A1`, op: 'click' as const, target: 'T1' }],
      checks: [
        { id: `S${i + 1}.C1`, after: 'start', target: 'T3', read: 'count' as const, op: 'equals' as const, expected: '3', source: { kind: 'observed' as const }, precondition: true },
        { id: `S${i + 1}.C2`, after: 'start', target: 'T1', read: 'text' as const, op: 'contains' as const, expected: 'Lamp', source: { kind: 'observed' as const } },
        { id: `S${i + 1}.C3`, after: 'start', target: 'T3', read: 'items' as const, op: 'any_equal' as const, expected: 'Harvest Table', source: { kind: 'observed' as const } },
        { id: `S${i + 1}.C4`, after: `S${i + 1}.A1`, target: 'T2', read: 'text' as const, op: 'equals' as const, expected_from: `S${i + 1}.C2`, source: src('R1', '그 상품의 상세가 열린다') },
        { id: `S${i + 1}.C5`, after: `S${i + 1}.A1`, read: 'url' as const, op: 'contains' as const, expected: 'item=', source: rule },
      ],
    })),
    unplanned: [],
  };
  p.scenarios.push({ id: 'S3', title: '준비 실패', covers: ['R1'], start: { url: shop }, steps: [{ id: 'S3.A1', op: 'click', target: 'T1' }],
    checks: [
      { id: 'S3.C1', after: 'start', target: 'T4', read: 'visible', op: 'equals', expected: 'true', source: { kind: 'observed' }, precondition: true },
      { id: 'S3.C2', after: 'S3.A1', target: 'T2', read: 'visible', op: 'equals', expected: 'true', source: src('R1', '상세가 열린다') },
    ] });
  const r = await runPlan({ plan: p, policy: { origins: [origin] }, runDir: runDir('m2'), timeoutMs: 2000 });
  const log = readFileSync(`${r.runDir}/playwright.log`, 'utf8');
  assert.deepEqual(r.problems, [], log);
  const [ok, bug, pre] = r.scenarios;
  assert.equal(ok.ready, true, '시작 증거는 화면이 멈춘 뒤 찍는다');
  assert.ok(readFileSync(`${r.runDir}/${ok.startEvidence![0]}`, 'utf8').includes('Orb Lamp'), '시작 증거가 로딩 화면이 아니다');
  assert.deepEqual(ok.checks.map(c => c.status), ['passed', 'passed', 'passed', 'passed', 'passed'], JSON.stringify(ok.checks));
  assert.equal(ok.checks[3].expected, 'Orb Lamp', '관측 참조는 앞선 검사의 실제 값으로 풀린다');
  assert.equal(ok.precondition, 'met');
  assert.deepEqual(bug.checks.map(c => c.status), ['passed', 'passed', 'passed', 'mismatch', 'passed']);
  assert.deepEqual([bug.checks[3].expected, bug.checks[3].actual], ['Orb Lamp', 'Harvest Table']);
  assert.deepEqual([pre.precondition, pre.valid, pre.steps[0].status, pre.checks[1].status], ['failed', true, 'not_run', 'not_run']);
  const v = Object.fromEntries(preclassify(p, r).map(x => [x.id, x]));
  assert.deepEqual([v['S3.C1'].class, v['S3.C2'].class, v['S3.C2'].cause], ['precondition_failed', 'not_run', 'S3.C1'], '준비 실패는 결함 후보가 아니다');
  assert.equal(v['S2.C4'].class, 'mismatch');
});

test('reconcile·1차 분류: 관측 참조는 정상적으로 읽은 값만 쓰고, 실행 안 된 선행조건은 준비 실패가 아니다', () => {
  const p = plan();
  const s = p.scenarios[0];
  s.checks = [
    { id: 'S1.C1', after: 'start', target: 'T3', read: 'text', op: 'contains', expected: '장바구니', source: { kind: 'observed' }, precondition: true },
    { id: 'S1.C2', after: 'start', target: 'T1', read: 'count', op: 'greater', expected: '0', source: { kind: 'observed' }, precondition: true },
    { id: 'S1.C3', after: 'S1.A1', target: 'T3', read: 'text', op: 'equals', expected_from: 'S1.C1', source: src('R1', '1 늘어난다') },
  ];
  const ledger = (refStatus: string) => [
    e('start', 'S1', { status: 'ok' }), e('check', 'S1.C1', { status: refStatus, actual: 'BAD' }), e('check', 'S1.C2', { status: 'passed', actual: '30' }),
    e('act', 'S1.A1', { status: 'ok' }), e('check', 'S1.C3', { status: 'passed', actual: 'BAD' }), policyOk('S1')];
  const forged = reconcile(p, ledger('unresolved')).scenarios[0];
  assert.equal(forged.checks[2].status, 'error', '미해결 기록의 actual로 관측 참조를 통과시키지 않는다');
  assert.equal(reconcile(p, ledger('passed')).scenarios[0].checks[2].status, 'passed');

  const startFailed = reconcile(p, [e('start', 'S1', { status: 'failed' }), policyOk('S1')]);
  const v = preclassify({ ...p, scenarios: [s] }, { runDir: '', exitCode: 1, problems: [], requirements: [], scenarios: [startFailed.scenarios[0]] });
  assert.deepEqual(v.filter(x => x.kind === 'check').map(x => x.class), ['not_run', 'not_run', 'not_run'], JSON.stringify(v));
});

test('C4: 같은 템플릿 다른 페이지에서 계획을 실행하고, 대상이 없으면 결함이 아니라 적용 불가로 남긴다', async () => {
  const a = `${origin}/item/a.html`;
  const why = { kind: 'inferred' as const, rule: 'no-error-page', quote: '상품 상세 주소가 오류 없이 열린다' };
  const base: Plan = {
    version: 1, observations: [], features: [{ id: 'F1', name: '상품 상세', page: a }], questions: [],
    requirements: [],
    targets: {
      T1: { target: { role: 'heading' }, group: false, url: a },
      T2: { target: { role: 'heading', name: '^상품 A$' }, group: false, url: a },
      T3: { target: { role: 'button' }, group: false, url: a },
    },
    scenarios: [
      { id: 'S1', title: '제목 있음', covers: ['F1'], start: { url: a }, steps: [], checks: [
        { id: 'S1.C1', after: 'start', target: 'T1', read: 'text', op: 'equals', expected: '상품 A', source: { kind: 'observed' }, precondition: true },
        { id: 'S1.C2', after: 'start', read: 'url', op: 'contains', expected: '/item/', source: why },
      ] },
      { id: 'S2', title: '이름으로 고정한 제목', covers: ['F1'], start: { url: a }, steps: [], checks: [
        { id: 'S2.C1', after: 'start', target: 'T2', read: 'visible', op: 'equals', expected: 'true', source: why },
        { id: 'S2.C2', after: 'start', target: 'T3', read: 'visible', op: 'equals', expected: 'true', source: why },
      ] },
      { id: 'S5', title: '요구사항 고정값만', covers: ['F1'], start: { url: a }, steps: [], checks: [
        { id: 'S5.C1', after: 'start', target: 'T1', read: 'text', op: 'equals', expected: '상품 A', source: { kind: 'constraint', quote: '상품 정보는 판매자가 제공합니다' } },
      ] },
    ],
    unplanned: [],
  };
  const b = `${origin}/item/b.html`;
  const p = cloneScenarios(base, { S1: [b], S2: [b], S5: [b] });
  assert.deepEqual(p.scenarios.map(s => [s.id, s.variantOf ?? '', s.start.url.replace(origin, '')]),
    [['S1', '', '/item/a.html'], ['S2', '', '/item/a.html'], ['S5', '', '/item/a.html'], ['S6', 'S1', '/item/b.html'], ['S7', 'S2', '/item/b.html']]);
  assert.deepEqual([p.scenarios[3].checks[0].op, p.scenarios[3].checks[0].precondition], ['record', undefined], '대표 페이지에서 본 값은 기록만 한다');
  assert.deepEqual(p.variants!.find(x => x.from === 'S5'), { from: 'S5', url: b, dropped: ['S5.C1: 페이지마다 다를 수 있는 화면 제약 고정값'], skipped: '규칙 근거 검사가 남지 않음' },
    '복제하지 않은 사유와 뺀 검사를 남긴다');
  const r = await runPlan({ plan: p, policy: { origins: [origin] }, runDir: runDir('c4'), timeoutMs: 1500 });
  const s6 = r.scenarios.find(s => s.id === 'S6')!;
  assert.deepEqual(s6.checks.map(c => c.status), ['passed', 'passed'], JSON.stringify(s6));
  const v = Object.fromEntries(preclassify(p, r).map(x => [x.id, x]));
  assert.equal(v['S7.C1'].class, 'not_applicable', '이름으로 고정한 대상이 다른 페이지에 없으면 판단 보류');
  assert.equal(v['S7.C2'].class, 'mismatch', '구조로 고정한 대상이 없으면 요소 누락일 수 있어 숨기지 않는다');
  assert.equal(systemVerdict(p, v['S7.C1']).level, 'hold');
  assert.deepEqual(validate({ ...p, scenarios: [{ ...p.scenarios[0], id: 'S9', variantOf: 'S99' }] }, [], new Map(Object.entries(p.targets)), [origin])
    .filter(e => e.includes('variantOf')).length, 1, '원본 없는 복제 표식은 거부한다');
});

test('선택 상자 값은 화면과 select 동작이 쓰는 옵션 라벨로 읽는다', async () => {
  const posts = `${origin}/posts.html`;
  const rule = { kind: 'inferred' as const, rule: 'sort-order', quote: '정렬 선택 상자로 목록 순서를 바꾼다' };
  const p: Plan = {
    version: 1, observations: [], features: [{ id: 'F1', name: '게시글 정렬', page: `${origin}/posts.html` }], questions: [], requirements: [], unplanned: [],
    targets: {
      T1: { target: { role: 'combobox', name: '^정렬$' }, group: false, url: posts },
      T2: { target: { role: 'listitem', within: { role: 'list', name: '^게시글$' } }, group: true, url: posts },
    },
    scenarios: [{ id: 'S1', title: '조회수 정렬', covers: ['F1'], start: { url: posts },
      steps: [{ id: 'S1.A1', op: 'select', target: 'T1', value: '조회수 높은순' }],
      checks: [
        { id: 'S1.C1', after: 'start', target: 'T1', read: 'value', op: 'equals', expected: '최신순', source: { kind: 'observed' }, precondition: true },
        { id: 'S1.C2', after: 'S1.A1', target: 'T1', read: 'value', op: 'not_equals', expected_from: 'S1.C1', source: { kind: 'inferred', rule: 'action-has-effect', quote: '정렬 옵션을 고르면 선택 값이 바뀐다' } },
        { id: 'S1.C3', after: 'S1.A1', target: 'T2', read: 'items', op: 'sorted_desc', expected: 'number', source: rule },
      ] }],
  };
  const r = await runPlan({ plan: p, policy: { origins: [origin] }, runDir: runDir('select'), timeoutMs: 2000 });
  assert.deepEqual(r.problems, [], readFileSync(`${r.runDir}/playwright.log`, 'utf8'));
  assert.deepEqual(r.scenarios[0].checks.map(c => c.status), ['passed', 'passed', 'passed'], JSON.stringify(r.scenarios[0].checks));
  assert.deepEqual(r.scenarios[0].checks.slice(0, 2).map(c => c.actual), ['최신순', '조회수 높은순']);
});
