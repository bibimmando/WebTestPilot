import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { explore, otherPages } from '../src/explore.ts';
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
    // 허용 origin 밖으로 보내는 리다이렉트(정책 위반 기록용)
    if (req.url === '/away') { res.writeHead(302, { location: 'http://localhost:9/' }); return res.end(); }
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

test('여러 페이지 사이트: 사이트 지도를 만들고 페이지 종류마다 대화를 나눠 계획을 합친다', async () => {
  const firsts: string[] = [];
  // 대화마다 첫 메시지(범위·이어 쓸 ID)를 보고 snapshot → 제목 pin → 계획 제출을 한다.
  const send: Send = async req => {
    const first = String(req.messages[0].content);
    if (req.messages.length === 1) firsts.push(first);
    const last = req.messages.at(-1)!;
    const text = Array.isArray(last.content) ? last.content.map(b => (b.type === 'tool_result' ? String(b.content) : '')).join('\n') : '';
    const S = first.match(/S(\d+)부터/)![1], F = first.match(/F(\d+)부터/)![1];
    const call = (name: string, input: unknown) => ({ id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: `t${req.messages.length}`, name, input }],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message;
    if (req.messages.length === 1) return call('snapshot', {});
    if (req.messages.length === 3) return call('pin', { ref: ref(text, 'heading'), group: false });
    const T = text.match(/(T\d+) =/)![1];
    const title = text.match(/"name":"\^(.*)\$"/)![1];
    return call('submit_plan', { features: [{ id: `F${F}`, name: `${title} 제목`, page: 'x' }], unplanned: [],
      scenarios: [{ id: `S${S}`, title: `${title} 제목`, covers: [`F${F}`], start: { url: first.match(/시작 URL: (\S+)/)![1] }, steps: [],
        checks: [{ id: `S${S}.C1`, after: 'start', target: T, read: 'visible', op: 'equals', expected: 'true', source: { kind: 'inferred', rule: 'no-error-page', quote: '페이지가 오류 없이 열려 제목이 보인다' } }] }] });
  };
  const r = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [{ id: 'R1', text: '로그인하면 주문 내역을 본다' }], send, model: 'claude-opus-5-5', budget: new Budget(1), maxTurns: 20 });
  assert.equal(r.stop, 'done', JSON.stringify(r.conversations));
  assert.deepEqual(r.sitemap!.templates.map(t => t.key.replace(origin, '')), ['/home.html', '/item/:x', '/cart.html']);
  assert.deepEqual(r.conversations.map(c => [c.template.replace(origin, ''), c.planned]), [['/home.html', true], ['/item/:x', true], ['/cart.html', true]]);
  assert.match(firsts[1], /이번 대화의 범위: 페이지 종류 .*\/item\/:x/);
  assert.deepEqual(r.plan!.scenarios.filter(s => !s.variantOf).map(s => [s.id, s.title]), [['S1', '홈 화면 제목'], ['S2', '상품 A 제목'], ['S3', '장바구니 제목']]);
  assert.deepEqual(r.plan!.scenarios.filter(s => s.variantOf).map(s => [s.variantOf, s.start.url.replace(origin, '')]), [['S2', '/item/b.html'], ['S2', '/item/c.html']],
    'C4: 상품 템플릿 계획을 같은 템플릿 다른 페이지 2개(대표 포함 3)에 복제한다');
  assert.deepEqual(Object.keys(r.plan!.targets).sort(), ['T1', 'T2', 'T3'], '대상 ID는 대화 사이에 겹치지 않는다');
  assert.deepEqual(r.plan!.unplanned, [{ requirement: 'R1', reason: '어느 페이지 종류의 대화에서도 계획하지 않음' }]);
  assert.deepEqual(validate(r.plan!, r.plan!.requirements, new Map(Object.entries(r.plan!.targets)), [origin]), [], '합친 계획은 실행 검증을 통과한다');
  assert.deepEqual([r.sitemap!.visited.filter(u => u.includes('/item/')).length, r.sitemap!.unvisited.map(u => u.replace(origin, ''))], [2, ['/item/c.html']],
    '같은 페이지 종류는 2개까지만 방문하고 나머지는 미방문으로 남긴다');
  assert.equal(r.complete, true);

  const limited = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [], send, model: 'claude-opus-5-5', budget: new Budget(1), maxTurns: 20, maxTemplates: 2 });
  assert.deepEqual(limited.conversations.map(c => [c.template.replace(origin, ''), c.stop, c.detail ?? '']).at(-1), ['/cart.html', 'not_attempted', '페이지 종류 수 한도(2)']);
  assert.equal(limited.complete, false, '시도하지 않은 페이지 종류가 있으면 완료가 아니다');

  // 동시 실행: 대화가 실제로 겹쳐 돌고, 합친 결과는 순차와 같은 순서·대상이며 S#·F#는 대화마다 다른 구간을 쓴다.
  // 각 대화의 첫 호출은 세 대화가 모두 시작할 때까지 기다린다. 순차 실행이면 기다림이 시간 초과로 끝난다.
  let arrived = 0, together = true, release = () => {};
  const gate = new Promise<void>(res => { release = res; });
  const slow: Send = async req => {
    if (req.messages.length === 1) {
      if (++arrived === 3) release();
      if (!await Promise.race([gate.then(() => true), new Promise<boolean>(res => setTimeout(() => res(false), 3000))])) together = false;
    }
    return send(req);
  };
  const par = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [], send: slow, model: 'claude-opus-5-5', budget: new Budget(5), maxTurns: 20, concurrency: 3 });
  assert.ok(together && arrived === 3, '세 대화가 동시에 돈다');
  assert.deepEqual(par.conversations.map(c => [c.template.replace(origin, ''), c.planned]), [['/home.html', true], ['/item/:x', true], ['/cart.html', true]]);
  assert.deepEqual(par.plan!.scenarios.filter(s => !s.variantOf).map(s => [s.id, s.title]), [['S1', '홈 화면 제목'], ['S101', '상품 A 제목'], ['S201', '장바구니 제목']]);
  assert.deepEqual(Object.keys(par.plan!.targets).sort(), ['T1', 'T2', 'T3'], '동시에 고정해도 대상 ID는 겹치지 않는다');
  assert.deepEqual(validate(par.plan!, par.plan!.requirements, new Map(Object.entries(par.plan!.targets)), [origin]), []);

  // 큐 순환: 턴 한도로 계획 없이 끝난 페이지 종류는 첫 순회 뒤 새 대화로 한 번 더 시도한다.
  const msg = (req: Anthropic.MessageCreateParamsNonStreaming, content: unknown[], stop = 'tool_use') => ({ id: 'm', type: 'message', role: 'assistant', model: req.model,
    stop_reason: stop, stop_sequence: null, content, usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message;
  const stuck: Send = async req => {
    const first = String(req.messages[0].content);
    if (/범위: 페이지 종류 \S*\/cart\.html/.test(first) && !first.includes('앞선 대화는 턴')) {
      // 계획을 내지 못한 대화가 F3에 질문을 남긴다. 재시도 대화도 자기 기능을 F3으로 쓴다.
      if (req.messages.length === 1) return msg(req, [{ type: 'tool_use', id: 'q1', name: 'ask_user', input: { question: '장바구니는 로그인 없이 유지되나요?', options: ['예', '아니요'], feature: 'F3' } }]);
      return send({ ...req, messages: req.messages.slice(0, 1) });
    }
    return send(req);
  };
  const retried = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [], send: stuck, model: 'claude-opus-5-5', budget: new Budget(1), maxTurns: 20, turnsPerTemplate: 4 });
  assert.deepEqual(retried.conversations.map(c => [c.template.replace(origin, ''), c.stop, c.planned]),
    [['/home.html', 'done', true], ['/item/:x', 'done', true], ['/cart.html', 'max_turns', false], ['/cart.html', 'done', true]]);
  assert.ok(firsts.some(f => f.includes('앞선 대화는 턴 4개를 쓰고 계획 없이 끝났습니다')), '재시도 대화에 앞선 시도를 알린다');
  assert.equal(retried.complete, true, '재시도에서 계획했으면 완료다');
  assert.deepEqual(retried.plan!.questions.map(q => [q.question, q.feature]), [['장바구니는 로그인 없이 유지되나요?', undefined]],
    '계획을 내지 못한 대화의 질문은 다른 대화의 같은 번호 기능에 붙이지 않는다');

  // 정책 위반: 앞 대화가 계획을 냈어도, 어느 대화에서든 허용 origin 밖으로 나간 기록이 있으면 계획을 버린다.
  const away: Send = async req => {
    const first = String(req.messages[0].content);
    if (/범위: 페이지 종류 \S*\/cart\.html/.test(first)) {
      if (req.messages.length === 1) return msg(req, [{ type: 'tool_use', id: 'n1', name: 'navigate', input: { url: origin + '/away' } }]);
      return msg(req, [{ type: 'text', text: '끝' }], 'end_turn');
    }
    return send(req);
  };
  const tainted = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [], send: away, model: 'claude-opus-5-5', budget: new Budget(1), maxTurns: 20 });
  assert.deepEqual([tainted.plan, tainted.stop, tainted.conversations[0].planned], [undefined, 'error', true]);
  assert.match(tainted.detail ?? '', /정책 위반이 있어 계획을 버림: redirect http:\/\/localhost:9\//);

  // 동시 실행의 번호 구간 밖 ID는 제출에서 거부한다(상품 대화가 S1·F1을 쓰려 함).
  const results: string[] = [];
  const outside: Send = async req => {
    const last = req.messages.at(-1)!;
    if (Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') results.push(String(b.content));
    const first = String(req.messages[0].content);
    return send(first.includes('S101부터') ? { ...req, messages: [{ role: 'user', content: first.replace('S101부터', 'S1부터').replace('F101부터', 'F1부터') }, ...req.messages.slice(1)] } : req);
  };
  await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html',
    requirements: [], send: outside, model: 'claude-opus-5-5', budget: new Budget(5), maxTurns: 20, turnsPerTemplate: 4, concurrency: 3 });
  assert.ok(results.some(t => t.includes('ID는 S101~S200, F101~F200 안에서 쓰세요: S1, F1')), results.join('\n').slice(0, 500));
});

