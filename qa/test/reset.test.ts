import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetApp, type ResetSpec } from '../src/reset.ts';
import { runPlan } from '../src/run.ts';
import { judge } from '../src/triage.ts';
import { Budget } from '../src/agent.ts';
import type { Plan } from '../src/plan.ts';

// 상태가 있는 작은 앱: POST /reset이 count를 0으로, /state가 지금 count를 보여 준다. broken이면 초기화가 듣지 않는다.
let server: Server | undefined;
let origin = '';
let count = 5, resets = 0, broken = false;
before(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://x').pathname;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (path === '/reset' && req.method === 'POST') { resets++; if (!broken) count = 0; return res.end('ok'); }
    if (path === '/fail') { res.statusCode = 500; return res.end('x'); }
    if (path === '/state') return res.end(`<h1>상태</h1><p>count=${count}</p>`);
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server?.close(); });

const spec = (): ResetSpec => ({ request: { method: 'POST', url: `${origin}/reset` }, verify: { url: `${origin}/state`, text: 'count=0' } });

test('초기화: 등록된 요청을 보내고 확인 응답으로 초기 상태인지 본다. 허용 밖·오류·확인 실패는 실패다', async () => {
  const policy = { origins: [origin] };
  count = 3; broken = false;
  assert.deepEqual(await resetApp(policy, spec()), { ok: true });
  assert.equal(count, 0);
  broken = true; count = 3;
  assert.deepEqual(await resetApp(policy, spec()), { ok: false, reason: '확인 응답에 기대한 글자가 없음(초기 상태가 아님)' });
  broken = false;
  assert.match((await resetApp(policy, { ...spec(), request: { method: 'POST', url: `${origin}/fail` } }) as { reason: string }).reason, /500/);
  assert.match((await resetApp({ origins: ['http://other.test'] }, spec()) as { reason: string }).reason, /허용 origin 밖/);
});

/** /state의 count가 99여야 한다는 검사: 항상 불일치라 재현 후보가 된다. */
const plan = (): Plan => ({ version: 1, textRead: 'name+content', questions: [], observations: [], unplanned: [], features: [],
  requirements: [{ id: 'R1', text: '상태 화면에는 count=99가 보인다' }],
  targets: { T1: { target: { text: '^count=.*$' }, group: false, url: `${origin}/state` } },
  scenarios: [{ id: 'S1', title: '상태', covers: ['R1'], start: { url: `${origin}/state` }, steps: [],
    checks: [{ id: 'S1.C1', after: 'start', target: 'T1', read: 'text', op: 'equals', expected: 'count=99', source: { kind: 'requirement', id: 'R1', quote: 'count=99가 보인다' } }] }] });

for (const c of [
  { name: '쓰기 허용 + 초기화 없음 → 판단 불가(초기화 불가), 다시 돌리지 않음', writes: true, reset: false, broken: false, want: ['reproduction_inconclusive', 'reset_unavailable'], reran: false },
  { name: '쓰기 허용 + 초기화 성공 → 초기화 뒤 재실행해 재현됨', writes: true, reset: true, broken: false, want: ['reproduced', undefined], reran: true },
  { name: '쓰기 허용 + 초기화 확인 실패 → 판단 불가(초기화 실패)', writes: true, reset: true, broken: true, want: ['reproduction_inconclusive', 'reset_failed'], reran: false },
  { name: '쓰기 차단 + 초기화 없음 → 초기화 없이 재실행해 재현됨', writes: false, reset: false, broken: false, want: ['reproduced', undefined], reran: true },
  { name: '쓰기 차단 + 초기화 등록 → 초기화를 부르지 않고 재현됨(초기화 자체가 쓰기)', writes: false, reset: true, broken: false, want: ['reproduced', undefined], reran: true },
  { name: '쓰기 허용 + 실행 전 초기화 실패 → 판단 불가(초기화 실패), 다시 돌리지 않음', writes: true, reset: true, broken: false, startFailed: true, want: ['reproduction_inconclusive', 'reset_failed'], reran: false },
  { name: '쓰기 차단 + 실행 뒤 상태가 밖에서 바뀜 → 판단 불가(결과가 최초와 다름)', writes: false, reset: false, broken: false, mutate: true, want: ['reproduction_inconclusive', 'result_differs'], reran: true },
]) test(`재현 두 축: ${c.name}`, async () => {
  const policy = { origins: [origin], allowWrites: c.writes };
  const out = fileURLToPath(new URL(`../runs/test-reset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, import.meta.url));
  // CLI처럼 등록된 초기화가 있으면 실행 전에 한 번 초기화한다.
  if (c.reset) await resetApp(policy, spec()); else count = 4;
  const run = await runPlan({ plan: plan(), policy, runDir: join(out, 'run'), timeoutMs: 1500 });
  // 초기화 실패 경우: 실행 뒤 상태가 바뀌었고 초기화가 듣지 않는다.
  if (c.broken) { count = 7; broken = true; }
  if ('mutate' in c) count = 8;
  const before = resets;
  const j = await judge({ plan: plan(), run, send: async () => { throw new Error('호출 안 함'); }, model: 'claude-sonnet-5-5', budget: new Budget(1),
    reproduceDir: join(out, 'repro'), ...(c.reset ? { reset: () => resetApp(policy, spec()) } : {}),
    ...('startFailed' in c ? { startReset: { ok: false as const, reason: '확인 응답에 기대한 글자가 없음' } } : {}) });
  broken = false;
  const v = j.verdicts.find(x => x.id === 'S1.C1')!;
  assert.deepEqual([v.reproduction, v.reproductionReason], c.want, JSON.stringify(v));
  assert.equal(resets - before, c.reset && c.writes && !('startFailed' in c) ? 1 : 0, '초기화는 쓰기 허용 실행의 재현 전에 한 번만 부른다');
  assert.equal(existsSync(join(out, 'repro')), c.reran, '초기화할 수 없으면 다시 돌리지 않는다');
});

test('다시 판정: 판정 회차마다 재현 폴더를 따로 쓰고 판정 파일에 남긴다. 잘못된 초기화 주소는 설정에서 거부한다', async () => {
  const { checkResetSpec } = await import('../src/reset.ts');
  assert.match(checkResetSpec({ request: { method: 'POST', url: 'not a url' }, verify: { url: `${origin}/state`, text: 'x' } }) ?? '', /올바른 URL이 아님/);
  const policy = { origins: [origin] };
  const out = fileURLToPath(new URL(`../runs/test-rejudge-${Date.now()}`, import.meta.url));
  const run = await runPlan({ plan: plan(), policy, runDir: join(out, 'run'), timeoutMs: 1500 });
  const j = (n: number) => judge({ plan: plan(), run, send: async () => { throw new Error('호출 안 함'); }, model: 'claude-sonnet-5-5', budget: new Budget(1), reproduceDir: join(out, 'repro') });
  const [first, second] = [await j(1), await j(2)];
  assert.deepEqual([first.reproduceDir, second.reproduceDir], ['repro', 'repro-2']);
  assert.equal(second.verdicts.find(v => v.id === 'S1.C1')?.reproduction, 'reproduced', '두 번째 판정도 자기 폴더에서 다시 실행한다');
});
