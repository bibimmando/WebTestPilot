import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { openContext, snapshot, resolveRef, resolveText, resolveGroup, toLocator, valuePattern, parseSnapshot, ariaText, type AriaNode } from '../src/browser.ts';

let browser: Browser | undefined;
let server: Server | undefined;
let origin = '';
const received: string[] = [];

before(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://localhost:1/' }); return res.end(); }
    res.end(req.method === 'GET' ? '<p>ok</p>' : 'written');
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { await browser?.close(); server?.close(); });

async function page(html: string): Promise<Page> {
  const p = await browser!.newPage();
  await p.setContent(html);
  return p;
}

const refs = (snap: string, line: string) =>
  snap.split('\n').filter(l => l.includes(line)).map(l => l.match(/\[ref=(e\d+)\]/)![1]);
const refOf = (snap: string, line: string) => {
  const [r] = refs(snap, line);
  assert.ok(r, `no ref for ${line} in\n${snap}`);
  return r;
};

test('부분 snapshot은 전체 snapshot과 같은 ref를 쓴다', async () => {
  const p = await page('<ul><li>사과 <button>담기</button></li></ul><p>합계</p>');
  const full = await snapshot(p);
  const scoped = await snapshot(p, refOf(full, '- list'));
  assert.ok(scoped.includes(`[ref=${refOf(full, 'button "담기"')}]`));
  assert.ok(!scoped.includes('합계'));
});

test('이름 있는 컨트롤은 역할·이름 대상이 된다', async () => {
  const p = await page('<button aria-label="수량 증가">+</button>');
  const r = await resolveRef(p, refOf(await snapshot(p), 'button "수량 증가"'));
  assert.deepEqual(r, { ok: true, ref: r.ref, target: { role: 'button', name: '^수량 증가$' } });
});

test('같은 이름의 버튼은 상위 항목으로 구분하고 각자 자기 요소를 가리킨다', async () => {
  const p = await page('<ul><li>사과 <button>담기</button></li><li>배 <button>담기</button></li></ul>');
  const [a, b] = await Promise.all(refs(await snapshot(p), 'button "담기"').map(ref => resolveRef(p, ref)));
  assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
  assert.notDeepEqual(a.target, b.target);
  assert.equal(await toLocator(p, a.target).textContent(), '담기');
  assert.equal(await toLocator(p, a.target).and(p.getByRef(a.ref)).count(), 1);
});

test('숫자가 든 텍스트는 값이 바뀌거나 숫자가 아니게 돼도 같은 요소를 찾는다', async () => {
  const p = await page('<p>합계 100원</p><p>배송비 3,000원</p>');
  const r = await resolveRef(p, refOf(await snapshot(p), '합계 100원'));
  assert.ok(r.ok, JSON.stringify(r));
  const el = toLocator(p, r.target);
  for (const value of ['합계 12,500원', '합계 NaN원', '합계 원']) {
    await p.evaluate(v => { document.querySelector('p')!.textContent = v; }, value);
    assert.equal(await el.count(), 1, value);
    assert.equal(await el.textContent(), value);
  }
});

test('값이 서로 바뀌어도 다른 요소로 옮겨가지 않는다', async () => {
  const p = await page('<p>상품 1개</p><p>합계 2개</p>');
  const r = await resolveRef(p, refOf(await snapshot(p), '상품 1개'));
  assert.ok(r.ok);
  await p.evaluate(() => { const [a, b] = document.querySelectorAll('p'); a.textContent = '상품 2개'; b.textContent = '합계 1개'; });
  assert.equal(await toLocator(p, r.target).textContent(), '상품 2개');
});

test('신원이 약한 요소는 거부한다', async () => {
  const p = await page('<div><span>12</span></div><button><svg width="9" height="9"></svg></button><button>3</button>');
  const snap = await snapshot(p);
  assert.deepEqual(await resolveRef(p, refOf(snap, '"12"')), { ok: false, ref: refOf(snap, '"12"'), reason: 'value_only' });
  const unnamed = refs(snap, '- button [ref=').at(0)!;
  assert.deepEqual(await resolveRef(p, unnamed), { ok: false, ref: unnamed, reason: 'unnamed' });
  const digitsOnly = refOf(snap, 'button "3"');
  assert.deepEqual(await resolveRef(p, digitsOnly), { ok: false, ref: digitsOnly, reason: 'value_only' });
});

