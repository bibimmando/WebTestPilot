import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { explore } from '../src/explore.ts';
import { Budget, type Send } from '../src/agent.ts';
import { validate, type Draft } from '../src/plan.ts';

let browser: Browser | undefined;
let server: Server | undefined;
let origin = '';
const posts: string[] = [];

before(async () => {
  browser = await chromium.launch();
  server = createServer(async (req, res) => {
    if (req.method !== 'GET') { posts.push(`${req.method} ${req.url}`); return res.end('ok'); }
    try {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(await readFile(new URL(`./fixtures${new URL(req.url!, "http://x").pathname}`, import.meta.url)));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { await browser?.close(); server?.close(); });

// 가짜 모델: 각 단계 함수가 직전 도구 결과를 보고 다음 도구 호출을 정한다. null이면 말없이 끝낸다.
type Call = { name: string; input: Record<string, unknown> };
type Step = (last: string, all: string[]) => Call[] | null;

function scripted(steps: Step[]): Send & { seen: Anthropic.MessageCreateParamsNonStreaming[] } {
  const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const outputs: string[] = [];
  let i = 0;
  const send = async (req: Anthropic.MessageCreateParamsNonStreaming) => {
    seen.push(req);
    const last = req.messages.at(-1)!;
    const text = Array.isArray(last.content)
      ? last.content.map(b => (b.type === 'tool_result' ? String(b.content) : '')).join('\n') : String(last.content);
    outputs.push(text);
    const calls = steps[i++]?.(text, outputs) ?? null;
    const content = calls
      ? calls.map((c, k) => ({ type: 'tool_use', id: `tu_${i}_${k}`, name: c.name, input: c.input }))
      : [{ type: 'text', text: '끝' }];
    return {
      id: `msg_${i}`, type: 'message', role: 'assistant', model: req.model, content,
      stop_reason: calls ? 'tool_use' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
  return Object.assign(send, { seen });
}

/** 텍스트에서 needle이 든 줄의 ref (n번째). */
function ref(text: string, needle: string, n = 0): string {
  const hits = text.split('\n').filter(l => l.includes(needle) && l.includes('[ref='));
  assert.ok(hits[n], `"${needle}" 줄이 없음:\n${text.slice(0, 3000)}`);
  const m = hits[n].match(/\[ref=([a-z0-9]+)\]/);
  assert.ok(m, hits[n]);
  return m[1];
}

const run = (path: string, requirements: { id: string; text: string }[], steps: Step[], budget = 1) => {
  const send = scripted(steps);
  return explore({
    browser: browser!, policy: { origins: [origin] }, startUrl: origin + path, requirements,
    send, model: 'claude-opus-5-5', budget: new Budget(budget), maxTurns: 20,
  }).then(r => ({ ...r, send }));
};

test('긴 목록: 같은 이름의 버튼을 상위 항목으로 구분하고, 값이 든 텍스트는 패턴으로 고정한다', async () => {
  const pins: string[] = [];
  const r = await run('/list.html', [{ id: 'R1', text: '담기를 누르면 장바구니 개수가 1 늘어난다' }], [
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'button "담기"', 16), group: false } },
      { name: 'pin', input: { ref: ref(snap, '- banner'), group: false, text: '장바구니 (0)' } },
      { name: 'pin', input: { ref: ref(snap, '- listitem'), group: true } },
    ],
    out => {
      pins.push(...out.split('\n').filter(l => /^T\d+ =/.test(l)));
      return [{ name: 'submit_plan', input: {
        scenarios: [{ id: 'S1', title: '담기', covers: ['R1'], start: { url: origin + '/list.html' },
          steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
          checks: [
            { id: 'S1.C1', after: 'start', target: 'T3', read: 'count', op: 'equals', expected: '30', source: { kind: 'observed' } },
            { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'text', op: 'equals', expected: '장바구니 (1)',
              source: { kind: 'requirement', id: 'R1', quote: '장바구니 개수가 1 늘어난다' } },
          ] }],
        unplanned: [],
      } satisfies Draft }];
    },
  ]);
  assert.equal(r.stop, 'done', r.detail ?? '');
  assert.equal(pins.length, 3, pins.join('\n'));
  const t = r.plan!.targets;
  assert.ok(t.T1.target.within, JSON.stringify(t.T1));
  assert.ok(!JSON.stringify(t.T2.target).includes('0'), JSON.stringify(t.T2));
  assert.equal(t.T3.group, true);
});

test('모달: 행동 후에 나타난 요소를 그 상태에서 고정하고, 틀린 계획은 오류를 받고 고친다', async () => {
  const reqs = [
    { id: 'R1', text: '쿠폰 SAVE10을 적용하면 결제 금액이 10% 줄어든다' },
    { id: 'R2', text: '쿠폰 사용 내역은 마이페이지에 남는다' },
  ];
  const plan = (unplanned: Draft['unplanned']) => ({ name: 'submit_plan', input: {
    scenarios: [{ id: 'S1', title: '쿠폰', covers: ['R1'], start: { url: origin + '/modal.html' },
      steps: [
        { id: 'S1.A1', op: 'click', target: 'T1' },
        { id: 'S1.A2', op: 'fill', target: 'T2', value: 'SAVE10' },
        { id: 'S1.A3', op: 'click', target: 'T3' },
      ],
      checks: [{ id: 'S1.C1', after: 'S1.A3', target: 'T4', read: 'text', op: 'equals', expected: '결제 금액 18,000원',
        source: { kind: 'requirement', id: 'R1', quote: '결제 금액이 10% 줄어든다' } }] }],
    unplanned,
  } });
  let firstError = '';
  const r = await run('/modal.html', reqs, [
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'button "쿠폰 적용"'), group: false } },
      { name: 'pin', input: { ref: ref(snap, '결제 금액'), group: false } },
    ],
    () => [{ name: 'click', input: { ref: 'e999' } }],
    () => [{ name: 'snapshot', input: {} }],
    snap => [{ name: 'click', input: { ref: ref(snap, 'button "쿠폰 적용"') } }],
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'textbox "쿠폰 코드"'), group: false } },
      { name: 'pin', input: { ref: ref(snap, 'button "확인"'), group: false } },
    ],
    // 대상 번호를 실제 pin 순서대로 쓰도록 계획을 다시 쓴다: T1 쿠폰 적용, T2 결제 금액, T3 코드, T4 확인
    () => { const p = plan([]); renumber(p.input); return [p]; },
    out => { firstError = out; const p = plan([{ requirement: 'R2', reason: '로그인이 필요함' }]); renumber(p.input); return [p]; },
  ]);
  assert.equal(r.stop, 'done', r.detail ?? '');
  assert.match(firstError, /R2 is neither covered nor unplanned/);
  assert.ok(r.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.is_error)));
  assert.equal(r.plan!.targets.T3.target.role, 'textbox');
  assert.deepEqual(r.plan!.unplanned, [{ requirement: 'R2', reason: '로그인이 필요함' }]);
});