test('C4 페이지 고르기: 경로만 다른 템플릿에서 방문한 페이지를 먼저, 쿼리만 다른 페이지는 고르지 않는다', () => {
  const o = 'http://x.test';
  const map = { visited: [`${o}/p/a`, `${o}/p/c`, `${o}/list`], unvisited: [], failed: [],
    templates: [{ key: `${o}/p/:x`, pages: [`${o}/p/a`, `${o}/p/b`, `${o}/p/c`, `${o}/p/a?x=1`] }, { key: `${o}/list`, pages: [`${o}/list`, `${o}/list?s=1`] }] };
  const plan = { scenarios: [{ id: 'S1', start: { url: `${o}/p/a` } }, { id: 'S2', start: { url: `${o}/list` } }] } as any;
  assert.deepEqual(otherPages(plan, map, 3), { S1: [`${o}/p/c`, `${o}/p/b`] }, '대표 포함 3페이지');
  // 같은 템플릿에서 시작 페이지가 둘이면 합쳐서 3페이지가 되도록 하나만 더 고르고, 두 시나리오가 같은 페이지를 쓴다.
  const two = { scenarios: [{ id: 'S1', start: { url: `${o}/p/a` } }, { id: 'S3', start: { url: `${o}/p/b` } }] } as any;
  assert.deepEqual(otherPages(two, map, 3), { S1: [`${o}/p/c`], S3: [`${o}/p/c`] });
});