test('구분할 수 없는 같은 요소는 순서로 고르지 않고 거부한다', async () => {
  const p = await page('<button>삭제</button><button>삭제</button>');
  const ref = refs(await snapshot(p), 'button "삭제"')[1];
  assert.deepEqual(await resolveRef(p, ref), { ok: false, ref, reason: 'ambiguous' });
});

test('텍스트 고정: ref 없는 span의 값을 찾고, 자식 버튼의 같은 텍스트는 거부한다', async () => {
  const p = await page('<header>합계 <span>3</span>개</header><section aria-label="요약">합계 <button>합계 보기</button></section>');
  const snap = await snapshot(p);
  const ok = await resolveText(p, refOf(snap, '- banner'), '합계 3개');
  assert.ok(ok.ok, JSON.stringify(ok) + '\n' + snap);
  assert.equal(await toLocator(p, ok.target).textContent(), '합계 3개');
  const r = await resolveText(p, refOf(snap, 'region "요약"'), '합계');
  if (r.ok) assert.equal(await toLocator(p, r.target).and(p.getByRole('button')).count(), 0, JSON.stringify(r));
});

test('그룹 고정: 중첩 목록의 하위 항목이 섞이면 거부한다', async () => {
  const flat = await page('<ul aria-label="상품"><li>a</li><li>b</li></ul>');
  const okRef = refs(await snapshot(flat), '- listitem')[0];
  const ok = await resolveGroup(flat, okRef);
  assert.ok(ok.ok && (await toLocator(flat, ok.target).count()) === 2, JSON.stringify(ok));
  const nested = await page('<ul aria-label="메뉴"><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>');
  const r = await resolveGroup(nested, refs(await snapshot(nested), '- listitem')[0]);
  assert.ok(!r.ok, JSON.stringify(r));
});

test('클릭할 수 있는 링크와 콜론이 든 이름(YAML에서 따옴표로 감싸지는 줄)도 고정한다', async () => {
  const p = await page('<nav><a href="/products">Shop: All</a></nav>');
  const snap = await snapshot(p);
  assert.match(snap, /'link "Shop: All" \[ref=\w+\] \[cursor=pointer\]'/, '이 회귀가 지키는 줄 형태가 바뀌었다');
  const r = await resolveRef(p, refOf(snap, 'link "Shop: All"'));
  assert.deepEqual(r, { ok: true, ref: r.ref, target: { role: 'link', name: '^Shop: All$' } });
});

test('없는 ref는 거부한다', async () => {
  const p = await page('<button>확인</button>');
  assert.deepEqual(await resolveRef(p, 'e999'), { ok: false, ref: 'e999', reason: 'unknown_ref' });
});

test('특수문자가 든 이름도 안전하게 처리한다', async () => {
  const names = [`Bob's "best" 100'`, 'a/b\\c (3)', 'line 1 😀', 'x $^.*+?'];
  const p = await page(names.map(n => `<button aria-label="${n.replace(/"/g, '&quot;')}">x</button>`).join(''));
  const snap = await snapshot(p);
  for (const ref of refs(snap, '- button')) {
    const r = await resolveRef(p, ref);
    assert.ok(r.ok, JSON.stringify(r));
  }
});

test('쓰기 요청·허용 밖 origin·WebSocket을 막고 서버에 도달하지 않는다', async () => {
  const { context, blocked } = await openContext(browser!, { origins: [origin] });
  const p = await context.newPage();
  await p.goto(origin);
  received.length = 0;
  const send = (url: string, method: string) =>
    p.evaluate(([u, m]) => fetch(u, { method: m }).then(r => r.text(), () => 'blocked'), [url, method]);
  assert.equal(await send(origin + '/r', 'GET'), '<p>ok</p>');
  assert.equal(await send(origin + '/w', 'POST'), 'blocked');
  assert.equal(await send('http://localhost:1/', 'GET'), 'blocked');
  await p.evaluate(u => navigator.sendBeacon(u + '/beacon', 'x'), origin);
  await p.evaluate(u => new Promise(r => { const ws = new WebSocket(u.replace('http', 'ws')); ws.onclose = ws.onerror = r; }), origin);
  await p.waitForTimeout(300);
  assert.deepEqual(received, ['GET /r']);
  assert.ok(blocked.some(b => b.startsWith('POST') && b.endsWith('/w')));
  assert.ok(blocked.some(b => b.startsWith('WS ')));
  await context.close();
});

