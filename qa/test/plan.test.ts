import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, freeze, compareValues, numberIn, expectedFrom, type Draft, type Pinned, type Requirement } from '../src/plan.ts';

const origin = 'http://app.test';
const reqs: Requirement[] = [
  { id: 'R1', text: '수량을 늘리면 수량 칸이 1 증가한다' },
  { id: 'R2', text: '로그인한 사용자는 주문 내역을 본다' },
];
const pins = new Map<string, Pinned>([
  ['T1', { target: { role: 'button', name: '^수량 증가$' }, group: false, url: origin + '/p' }],
  ['T2', { target: { role: 'spinbutton', name: '^수량$' }, group: false, url: origin + '/p' }],
  ['T3', { target: { role: 'listitem' }, group: true, url: origin + '/p' }],
]);

function good(): Draft {
  return {
    scenarios: [{
      id: 'S1', title: '수량 증가', covers: ['R1'], start: { url: origin + '/p' },
      steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
      checks: [{ id: 'S1.C1', after: 'S1.A1', target: 'T2', read: 'value', op: 'equals', expected: '2',
        source: { kind: 'requirement', id: 'R1', quote: '1 증가한다' } }],
    }],
    unplanned: [{ requirement: 'R2', reason: '로그인 권한 없음' }],
  };
}

const errorsOf = (mutate: (d: Draft) => void) => {
  const d = good();
  mutate(d);
  return validate(d, reqs, pins, [origin]);
};

test('올바른 계획은 오류가 없고 쓰인 대상만 고정한다', () => {
  assert.deepEqual(validate(good(), reqs, pins, [origin]), []);
  const plan = freeze(good(), reqs, pins);
  assert.deepEqual(Object.keys(plan.targets).sort(), ['T1', 'T2']);
});

test('모든 요구사항은 시나리오나 unplanned에 있어야 한다', () => {
  const errors = errorsOf(d => { d.unplanned = []; });
  assert.ok(errors.some(e => e.includes('R2 is neither covered nor unplanned')), errors.join('\n'));
});

test('같은 요구사항을 계획하면서 unplanned로 둘 수 없다', () => {
  const errors = errorsOf(d => { d.unplanned.push({ requirement: 'R1', reason: 'x' }); });
  assert.ok(errors.some(e => e.includes('"R1" is also covered')), errors.join('\n'));
});

test('요구사항 출처는 실제 문장의 인용이어야 한다', () => {
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].source.quote = '2가 된다'; }).some(e => e.includes('exact excerpt')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].source.id = 'R9'; }).some(e => e.includes('known source.id')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].source = { kind: 'requirement', id: 'R2', quote: '주문 내역' }; })
    .some(e => e.includes('not in S1.covers')));
});

test('pin하지 않은 대상, 다른 시나리오의 단계, 허용 밖 URL을 거부한다', () => {
  assert.ok(errorsOf(d => { d.scenarios[0].steps[0].target = 'T9'; }).some(e => e.includes('"T9" was not pinned')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].after = 'S2.A1'; }).some(e => e.includes('after must be')));
  assert.ok(errorsOf(d => { d.scenarios[0].start.url = 'http://evil.test/'; }).some(e => e.includes('outside the allowed origins')));
});

test('count 검사는 그룹 대상과 정수 기대값이 필요하고, 그룹은 단일 검사에 못 쓴다', () => {
  const count = { id: 'S1.C2', after: 'start', target: 'T3', read: 'count' as const, op: 'equals' as const,
    expected: '3', source: { kind: 'observed' as const } };
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(count); }), []);
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...count, expected: '세 개' }); }).some(e => e.includes('whole-number')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...count, target: 'T2' }); }).some(e => e.includes('must be pinned as a group')));
  assert.ok(errorsOf(d => { d.scenarios[0].steps[0].target = 'T3'; }).some(e => e.includes('is a group')));
});

