import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { Budget, BudgetError, runAgent, type Tool } from '../src/agent.ts';

const reply = (content: unknown[], stop = 'tool_use', model = 'claude-sonnet-5-5') => ({
  id: 'm', type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}) as unknown as Anthropic.Message;
const use = (name: string) => ({ type: 'tool_use', id: `t_${name}`, name, input: {} });

test('제출이 통과하면 같은 응답의 뒤 도구는 실행하지 않는다', async () => {
  const ran: string[] = [];
  const tool = (name: string, done?: unknown): Tool => ({
    def: { name, input_schema: { type: 'object' } }, run: async () => { ran.push(name); return { text: name, done }; },
  });
  const r = await runAgent({ send: async () => reply([use('submit'), use('click')]), model: 'claude-sonnet-5-5', system: 's',
    tools: [tool('submit', { plan: 1 }), tool('click')], user: 'u', budget: new Budget(1), maxTurns: 3 });
  assert.equal(r.stop, 'done');
  assert.deepEqual(ran, ['submit']);
});

test('호출 실패·다른 모델 응답은 기록을 남기고 error로 끝난다', async () => {
  const base = { model: 'claude-sonnet-5-5', system: 's', tools: [], user: 'u', maxTurns: 3 };
  let tries = 0;
  const failed = await runAgent({ ...base, budget: new Budget(1), retryDelaysMs: [0, 0, 0], send: async () => { tries++; throw new Error('529 overloaded'); } });
  assert.deepEqual([failed.stop, failed.detail, failed.turns.length, tries], ['error', '529 overloaded', 1, 4], '일시적 실패는 같은 턴에서 세 번 더 보낸 뒤 끝낸다');
  // 일시적으로 끊겼다가 다시 되면 같은 예약으로 이어 가고 한 번만 청구한다. 요청 내용 오류(400)는 다시 보내지 않는다.
  let n = 0;
  const budget = new Budget(1);
  const recovered = await runAgent({ ...base, budget, retryDelaysMs: [0, 0, 0], send: async req => { if (++n <= 2) throw new Error('Connection error.'); return reply([], 'end_turn', req.model); } });
  assert.deepEqual([recovered.stop, recovered.turns.length, n, budget.held], ['no_submit', 1, 3, 0]);
  let bad = 0;
  await runAgent({ ...base, budget: new Budget(1), retryDelaysMs: [0, 0, 0], send: async () => { bad++; throw Object.assign(new Error('invalid_request_error'), { status: 400 }); } });
  assert.equal(bad, 1);
  const swapped = await runAgent({ ...base, budget: new Budget(1), send: async () => reply([], 'end_turn', 'claude-opus-5-5') });
  assert.equal(swapped.stop, 'error');
});

test('예약액은 정산 전까지 점유하고 정산하면 놓는다', () => {
  const b = new Budget(0.05);
  const req = { model: 'claude-sonnet-5-5', max_tokens: 2000, messages: [] } as Anthropic.MessageCreateParamsNonStreaming;
  const first = b.reserve(req);
  assert.throws(() => { b.reserve(req); b.reserve(req); }, BudgetError);
  assert.ok(b.held > 0);
  b.charge('claude-sonnet-5-5', usage(10, 10), first);
  assert.ok(b.held < first * 2);
});

test('캐시 읽기는 모델별 단가, 1시간 캐시 쓰기는 2배로 정산한다', () => {
  const b = new Budget(10);
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 } } as Anthropic.Usage;
  assert.equal(b.charge('claude-opus-5-5', u), 0.2 + 4 * 2);
});

const usage = (input: number, output: number) =>
  ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as Anthropic.Usage;

test('Haiku는 프롬프트 10만 토큰을 넘으면 높은 구간 가격으로 정산한다', () => {
  const b = new Budget(10);
  assert.equal(b.charge('claude-haiku-5-5', usage(100_000, 1000)), (100_000 * 0.1 + 1000 * 0.5) / 1e6);
  assert.equal(b.charge('claude-haiku-5-5', usage(100_001, 1000)), (100_001 * 0.5 + 1000 * 2.5) / 1e6);
});

test('예약은 남은 예산을 넘으면 거부하고, 모르는 모델은 정산도 거부한다', () => {
  const b = new Budget(0.05);
  const req = { model: 'claude-sonnet-5-5', max_tokens: 2000, messages: [] } as Anthropic.MessageCreateParamsNonStreaming;
  assert.ok(b.reserve(req) > 0);
  assert.throws(() => b.reserve({ ...req, max_tokens: 10_000 }), BudgetError);
  assert.throws(() => b.charge('claude-x', usage(1, 1)), BudgetError);
});

