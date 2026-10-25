import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { areaOf, auditPage, pressKey, goneFromArea, MOBILE, openContext, stableOnReload, snapshot, resolveRef, resolveText, resolveGroup, toLocator, shapeChanged, valuePattern, parseSnapshot, ariaText, ariaTextV1, type AriaNode } from '../src/browser.ts';

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

test('사라짐 판단: 글자 모양으로 고정한 값은 내용이 바뀌어 모양에서 벗어나도 사라졌다고 보지 않는다', async () => {
  const p = await page('<section><h2>수량</h2><span>1</span></section>');
  const t = { text: String.raw`^s*S.{0,39}$`, anchor: '^수량$', of: 1 };
  const area = await areaOf(p, t);
  await p.evaluate(() => { document.querySelector('span')!.textContent = '재고를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요 (오류 코드 503)'; });
  assert.equal(await goneFromArea(p, t, area), false);
});

test('구분할 수 없는 같은 요소는 순서로 고르지 않고 거부한다', async () => {
  const p = await page('<button>삭제</button><button>삭제</button>');
  const ref = refs(await snapshot(p), 'button "삭제"')[1];
  assert.deepEqual(await resolveRef(p, ref), { ok: false, ref, reason: 'ambiguous' });
});

test('같은 이름 링크: 이름 없는 머리말·꼬리말은 영역으로 나누고, 영역으로도 안 나뉘면 주소가 같은 링크끼리만 순서로 고정한다', async () => {
  const p = await page('<header><a href="/shop">Shop</a></header><footer><a href="/shop">Shop</a></footer>');
  const [head, foot] = refs(await snapshot(p), 'link "Shop"');
  assert.deepEqual(await resolveRef(p, foot), { ok: true, ref: foot, target: { role: 'link', name: '^Shop$', within: { role: 'contentinfo' } } });
  assert.deepEqual(await resolveRef(p, head), { ok: true, ref: head, target: { role: 'link', name: '^Shop$', within: { role: 'banner' } } });

  // 한 영역 안의 같은 이름 링크 셋: 주소가 같은 둘은 순서로, 주소가 다른 하나는 주소로 고정한다.
  const q = await page('<div><a href="/shop">Shop</a><a href="/sale">Shop</a><a href="/shop">Shop</a></div>');
  const [a, sale, b] = refs(await snapshot(q), 'link "Shop"');
  const r = await resolveRef(q, b);
  assert.deepEqual(r, { ok: true, ref: b, target: { role: 'link', name: '^Shop$', href: '/shop', nth: 1, of: 2 } });
  assert.equal(await toLocator(q, r.ok ? r.target : {}).and(q.getByRef(b)).count(), 1, '자기 요소를 가리킨다');
  assert.deepEqual(await resolveRef(q, sale), { ok: true, ref: sale, target: { role: 'link', name: '^Shop$', href: '/sale' } });
  assert.ok((await resolveRef(q, a)).ok);
  // 같은 주소 링크가 하나 더 생기면 순서가 다른 요소를 가리킬 수 있어 대상이 바뀐 것으로 본다.
  await q.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<a href="/shop">Shop</a>'));
  assert.ok(r.ok && await shapeChanged(q, r.target));
});