function renumber(draft: Record<string, any>) {
  const map: Record<string, string> = { T2: 'T3', T3: 'T4', T4: 'T2' };
  for (const s of draft.scenarios) {
    for (const st of s.steps) if (st.target) st.target = map[st.target] ?? st.target;
    for (const c of s.checks) c.target = map[c.target] ?? c.target;
  }
}

test('폼: 탐색 중 쓰기 요청은 서버에 닿지 않고, 허용 밖 이동은 도구 오류가 된다', async () => {
  posts.length = 0;
  let navError = '';
  const r = await run('/form.html', [{ id: 'R1', text: '잘못된 이메일로 가입하면 오류 메시지가 보인다' }], [
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'fill', input: { ref: ref(snap, 'textbox "이메일"'), value: 'a@b' } },
      { name: 'click', input: { ref: ref(snap, 'button "가입"') } },
    ],
    () => [{ name: 'navigate', input: { url: 'http://localhost:1/' } }],
    out => { navError = out; return [{ name: 'navigate', input: { url: origin + '/form.html' } }]; },
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'textbox "이메일"'), group: false } },
      { name: 'pin', input: { ref: ref(snap, 'button "가입"'), group: false } },
    ],
    out => [{ name: 'submit_plan', input: { scenarios: [], unplanned: [] } }],
  ]);
  assert.deepEqual(posts, []);
  assert.ok(r.blocked.some(b => b.startsWith('POST') && b.includes('/signup')), r.blocked.join('\n'));
  assert.match(navError, /허용되지 않은 origin/);
  // 계획이 비면 요구사항 누락으로 거부한다.
  assert.equal(r.stop, 'no_submit');
  assert.ok(JSON.stringify(r.messages).includes('neither covered'));
});

test('예산을 넘을 호출은 보내지 않는다', async () => {
  const r = await run('/form.html', [{ id: 'R1', text: 'x' }], [() => [{ name: 'snapshot', input: {} }]], 0.001);
  assert.equal(r.stop, 'budget');
  assert.equal(r.send.seen.length, 0);
});

test('제출 없이 끝나면 no_submit이고, 비용은 실제 usage로 정산한다', async () => {
  const budget = new Budget(1);
  const send = scripted([() => null]);
  const r = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/form.html',
    requirements: [{ id: 'R1', text: 'x' }], send, model: 'claude-opus-5-5', budget, maxTurns: 5 });
  assert.equal(r.stop, 'no_submit');
  assert.equal(budget.spent, (1000 * 4 + 200 * 20) / 1e6);
});

test('가격을 모르는 모델은 호출하지 않는다', async () => {
  const send = scripted([() => null]);
  const r = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/form.html',
    requirements: [{ id: 'R1', text: 'x' }], send, model: 'claude-unknown', budget: new Budget(100), maxTurns: 5 });
  assert.equal(r.stop, 'budget');
  assert.equal(send.seen.length, 0);
});