test('모양이 틀린 입력은 타입 표기와 상관없이 거부한다', () => {
  assert.ok(errorsOf(d => { (d.scenarios[0].steps[0] as any).op = 'noop'; }).some(e => e.includes('op must be one of')));
  assert.ok(errorsOf(d => { (d.scenarios[0].checks[0] as any).read = 'html'; }).some(e => e.includes('read must be one of')));
  assert.ok(errorsOf(d => { (d.scenarios[0].checks[0].source as any).kind = 'trust_me'; }).some(e => e.includes('kind must be one of')));
  assert.deepEqual(validate({} as Draft, reqs, pins, [origin]), ['plan must have scenarios[] and unplanned[]']);
});

test('항상 참인 검사와 의미 없는 인용을 거부한다', () => {
  assert.ok(errorsOf(d => { Object.assign(d.scenarios[0].checks[0], { op: 'contains', expected: ' ' }); }).some(e => e.includes('always passes')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].source.quote = ' '; }).some(e => e.includes('2+ characters')));
});

test('covers에 넣은 요구사항은 그것을 인용한 검사가 있어야 한다', () => {
  const errors = errorsOf(d => { d.scenarios[0].checks[0].source = { kind: 'observed' }; });
  assert.ok(errors.some(e => e.includes('covers R1 but no check cites R1')), errors.join('\n'));
});

test('관찰값은 시작 시점 검사의 근거로만 쓰고, 행동 뒤 결과의 기대값 근거로는 거부한다', () => {
  const after = errorsOf(d => { d.scenarios[0].checks.push({ ...d.scenarios[0].checks[0], id: 'S1.C2', source: { kind: 'observed' } }); });
  assert.ok(after.some(e => e.includes('S1.C2') && e.includes('observed value')), after.join('\n'));
  const atStart = errorsOf(d => { d.scenarios[0].checks.push({ ...d.scenarios[0].checks[0], id: 'S1.C2', after: 'start', source: { kind: 'observed' } }); });
  assert.ok(!atStart.some(e => e.includes('observed value')), atStart.join('\n'));
  const guess = errorsOf(d => { d.scenarios[0].checks.push({ ...d.scenarios[0].checks[0], id: 'S1.C2', source: { kind: 'inferred', rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } }); });
  assert.deepEqual(guess, []);
  // 추정 근거는 규칙 문장이 있어야 한다. 관찰값에 이름만 inferred로 붙이는 우회를 막도록 목록의 규칙 ID가 필요하다.
  const bare = errorsOf(d => { d.scenarios[0].checks.push({ ...d.scenarios[0].checks[0], id: 'S1.C2', source: { kind: 'inferred' } }); });
  assert.ok(bare.some(e => e.includes('inferred needs source.rule')), bare.join('\n'));
});

test('시작 상태에서 쓰는 대상은 시작 페이지에서 pin했어야 한다', () => {
  const other = new Map(pins);
  other.set('T2', { ...pins.get('T2')!, url: origin + '/other' });
  const d = good();
  d.scenarios[0].checks[0].after = 'start';
  assert.ok(validate(d, reqs, other, [origin]).some(e => e.includes('not on the start page')));
  assert.deepEqual(validate(good(), reqs, other, [origin]), [], '행동 뒤의 검사는 다른 페이지에서 pin해도 된다');
});

test('freeze는 제출 입력과 객체를 공유하지 않는다', () => {
  const d = good();
  const plan = freeze(d, reqs, pins);
  d.scenarios[0].checks[0].expected = '999';
  assert.equal(plan.scenarios[0].checks[0].expected, '2');
});

test('ID 형식과 중복, 값이 필요한 단계를 검사한다', () => {
  assert.ok(errorsOf(d => { d.scenarios[0].steps[0].id = 'A1'; }).some(e => e.includes('must match')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].id = 'S1.A1'; }).some(e => e.includes('duplicate') || e.includes('must match')));
  assert.ok(errorsOf(d => { d.scenarios[0].steps.push({ id: 'S1.A2', op: 'fill', target: 'T2' }); }).some(e => e.includes('needs a value')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks = []; }).some(e => e.includes('at least one check')));
});