test('새로 열어 확인: 지정한 화면 크기에서 연다(모바일에서만 보이는 요소)', async () => {
  const html = '<style>button{display:none}@media (max-width:600px){button{display:inline}}</style><button>메뉴</button>';
  // stableOnReload는 같은 컨텍스트에 새 페이지를 연다. browser.newPage()의 페이지는 컨텍스트에 새 페이지를 열 수 없다.
  const context = await browser!.newContext();
  const p = await context.newPage();
  const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  const t = { role: 'button', name: '^메뉴$' };
  assert.equal(await stableOnReload(p, t, false, 1000, url), false, '지금 크기(데스크톱)에서는 숨는다');
  assert.equal(await stableOnReload(p, t, false, 1000, url, MOBILE), true);
  await context.close();
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
  // 숫자 뒤 단어는 개수에 따라 단·복수가 바뀐다. 어느 쪽을 먼저 봐도 둘 다 맞는다.
  for (const seen of ['2 pieces saved', '1 piece saved']) {
    const re = new RegExp(`^${valuePattern(seen)}$`);
    assert.deepEqual(['1 piece saved', '2 pieces saved', '2 pieces savedx', '2 cards saved'].map(t => re.test(t)), [true, true, false, false], seen);
  }
  // 실제 짝 하나만 허용하고 없는 철자는 만들지 않는다.
  const forms = (seen: string, tries: string[]) => { const re = new RegExp(`^${valuePattern(seen)}$`); return tries.map(t => re.test(t)); };
  assert.deepEqual(forms('1 piece saved', ['1 piecees saved']), [false]);
  assert.deepEqual(forms('1 box', ['2 boxes', '2 boxs']), [true, false]);
  assert.deepEqual(forms('3 boxes', ['1 box', '1 boxe']), [true, false]);
  assert.deepEqual(forms('1 status saved', ['2 statuses saved', '2 statues saved', '2 statu saved']), [true, false, false]);
  assert.deepEqual(forms('2 classes', ['1 class', '1 classe']), [true, false]);
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
  assert.equal(await read('c'), 'View cart', '안의 아이콘 대체 텍스트는 내용이 아니다');
  const snap = await snapshot(p);
  const seen = snap.split('\n').find(l => l.includes('button') && l.includes('담기') && !l.includes('listitem'))!;
  assert.ok(seen.includes(await read('d')), `실행에서 읽은 버튼 텍스트(${await read('d')})가 탐색 snapshot(${seen})과 같아야 한다`);
  assert.match(snap, /Textiles/, '모델이 보는 YAML snapshot도 같은 텍스트');
});

test('그룹 안 순서: 고유한 라벨 옆의 이름 없는 아이콘 버튼과 숫자 값을 고정하고, 값이 바뀌어도 같은 요소를 찾는다', async () => {
  const qty = `<div><div>Quantity</div><div><button disabled><svg width="9" height="9"></svg></button><span>1</span>
    <button onclick="const s=this.previousElementSibling; s.textContent=+s.textContent+1; this.parentElement.firstElementChild.disabled=false">
    <svg width="9" height="9"></svg></button></div></div><p>Price $120</p>`;
  const p = await page(qty);
  const snap = await snapshot(p);
  const plus = refs(snap, '- button [ref=').at(-1)!;
  const r = await resolveRef(p, plus);
  assert.ok(r.ok, JSON.stringify(r) + '\n' + snap);
  assert.deepEqual(r.target, { role: 'button', anchor: '^Quantity$', nth: 1, of: 2 });
  // ref 없는 숫자 텍스트는 담은 요소의 ref와 text로 고정한다.
  const value = await resolveText(p, refs(snap, '- generic [ref=').at(-1)!, '1');
  assert.ok(value.ok && value.target.anchor === '^Quantity$', JSON.stringify(value) + '\n' + snap);
  await toLocator(p, r.target).click();
  assert.equal(await toLocator(p, value.target).textContent(), '2', '값이 바뀌어도 같은 칸을 읽는다');
  assert.equal(await shapeChanged(p, r.target), false);
  await p.evaluate(() => document.querySelector('button')!.remove());
  assert.equal(await shapeChanged(p, r.target), true, '그룹 모양이 바뀌면 순서가 다른 요소를 가리킬 수 있다');

  // 숫자가 블록 요소(자기 ref가 있는 값)여도 같은 방식으로 고정한다.
  const block = await page(qty.replace('<span>1</span>', '<div>1</div>'));
  const bs = await snapshot(block);
  const bv = await resolveRef(block, refOf(bs, ': "1"'));
  assert.ok(bv.ok && bv.target.anchor === '^Quantity$', JSON.stringify(bv) + '\n' + bs);

  // 같은 라벨이 둘이면 기준점이 될 수 없다.
  const twice = await page(qty + qty);
  const s2 = await snapshot(twice);
  const again = await resolveRef(twice, refs(s2, '- button [ref=').at(-1)!);
  assert.deepEqual([again.ok, !again.ok && again.reason], [false, 'unnamed']);
});

test('그룹 안 순서: 실행 때 라벨이 중복되면 모양 변화로 보고, 숫자 칸이 숫자가 아니게 돼도 같은 칸을 읽는다', async () => {
  const p = await page(`<div><div>수량</div><div><button><svg width="9" height="9"></svg></button><span id="q">1</span><button><svg width="9" height="9"></svg></button></div></div>`);
  const snap = await snapshot(p);
  const value = await resolveText(p, refs(snap, '- generic [ref=').at(-1)!, '1');
  assert.ok(value.ok, JSON.stringify(value) + '\n' + snap);
  await p.evaluate(() => { document.getElementById('q')!.textContent = 'NaN'; });
  assert.equal(await toLocator(p, value.target).textContent(), 'NaN', '값이 깨져도 읽어서 불일치로 비교할 수 있어야 한다');
  assert.equal(await shapeChanged(p, value.target), false);
  await p.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div><div>수량</div><div><span>9</span></div></div>'));
  assert.equal(await shapeChanged(p, value.target), true, '같은 라벨 영역이 하나 더 생기면 어느 영역인지 모른다');
});