test('새로고침하면 바뀌는 요소는 이름으로 고정할 수 없고, 라벨 영역 안 순서로는 고정한다', async () => {
  let byName = '', byPosition = '';
  await run('/related.html', [{ id: 'R1', text: '관련 상품을 누르면 그 상품의 상세가 열린다' }], [
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'link'), group: false } },
      { name: 'pin', input: { ref: ref(snap, 'link'), group: false, position: true } },
    ],
    (_, all) => { [byName, byPosition] = all.at(-1)!.split('\n').length ? [all.at(-1)!, all.at(-1)!] : ['', '']; return null; },
  ]);
  assert.match(byName, /새로 열면 사라지는/);
  assert.match(byPosition, /"anchor":"\^Related\$","nth":0,"of":2/);
});

test('요구사항 없이: 일반 규칙 목록을 받고, 기능(F#) 계획과 업무 규칙 질문이 계획에 남는다', async () => {
  let first = '';
  const r = await run('/list.html', [], [
    (msg) => { first = msg; return [{ name: 'ask_user', input: { question: '장바구니 수량에 상한이 있나요?', options: ['있다', '없다'], feature: 'F1' } },
      ...[2, 3, 4, 5, 6].map(n => ({ name: 'ask_user', input: { question: `질문 ${n}`, options: ['예', '아니오'] } })),
      { name: 'snapshot', input: {} }]; },
    (_, all) => [
      { name: 'pin', input: { ref: ref(all.at(-1)!, 'button "담기"', 16), group: false } },
      { name: 'pin', input: { ref: ref(all.at(-1)!, '- banner'), group: false, text: '장바구니 (0)' } },
    ],
    () => [{ name: 'submit_plan', input: {
      features: [{ id: 'F1', name: '장바구니 담기', page: origin + '/list.html' }],
      scenarios: [{ id: 'S1', title: '담기', covers: ['F1'], start: { url: origin + '/list.html' },
        steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
        checks: [
          { id: 'S1.C1', after: 'start', target: 'T2', read: 'text', op: 'equals', expected: '장바구니 (0)', source: { kind: 'observed' }, precondition: true },
          { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'text', op: 'equals', expected_from: 'S1.C1', offset: 1, source: { kind: 'inferred', rule: 'step-by-one', quote: '이 검사에 이 일반 규칙이 적용되는 이유를 적는다' } },
        ] }],
      unplanned: [],
    } satisfies Draft }],
  ]);
  assert.match(first, /요구사항: 없음/);
  assert.match(first, /link-target/, '일반 규칙 목록이 과제에 들어간다');
  assert.equal(r.stop, 'done', r.detail ?? '');
  assert.deepEqual(r.plan!.features.map(f => f.id), ['F1']);
  assert.deepEqual(r.plan!.questions[0], { id: 'Q1', page: origin + '/list.html', question: '장바구니 수량에 상한이 있나요?', options: ['있다', '없다'], feature: 'F1' });
  assert.deepEqual(r.plan!.questions.map(q => q.overLimit ?? false), [false, false, false, false, false, true], '한도를 넘은 질문도 규칙 미확인으로 남긴다');
});

test('다른 쿼리에서 pin한 시작 대상은 시작 URL을 새로 열어 확인하고, 그 확인은 계획에 남아 실행 검증도 통과한다', async () => {
  const r = await run('/list.html?sort=1', [], [
    () => [{ name: 'snapshot', input: {} }],
    snap => [
      { name: 'pin', input: { ref: ref(snap, 'button "담기"', 16), group: false } },
      { name: 'pin', input: { ref: ref(snap, '- banner'), group: false, text: '장바구니 (0)' } },
      { name: 'pin', input: { ref: ref(snap, '- listitem'), group: true } },
    ],
    () => [{ name: 'submit_plan', input: {
      features: [{ id: 'F1', name: '담기', page: origin + '/list.html' }],
      scenarios: [{ id: 'S1', title: '담기', covers: ['F1'], start: { url: origin + '/list.html' },
        steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
        checks: [
          { id: 'S1.C1', after: 'start', target: 'T2', read: 'text', op: 'equals', expected: '장바구니 (0)', source: { kind: 'observed' }, precondition: true },
          { id: 'S1.C2', after: 'S1.A1', target: 'T2', read: 'text', op: 'equals', expected_from: 'S1.C1', offset: 1,
            source: { kind: 'inferred', rule: 'step-by-one', quote: '담기를 한 번 누르면 개수가 하나 는다' } },
        ] }],
      unplanned: [],
    } satisfies Draft }],
  ]);
  assert.equal(r.stop, 'done', JSON.stringify(r.messages.at(-1)).slice(0, 800));
  assert.deepEqual(r.plan!.startVerified!.sort(), [`T1 ${origin}/list.html`, `T2 ${origin}/list.html`]);
  assert.deepEqual(validate(r.plan!, r.plan!.requirements, new Map(Object.entries(r.plan!.targets)), [origin], undefined, new Set(r.plan!.startVerified)), []);
});