test('정체 종료: 화면이 바뀌지 않는 행동이 이어지면 제출을 재촉하고, 더 이어지면 대화를 끝낸다', async () => {
  const results: string[] = [];
  const send: Send = async req => {
    const last = req.messages.at(-1)!;
    if (Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') results.push(String(b.content));
    // 처음엔 snapshot, 그다음부터는 아무 일도 일어나지 않는 제목을 계속 누른다.
    const [name, input] = req.messages.length === 1 ? ['snapshot', {}] : ['click', { ref: ref(results[0], 'heading') }];
    return { id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: `t${req.messages.length}`, name, input }],
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message;
  };
  const r = await explore({ browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/form.html',
    requirements: [], send, model: 'claude-opus-5-5', budget: new Budget(1), maxTurns: 20 });
  assert.deepEqual([r.stop, r.detail, r.conversations[0].stop, r.complete], ['stalled', '화면이 바뀌지 않는 행동 8번 연속', 'stalled', false]);
  assert.match(results[1], /화면 변화 없음, 1번 연속/);
  assert.ok(results[5].includes('계획을 제출하거나 다른 기능을 보세요') && !results[4].includes('계획을 제출하거나'), '5번째부터 제출을 재촉한다');
  assert.equal(results.length, 8, '8번째 클릭에서 대화가 끝나 그 결과는 모델에 보내지 않는다(snapshot 1 + 클릭 7)');
});

test('기본 한도: 분류 몫을 남길 수 없거나 탐색 시간이 지나면 새 대화를 시작하지 않고 미완료로 남긴다', async () => {
  const never: Send = async () => { throw new Error('호출하면 안 됨'); };
  const base = { browser: browser!, policy: { origins: [origin] }, startUrl: origin + '/home.html', requirements: [], send: never, model: 'claude-opus-5-5', maxTurns: 20 };
  const kept = await explore({ ...base, budget: new Budget(1), keepUsd: 1.5 });
  assert.deepEqual([kept.stop, kept.detail, kept.plan, kept.complete], ['budget', '예산 한도(분류 몫 남김)', undefined, false]);
  assert.ok(kept.conversations.every(c => c.stop === 'not_attempted' && c.detail === '예산 한도(분류 몫 남김)'), JSON.stringify(kept.conversations));
  const late = await explore({ ...base, budget: new Budget(1), deadline: Date.now() - 1 });
  assert.deepEqual([late.stop, late.detail], ['budget', '탐색 시간 한도']);
});