test('마지막 몇 턴에는 남은 턴 수를 알려 제출을 재촉한다', async () => {
  const seen: string[] = [];
  const click: Tool = { def: { name: 'click', input_schema: { type: 'object' } }, run: async () => ({ text: 'ok' }) };
  const r = await runAgent({ send: async req => { seen.push(JSON.stringify(req.messages.at(-1))); return reply([use('click')]); },
    model: 'claude-sonnet-5-5', system: 's', tools: [click], user: 'u', budget: new Budget(1), maxTurns: 8 });
  assert.equal(r.stop, 'max_turns');
  // 8턴이면 마지막 5턴부터 알린다: 3번째 응답 뒤(남은 5)부터
  assert.deepEqual(seen.map(m => /남은 턴: (\d+)/.exec(m)?.[1] ?? '-'), ['-', '-', '-', '5', '4', '3', '2', '1']);
});

test('동시 호출: 다른 호출의 예약 때문에 모자라면 그 호출이 끝난 뒤 예약하고, 기다릴 호출이 없으면 바로 거부한다', async () => {
  const b = new Budget(0.03);
  const req = { model: 'claude-sonnet-5-5', max_tokens: 2000, messages: [] } as Anthropic.MessageCreateParamsNonStreaming;
  const first = b.reserve(req);
  let second: number | undefined;
  const waiting = b.reserveWhenFree(req).then(r => { second = r; });
  await new Promise(res => setImmediate(res));
  assert.equal(second, undefined, '앞 호출이 정산되기 전에는 기다린다');
  b.charge('claude-sonnet-5-5', usage(10, 10), first);
  await waiting;
  assert.ok(second! > 0, '앞 호출이 정산되면 예약한다');
  // 실패한 호출은 예약액을 놓지 않는다. 기다리던 예약은 깨어나 다시 따져 보고, 기다릴 호출이 없으니 거부된다.
  const late = b.reserveWhenFree(req);
  b.abandon();
  await assert.rejects(late, BudgetError);
  await assert.rejects(b.reserveWhenFree(req), BudgetError, '기다릴 호출이 없으면 바로 거부');
});

test('분류 몫 하한: 하한으로 건 금액은 예약에 쓰지 않는다', () => {
  const b = new Budget(0.05);
  const req = { model: 'claude-sonnet-5-5', max_tokens: 2000, messages: [] } as Anthropic.MessageCreateParamsNonStreaming;
  b.floorUsd = 0.03;
  assert.throws(() => b.reserve(req), BudgetError, '남은 $0.05 중 $0.03은 쓸 수 없다');
  b.floorUsd = 0;
  assert.ok(b.reserve(req) > 0);
});