test('그룹 고정: 목록 컨테이너를 고르면 그 안의 항목들을 그룹으로 본다', async () => {
  const p = await page('<h1>상품</h1><ul><li>a</li><li>b</li><li>c</li></ul>');
  const snap = await snapshot(p);
  const r = await resolveGroup(p, refOf(snap, '- list'));
  assert.ok(r.ok, JSON.stringify(r) + '\n' + snap);
  assert.equal(await toLocator(p, r.target).count(), 3);
});

test('ariaText: 이름 있는 요소는 이름과 안의 내용을 함께 읽고, 내용이 이름과 같으면 이름만 읽는다', async () => {
  const p = await page([
    '<section id=faq aria-label="배송비는 얼마인가요?"><p>$500 미만은 $25입니다.</p></section>',
    '<a id=w href="/wishlist" aria-label="위시리스트"><svg width="9" height="9"></svg><span>1</span></a>',
    '<h2 id=h>상품 상세</h2>',
    '<button id=b>담기</button>',
  ].join(''));
  const read = async (id: string) => ariaText(await p.locator('#' + id).ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]);
  assert.equal(await read('faq'), '배송비는 얼마인가요? $500 미만은 $25입니다.', '내용을 담은 영역은 이름만 읽으면 실제 값을 놓친다');
  assert.equal(await read('w'), '위시리스트 1', '링크 안의 배지 숫자도 읽는다');
  assert.equal(await read('h'), '상품 상세');
  assert.equal(await read('b'), '담기');
  // 예전 계획(읽기 규칙 버전 없음)은 예전 규칙으로 읽어 기대값을 바꾸지 않는다.
  assert.equal(ariaTextV1(await p.locator('#w').ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]), '위시리스트');
});

test('ariaText: 이름 있는 요소에도 CSS 대소문자 변환·숨긴 텍스트가 섞이지 않고, 이름 없는 요소의 text와 자식을 함께 읽는다', async () => {
  const p = await page([
    '<a id=l href="/x" aria-label="Shop" style="text-transform:uppercase">Shop<span hidden> secret</span> <b>3</b></a>',
    '<section id=s aria-label="FAQ"><p>Shipping <a href="/x">25 dollars</a></p></section>',
  ].join(''));
  const read = async (id: string) => ariaText(await p.locator('#' + id).ariaSnapshotJSON({ mode: 'ai' }) as AriaNode[]);
  assert.equal(await read('l'), 'Shop 3');
  assert.equal(await read('s'), 'FAQ Shipping 25 dollars');
});

test('품질·사용성 점검: 이름 없는 조작 요소·가려진 버튼·가로 넘침을 찾고, 꾸민 체크박스와 클릭이 통과하는 장식은 빼며, 모달이 열려 있으면 가림을 보지 않는다', async () => {
  const html = (await import('node:fs')).readFileSync(new URL('./fixtures/audit.html', import.meta.url), 'utf8');
  const p = await page(html);
  await p.setViewportSize({ width: 1280, height: 720 });
  const desktop = await auditPage(p, 'desktop');
  assert.deepEqual(desktop.map(f => [f.kind, f.level, f.detail]), [
    ['unnamed-control', 'improvement', 'button'],
    ['covered-control', 'ui_defect', 'button "구매하기" 를 div "" 가 가림'],
  ], '장식 위 버튼(pointer-events:none)과 꾸민 체크박스(투명 input, 라벨 클릭)는 가림이 아니다. 데스크톱에서는 넘치지 않는다');
  await p.setViewportSize(MOBILE);
  // 데스크톱에서 이미 센 이름 없는 역할(button)은 모바일에서 다시 세지 않는다.
  const mobile = await auditPage(p, 'mobile', new Set(['button']));
  assert.deepEqual(mobile.map(f => f.kind), ['covered-control', 'horizontal-overflow'], '모바일에서는 넓은 요소가 넘친다(이름 없음은 데스크톱에서만 센다)');
  assert.match(mobile[1].detail, /^페이지 폭 \d+px > 화면 390px, 가장 넓게 나간 요소 div/);
  assert.ok(!(await auditPage(p, 'mobile', new Set(['button']))).some(f => f.detail.includes('슬라이드 2')), '잘려 숨은 캐러셀 슬라이드는 가림이 아니다');
  // 열린 모달: 뒤의 가림은 정상이라 보지 않지만, 모달 안의 닫기 버튼이 가려진 것은 찾는다. 숨은 모달은 점검을 끄지 않는다.
  await p.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true" style="display:none"><button>숨은 모달</button></div>'));
  assert.ok((await auditPage(p, 'mobile', new Set(['button']))).some(f => f.detail.startsWith('button "구매하기"')), '숨은 모달은 가림 점검을 끄지 않는다');
  await p.evaluate(() => document.body.insertAdjacentHTML('beforeend',
    '<div role="dialog" aria-modal="true" style="position:fixed;top:10px;left:10px;width:200px;height:60px;background:#fff"><button>닫기</button><div style="position:absolute;inset:0;background:rgba(0,0,0,.1)"></div></div>'));
  const withModal = (await auditPage(p, 'mobile', new Set(['button']))).filter(f => f.kind === 'covered-control');
  assert.deepEqual(withModal.map(f => f.target), ['button "닫기"'], '모달 안만 보고, 모달의 가려진 닫기 버튼은 찾는다');
  await p.close();
});