test('관측 참조는 같은 시나리오에서 먼저 실행되는 검사만 가리키고, 비교 규칙의 근거가 따로 있어야 한다', () => {
  const name = { id: 'S1.C0', after: 'start', target: 'T2', read: 'text' as const, op: 'equals' as const, expected: '1', source: { kind: 'observed' as const } };
  const rel = { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'text' as const, op: 'equals' as const, expected_from: 'S1.C0',
    source: { kind: 'inferred' as const, rule: 'link-target', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } };
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(name, rel); }), []);
  // 뒤에 실행되는 검사·자기 자신·다른 시나리오 검사는 참조할 수 없다.
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...name, after: 'S1.A1' }, { ...rel, expected_from: 'S1.C9' }); })
    .some(e => e.includes('runs before it')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(name, { ...rel, expected_from: 'S1.C2' }); }).some(e => e.includes('runs before it')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(name, { ...rel, source: { kind: 'observed' } }); }).some(e => e.includes('rule basis')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(name, { ...rel, expected: 'x' }); }).some(e => e.includes('exactly one')));
});

test('읽기 종류별로 대상·비교를 제한한다: url은 대상 없음, items는 그룹과 목록 조건만, less·greater는 숫자', () => {
  const url = { id: 'S1.C2', after: 'S1.A1', read: 'url' as const, op: 'contains' as const, expected: '/p/',
    source: { kind: 'inferred' as const, rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } };
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(url); }), []);
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...url, target: 'T2' }); }).some(e => e.includes('takes no target')));
  const items = { ...url, target: 'T3', read: 'items' as const, op: 'all_contain' as const, expected: 'Lighting' };
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(items); }), []);
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...items, op: 'equals' }); }).some(e => e.includes('allows op')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...items, target: 'T2' }); }).some(e => e.includes('must be pinned as a group')));
  assert.ok(errorsOf(d => { Object.assign(d.scenarios[0].checks[0], { op: 'greater', expected: '많이' }); }).some(e => e.includes('needs a number')));
});

test('화면 제약 근거는 탐색 중 본 텍스트를 인용해야 한다', () => {
  const draft = good();
  draft.scenarios[0].checks.push({ id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'value', op: 'less', expected: '11',
    source: { kind: 'constraint', quote: '최대 10개' } });
  assert.deepEqual(validate(draft, reqs, pins, [origin], '수량 (최대 10개까지)'), []);
  assert.ok(validate(draft, reqs, pins, [origin], '수량').some(e => e.includes('not seen during exploration')));
});

test('비교 규칙: 숫자 비교는 첫 숫자로, 목록 조건은 빈 목록을 통과시키지 않는다', () => {
  assert.equal(numberIn('$1,450.50'), 1450.5);
  assert.ok(compareValues('greater', '장바구니 (3)', '2'));
  assert.ok(!compareValues('less', '가격 없음', '2'));
  assert.ok(compareValues('all_contain', '["Lighting A","Lighting B"]', 'Lighting'));
  assert.ok(!compareValues('all_contain', '["Lighting A","Ceramics B"]', 'Lighting'));
  assert.ok(compareValues('any_equal', '["a","b"]', 'b'));
  assert.ok(!compareValues('all_equal', '[]', 'a'));
  assert.ok(compareValues('not_equals', 'a', 'b'));
  assert.ok(compareValues('same_number', '7', '7개 상품'));
  assert.ok(!compareValues('same_number', '3', '7개 상품'));
  assert.ok(!compareValues('same_number', '없음', '7개 상품'));
});

test('선행조건은 시작 상태 확인에만 쓰고, 기능 검사를 선행조건으로 숨길 수 없다', () => {
  const ready = { id: 'S1.C2', after: 'start', target: 'T3', read: 'count' as const, op: 'greater' as const, expected: '0',
    source: { kind: 'observed' as const }, precondition: true };
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(ready); }), []);
  assert.ok(errorsOf(d => { d.scenarios[0].checks[0].precondition = true; }).some(e => e.includes('precondition is only')), '행동 뒤 요구사항 검사');
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push({ ...ready, after: 'S1.A1', source: { kind: 'inferred', rule: 'no-error-page', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } }); })
    .some(e => e.includes('precondition is only')));
});