test('도구가 이미지를 돌려주면 다음 요청의 도구 결과에 이미지 블록으로 붙는다', async () => {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const tool: Tool = { def: { name: 'screenshot', input_schema: { type: 'object' } }, run: async () => ({ text: '화면', image: 'aGVsbG8=' }) };
  await runAgent({ send: async req => { seen.push(req); return seen.length === 1 ? reply([use('screenshot')]) : reply([], 'end_turn'); },
    model: 'claude-sonnet-5-5', system: 's', tools: [tool], user: 'u', budget: new Budget(1), maxTurns: 3 });
  const result = (seen[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
  assert.deepEqual(result.content, [{ type: 'text', text: '화면' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }]);
});

test('제출 도구 대화: 글로만 답하거나 글이 잘리면 한 번만 제출을 다시 요청한다', async () => {
  const text = (t: string) => ({ type: 'text', text: t });
  const submit = { type: 'tool_use', id: 't_s', name: 'submit', input: {} };
  const tool: Tool = { def: { name: 'submit', input_schema: { type: 'object' } }, run: async () => ({ text: 'ok', done: 1 }) };
  const go = async (replies: Anthropic.Message[], nudge = true) => {
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await runAgent({ send: async req => { seen.push(req); return replies.shift()!; }, model: 'claude-sonnet-5-5', system: 's', tools: [tool], user: 'u', budget: new Budget(1), maxTurns: 3, nudge });
    return { r, seen };
  };
  // 글로만 답함 → 다시 요청 → 제출
  let { r, seen } = await go([reply([text('판단: 앱 결함')], 'end_turn'), reply([submit])]);
  assert.equal(r.stop, 'done');
  assert.match(JSON.stringify(seen[1].messages.at(-1)), /도구로 제출하지 않았습니다/);
  // 글이 출력 한도에서 잘림 → 짧게 제출하라고 요청
  ({ r, seen } = await go([reply([text('판단: 앱 결함\n' + '</invoke>\n'.repeat(1000))], 'max_tokens'), reply([submit])]));
  assert.equal(r.stop, 'done');
  assert.match(JSON.stringify(seen[1].messages.at(-1)), /출력 한도에서 잘렸습니다/);
  // 되풀이된 잘린 글은 앞부분만 다시 보낸다
  const resent = JSON.stringify(seen[1].messages.at(-2));
  assert.ok(resent.includes('판단: 앱 결함') && resent.length < 2600, String(resent.length));
  // thinking과 글로 판단만 쓰고 끝난 완결 응답도 다시 요청한다. thinking 블록은 그대로 되돌린다.
  const thinking = { type: 'thinking', thinking: '…', signature: 'sig' };
  ({ r, seen } = await go([reply([thinking, text('판단: 앱 결함')], 'end_turn'), reply([submit])]));
  assert.equal(r.stop, 'done');
  assert.match(JSON.stringify(seen[1].messages.at(-2)), /"signature":"sig"/);
  // 출력 한도에서 잘린 thinking은 다시 보내지 않고 끝낸다
  ({ r, seen } = await go([reply([thinking], 'max_tokens')]));
  assert.deepEqual([r.stop, seen.length], ['max_tokens', 1]);
  // 다시 요청은 한 번뿐이다
  ({ r, seen } = await go([reply([text('a')], 'end_turn'), reply([text('b')], 'end_turn'), reply([submit])]));
  assert.deepEqual([r.stop, seen.length], ['no_submit', 2]);
  // 켜지 않은 대화(탐색)는 전처럼 바로 끝난다
  ({ r, seen } = await go([reply([text('a')], 'end_turn')], false));
  assert.deepEqual([r.stop, seen.length], ['no_submit', 1]);
});

test('캐시: 대화마다 같은 시스템 프롬프트 끝에 캐시 지점을 따로 두고, 대화 끝 자동 지점도 유지한다', async () => {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  await runAgent({ send: async req => { seen.push(req); return reply([{ type: 'text', text: 'x' }], 'end_turn'); }, model: 'claude-sonnet-5-5', system: '규칙',
    tools: [], user: 'u', budget: new Budget(1), maxTurns: 1 });
  assert.deepEqual(seen[0].system, [{ type: 'text', text: '규칙', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual((seen[0] as { cache_control?: unknown }).cache_control, { type: 'ephemeral' });
});

test('예약: 둘째 호출부터 입력 상한을 앞 응답의 실제 토큰 + 새로 더한 내용의 바이트로 잡아, 전체를 바이트로 셀 때보다 작게 예약한다', async () => {
  // 큰 시스템 프롬프트(바이트 많음)에 실제 토큰은 적은 대화. 첫 호출은 바이트 상한, 둘째 호출은 실제 토큰 + 도구 결과 바이트로 예약한다.
  const big = '가'.repeat(30000);
  let n = 0;
  const tool: Tool = { def: { name: 'look', description: 'x', input_schema: { type: 'object', properties: {} } }, run: async () => ({ text: '결과', ...(n >= 2 ? { done: 1 } : {}) }) };
  const r = await runAgent({ model: 'claude-opus-5-5', system: big, tools: [tool], user: '시작', budget: new Budget(5), maxTurns: 3,
    send: async req => ({ id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: `t${++n}`, name: 'look', input: {} }],
      usage: { input_tokens: 12000, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message });
  assert.equal(r.stop, 'done');
  const [first, second] = r.turns.map(t => t.reserved);
  const out = 16000 * 20 / 1e6;
  assert.ok(second - out < (first - out) / 3, `둘째 예약의 입력 몫 ${second - out} < 첫 예약 입력 몫 ${first - out}/3`);
  // 상한은 실제 입력(12000 + 50 출력 + 새 메시지)보다 작아지지 않는다.
  assert.ok(second >= (12050 * 1.25 * 4 + 16000 * 20) / 1e6, String(second));
});