test('외부로의 리다이렉트는 위반으로 남긴다', async () => {
  const { context, violations } = await openContext(browser!, { origins: [origin] });
  const p = await context.newPage();
  await p.goto(origin + '/redirect').catch(() => {});
  assert.deepEqual(violations, ['redirect http://localhost:1/']);
  await context.close();
});

test('쓰기 권한이 있으면 쓰기 요청을 통과시킨다', async () => {
  const { context } = await openContext(browser!, { origins: [origin], allowWrites: true });
  const p = await context.newPage();
  await p.goto(origin);
  assert.equal(await p.evaluate(u => fetch(u, { method: 'POST' }).then(r => r.text()), origin), 'written');
  await context.close();
});

test('valuePattern은 숫자만 임의 값으로 바꾸고 숫자뿐이면 null', () => {
  assert.equal(valuePattern('담기'), '담기');
  assert.equal(valuePattern('합계 1,000원'), '합계 .*?원');
  assert.equal(valuePattern('장바구니 (3)'), '장바구니 \\(.*?\\)');
  assert.equal(valuePattern('12'), null);
  assert.equal(valuePattern('3,000 ₩'), null);
});

test('parseSnapshot은 구조화 snapshot에서 이름·텍스트·부모·ownText를 읽는다', () => {
  // ariaSnapshotJSON 형태. 텍스트 조각은 문자열 자식이다.
  const m = parseSnapshot([
    { role: 'list', ref: 'e1', children: [{ role: 'listitem', ref: 'e2', children: ['사과', { role: 'button', name: '담: "기"', ref: 'e3' }] }] },
    { role: 'paragraph', ref: 'e4', text: '12' },
    { role: 'iframe', ref: 'e5', children: [{ role: 'button', name: 'in', ref: 'f1e2' }] },
    { role: 'link', name: 'Shop: All', ref: 'f2e48' },
  ]);
  assert.equal(m.get('f1e2')!.parent!.ref, 'e5');
  assert.equal(m.get('f2e48')!.name, 'Shop: All');
  assert.equal(m.get('e3')!.name, '담: "기"');
  assert.equal(m.get('e3')!.parent!.ref, 'e2');
  assert.deepEqual(m.get('e2')!.ownText, ['사과']);
  assert.equal(m.get('e4')!.text, '12');
});

test('ariaText는 모델이 본 텍스트와 같다: 숨긴 텍스트 제외, CSS 변환 미적용, 이름 있는 요소는 이름', async () => {
  const p = await page([
    '<p id=a style="text-transform:uppercase">Textiles<span hidden> secret</span></p>',
    '<ul><li id=b>사과 <b>1,100원</b> <button>담기</button></li></ul>',
    '<a id=c href="/cart" aria-label="View cart"><img alt="Bag" src="data:,"></a>',
    '<button id=d><span aria-hidden="true">+</span> 담기</button>',
  ].join(''));
  const read = async (id: string) => ariaText(await p.locator('#' + id).ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]);
  assert.equal(await read('a'), 'Textiles');
  assert.equal(await read('b'), '사과 1,100원 담기', '이름 없는 목록 항목은 자손 텍스트');
  assert.equal(await read('c'), 'View cart', '자식이 있어도 이름 있는 링크는 이름');
  const snap = await snapshot(p);
  const seen = snap.split('\n').find(l => l.includes('button') && l.includes('담기') && !l.includes('listitem'))!;
  assert.ok(seen.includes(await read('d')), `실행에서 읽은 버튼 텍스트(${await read('d')})가 탐색 snapshot(${seen})과 같아야 한다`);
  assert.match(snap, /Textiles/, '모델이 보는 YAML snapshot도 같은 텍스트');
});