test('품질·사용성 점검: ARIA 없는 모달의 보이는 배경 덮개 아래는 가림이 아니고, 투명한 전체 덮개와 모달 안의 가림은 찾는다', async () => {
  const base = '<button style="margin:40px">계속 읽기</button>';
  const modal = '<div style="position:fixed;inset:0;background:rgba(20,20,20,.6)"></div>'
    + '<div style="position:fixed;top:30%;left:20%;width:60%;padding:20px;background:#fff"><p>쿠폰 안내</p><button>창 닫기</button><span style="position:absolute;left:0;bottom:0;width:100%;height:60px"></span></div>';
  const covered = async (html: string) => {
    const p = await page(html);
    const f = (await auditPage(p, 'desktop')).filter(x => x.kind === 'covered-control').map(x => x.target);
    await p.close();
    return f;
  };
  assert.deepEqual(await covered(base + modal), ['button "창 닫기"'], '배경 아래 버튼은 빼고, 모달 안에서 가려진 닫기 버튼은 찾는다');
  assert.deepEqual(await covered(base + '<div style="position:fixed;inset:0"></div>'), ['button "계속 읽기"'], '투명한 전체 덮개는 조작을 막는 결함일 수 있다');
  assert.deepEqual(await covered(base + '<div style="position:fixed;inset:0;background:rgba(0,0,0,.4)"></div>'), ['button "계속 읽기"'], '창 없이 남은 반투명 덮개도 결함일 수 있다');
  // z-index가 틀려 모달 창(닫기 버튼 포함)이 덮개 아래에 깔리면 닫기 버튼을 누를 수 없다.
  assert.ok((await covered(base + '<div style="position:fixed;top:30%;left:20%;width:60%;padding:20px;background:#fff;z-index:1"><p>안내</p><button>창 닫기</button></div><div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2"><p style="position:absolute;top:0;left:0;margin:0;background:#fff">공지</p></div>')).includes('button "창 닫기"'), '모달 창의 버튼은 덮개 아래에 깔려도 결함이다');
  // 창이 덮개 안에 있는 모양도 모달이다.
  assert.deepEqual(await covered(base + '<div style="position:fixed;inset:0;background:rgba(0,0,0,.5)"><div style="margin:20% auto;width:50%;background:#fff"><p>공지</p><button>확인</button></div></div>'), [], '덮개 안의 창: 뒤의 버튼은 가림이 아니다');
});

test('pressKey: 이동 단축키만 goBack·goForward로, 상속 속성 이름·일반 키는 키 입력으로 보낸다', async () => {
  const log: string[] = [];
  const page = { keyboard: { press: async (k: string) => { log.push(`key ${k}`); } },
    goBack: async () => { log.push('back'); return null; }, goForward: async () => { log.push('forward'); return null; } } as never;
  for (const k of ['Alt+ArrowLeft', 'Meta+]', 'Enter', 'constructor', 'toString', '__proto__']) await pressKey(page, k, 1000);
  assert.deepEqual(log, ['back', 'forward', 'key Enter', 'key constructor', 'key toString', 'key __proto__']);
});