test('관측 참조로 항상 통과하는 검사를 막는다: 같은 시점·같은 대상 재비교, 빈 값 포함 비교', () => {
  const first = { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'value' as const, op: 'equals' as const, expected: '2', source: { kind: 'requirement' as const, id: 'R1', quote: '1 증가한다' } };
  const same = { ...first, id: 'S1.C3', expected: undefined, expected_from: 'S1.C2', source: { kind: 'inferred' as const, rule: 'link-target', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } };
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(first, same); }).some(e => e.includes('always passes')));
  assert.ok(!compareValues('contains', '아무 값', ''));
  assert.ok(!compareValues('any_contain', '["a"]', ' '));
});

test('자율 탐색: 요구사항 없이 기능(F#)을 다루는 시나리오는 목록의 일반 규칙으로 검사하고, 관찰값만으로는 안 된다', () => {
  const draft: Draft = {
    features: [{ id: 'F1', name: '수량 증가', page: origin + '/p' }],
    scenarios: [{ id: 'S1', title: '수량 증가', covers: ['F1'], start: { url: origin + '/p' },
      steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
      checks: [
        { id: 'S1.C1', after: 'start', target: 'T2', read: 'value', op: 'equals', expected: '1', source: { kind: 'observed' }, precondition: true },
        { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'value', op: 'equals', expected_from: 'S1.C1', offset: 1, source: { kind: 'inferred', rule: 'step-by-one', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } },
      ] }],
    unplanned: [],
  };
  assert.deepEqual(validate(draft, [], pins, [origin]), []);
  const plan = freeze(draft, [], pins, [{ id: 'Q1', page: origin + '/p', question: '수량 상한이 있나요?', options: ['있다', '없다'] }]);
  assert.deepEqual([plan.features.map(f => f.id), plan.questions.length], [['F1'], 1]);

  const bad = structuredClone(draft);
  bad.scenarios[0].checks[1].source = { kind: 'inferred', rule: '내가 만든 규칙' };
  assert.ok(validate(bad, [], pins, [origin]).some(e => e.includes('from the general rule list')));
  bad.scenarios[0].checks.pop();
  assert.ok(validate(bad, [], pins, [origin]).some(e => e.includes('no non-precondition check with an inferred rule')));
  const unknown = structuredClone(draft);
  unknown.scenarios[0].covers = ['F9'];
  assert.ok(validate(unknown, [], pins, [origin]).some(e => e.includes('unknown requirement or feature "F9"')));
  // 요구사항이 있으면 여전히 모두 계획하거나 미계획 사유를 남겨야 한다.
  assert.ok(validate(draft, reqs, pins, [origin]).some(e => e.includes('R1 is neither covered nor unplanned')));
});

test('규칙별 비교 형태: 관찰한 결함 값을 규칙 ID만 붙여 정답으로 고정할 수 없다', () => {
  const start = { id: 'S1.C2', after: 'start', target: 'T2', read: 'value' as const, op: 'equals' as const, expected: '1', source: { kind: 'observed' as const }, precondition: true };
  const rule = (r: string) => ({ kind: 'inferred' as const, rule: r, quote: '증가 버튼을 한 번 누르면 수량이 한 단위 바뀐다' });
  const after = { id: 'S1.C3', after: 'S1.A1', target: 'T2', read: 'value' as const, op: 'equals' as const };
  // 1→3 결함을 본 뒤 expected "3"으로 고정하는 계획
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(start, { ...after, expected: '3', source: rule('step-by-one') }); }).some(e => e.includes('use expected_from')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(start, { ...after, expected_from: 'S1.C2', source: rule('step-by-one') }); }).some(e => e.includes('needs offset')));
  assert.deepEqual(errorsOf(d => { d.scenarios[0].checks.push(start, { ...after, expected_from: 'S1.C2', offset: 1, source: rule('step-by-one') }); }), []);
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(start, { ...after, op: 'equals', expected: '0', source: rule('quantity-bounds') }); }).some(e => e.includes('use op less or greater')));
  assert.ok(errorsOf(d => { d.scenarios[0].checks.push(start, { ...after, expected_from: 'S1.C2', offset: 1, source: { kind: 'inferred', rule: 'step-by-one' } }); }).some(e => e.includes('explaining why')));
  assert.equal(expectedFrom({ ...after, expected_from: 'S1.C2', offset: 1, source: rule('step-by-one') }, '장바구니 (0)'), '장바구니 (1)');
});
