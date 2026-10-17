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
  const failed = await runAgent({ ...base, budget: new Budget(1), send: async () => { throw new Error('529 overloaded'); } });
  assert.deepEqual([failed.stop, failed.detail, failed.turns.length], ['error', '529 overloaded', 1]);
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
