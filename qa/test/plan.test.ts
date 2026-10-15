import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, freeze, type Draft, type Pinned, type Requirement } from '../src/plan.ts';

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
