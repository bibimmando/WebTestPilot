import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { login, readAppConfig, type LoginSpec } from '../src/login.ts';
import { openContext } from '../src/browser.ts';
import { runPlan } from '../src/run.ts';
import type { Plan } from '../src/plan.ts';

// 작은 로그인 앱: 폼 로그인 → 세션 쿠키, /account는 로그인 필요, /logout은 서버 세션을 끊는다.
const SECRET = 'pw-7f3a9c';
let server: Server | undefined;
let origin = '';
let browser: Browser | undefined;
const sessions = new Set<string>();
before(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const sid = /sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        if (f.get('user') === 'tester' && f.get('pass') === SECRET) {
          const id = `s${sessions.size + 1}`;
          sessions.add(id);
          res.writeHead(302, { 'set-cookie': `sid=${id}; Path=/; HttpOnly`, location: '/account' });
        } else res.writeHead(302, { location: '/login?error=1' });
        res.end();
      });
      return;
    }
    if (url.pathname === '/login') return res.end(`<h1>로그인</h1>${url.searchParams.get('error') ? '<p>아이디나 비밀번호가 틀립니다</p>' : ''}
      <form method="post"><label>아이디 <input name="user"></label><label>비밀번호 <input name="pass" type="password"></label><button>로그인</button></form>`);
    if (url.pathname === '/go') { res.writeHead(302, { location: '/logout' }); return res.end(); }
    // 쿠키·저장소에 남기지 않는 로그인(메모리 상태만): 저장한 상태로 다시 열면 풀린다.
    if (url.pathname === '/memlogin') return res.end(`<h1>로그인</h1><label>아이디 <input></label><label>비밀번호 <input type="password"></label><button onclick="history.pushState(null, '', '/account?mem'); document.body.innerHTML = '<p>환영합니다</p>'">로그인</button>`);
    if (url.pathname === '/logout') { if (sid) sessions.delete(sid); res.writeHead(302, { location: '/login' }); return res.end(); }
    if (url.pathname === '/account') {
      if (!sid || !sessions.has(sid)) { res.writeHead(302, { location: '/login' }); return res.end(); }
      return res.end(`<h1>내 계정</h1><p>환영합니다, tester</p><a href="/logout">로그아웃</a><button onclick="location.href='/go'">나가기</button><label>새 비밀번호 <input type="password" value="typed-by-user"></label>`);
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => { await browser?.close(); server?.close(); });

const spec = (): LoginSpec => ({ url: `${origin}/login`, username: { role: 'textbox', name: '^아이디$' }, password: { role: 'textbox', name: '^비밀번호$' },
  submit: { role: 'button', name: '^로그인$' }, success: { text: '환영합니다', urlIncludes: '/account' }, env: { username: 'QA_TEST_USER', password: 'QA_TEST_PASS' } });
const env = (pass = SECRET) => ({ QA_TEST_USER: 'tester', QA_TEST_PASS: pass });

test('앱 설정: 비밀번호 값을 파일에 쓰면 거부하고, 환경 변수 이름과 성공 조건을 요구한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-app-'));
  const write = (o: unknown) => { const p = join(dir, `${Math.random()}.json`); writeFileSync(p, JSON.stringify(o)); return p; };
  assert.deepEqual(readAppConfig(write({ login: spec(), deny: ['/logout'] })).deny, ['/logout']);
  assert.throws(() => readAppConfig(write({ login: { ...spec(), password: SECRET } })), /비밀번호 값을 파일에 쓰지/);
  assert.throws(() => readAppConfig(write({ login: { ...spec(), success: {} } })), /success/);
  assert.throws(() => readAppConfig(write({ login: { ...spec(), env: undefined } })), /env/);
});

test('로그인: 성공하면 그 브라우저 상태로 로그인 이후 화면을 열고, 실패 사유에는 비밀값이 없다', async () => {
  const policy = { origins: [origin] };
  const ok = await login(browser!, policy, spec(), env());
  assert.ok(ok.ok, JSON.stringify(ok));
  const { context } = await openContext(browser!, policy, undefined, ok.ok ? ok.state : undefined);
  const page = await context.newPage();
  await page.goto(`${origin}/account`);
  assert.ok(await page.getByText('환영합니다').isVisible(), '쓰기를 막은 컨텍스트에서도 로그인 상태로 시작한다');
  await context.close();

  const wrong = await login(browser!, policy, spec(), env('nope-123'));
  assert.equal(wrong.ok, false);
  assert.ok(!wrong.ok && /성공 확인 조건/.test(wrong.reason) && !wrong.reason.includes('nope-123'), JSON.stringify(wrong));
  const missing = await login(browser!, policy, spec(), {});
  assert.deepEqual(missing, { ok: false, reason: '환경 변수 QA_TEST_USER가 비어 있음' });
  assert.match((await login(browser!, { origins: ['http://other.test'] }, spec(), env())).ok ? '' : '허용 origin 밖', /허용 origin 밖/);
});

test('실행: 로그인 상태로 시나리오를 시작하고, 금지 주소(로그아웃)는 요청하지 않아 다음 시나리오도 로그인 상태다. 세션은 실행 폴더에 남지 않는다', async () => {
  const policy = { origins: [origin], deny: ['/logout'] };
  const r = await login(browser!, policy, spec(), env());
  assert.ok(r.ok);
  const before = sessions.size;
  const welcome = { kind: 'requirement' as const, id: 'R1', quote: '환영 문구가 보인다' };
  const p: Plan = { version: 1, textRead: 'name+content', requirements: [{ id: 'R1', text: '로그인한 계정 화면에는 환영 문구가 보인다' }], questions: [], observations: [], unplanned: [], features: [],
    targets: { T1: { target: { role: 'link', name: '^로그아웃$' }, group: false, url: `${origin}/account` }, T2: { target: { text: '환영합니다, tester' }, group: false, url: `${origin}/account` } },
    scenarios: ['S1', 'S2'].map(id => ({ id, title: id, covers: ['R1'], start: { url: `${origin}/account` },
      steps: id === 'S1' ? [{ id: 'S1.A1', op: 'click' as const, target: 'T1' }] : [],
      checks: [{ id: `${id}.C1`, after: id === 'S1' ? 'S1.A1' : 'start', target: 'T2', read: 'visible' as const, op: 'equals' as const, expected: 'true', source: welcome }] })) };
  const runDir = fileURLToPath(new URL(`../runs/test-login-${Date.now()}`, import.meta.url));
  const res = await runPlan({ plan: p, policy, runDir, timeoutMs: 1500, storageState: r.ok ? r.state : undefined });
  // 로그아웃 링크는 누르기 전에 거절하고(실행 안 함), 다음 시나리오는 그대로 로그인 상태다.
  assert.deepEqual([res.scenarios[0].steps[0].status, res.scenarios[0].steps[0].reason], ['not_executed', 'denied_by_app_config']);
  assert.equal(res.scenarios[1].checks[0].status, 'passed', JSON.stringify(res.scenarios[1]));
  assert.equal(sessions.size, before);
  assert.equal(JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8')).loggedIn, true);
  // 세션 값은 실행 폴더의 기록 파일(trace 같은 원본 증거 제외)에 들어가지 않는다.
  const sid = r.ok ? r.state.cookies.find(c => c.name === 'sid')!.value : '';
  for (const f of readdirSync(runDir).filter(f => statSync(join(runDir, f)).isFile())) assert.ok(!readFileSync(join(runDir, f), 'utf8').includes(`sid=${sid}`) && !readFileSync(join(runDir, f), 'utf8').includes(`"value": "${sid}"`), f);
});

test('로그인: 쿠키·저장소에 남지 않는 로그인은 저장한 상태로 다시 열어 확인해 실패로 둔다', async () => {
  const r = await login(browser!, { origins: [origin] }, { ...spec(), url: `${origin}/memlogin`, username: { role: 'textbox', name: '^아이디$' } }, env());
  assert.ok(!r.ok && /저장한 로그인 상태로 다시 열면/.test(r.reason), JSON.stringify(r));
});

test('금지 주소: 리다이렉트로 가도 막고, 스크립트 이동이 막힌 단계 뒤의 실패는 결함이 아니라 정책 결과다. 재현의 로그인 조건이 다르면 판단 불가', async () => {
  const { preclassify, judge } = await import('../src/triage.ts');
  const { childEnv } = await import('../src/run.ts');
  const { Budget } = await import('../src/agent.ts');
  const policy = { origins: [origin], deny: ['/logout'] };
  const r = await login(browser!, policy, spec(), env());
  assert.ok(r.ok);
  const before = sessions.size;
  // 리다이렉트: 허용된 /go가 /logout으로 보내도 서버에 닿지 않는다.
  const g = await openContext(browser!, policy, undefined, r.ok ? r.state : undefined);
  const page = await g.context.newPage();
  await page.goto(`${origin}/go`).catch(() => {});
  assert.ok(g.blocked.some(b => b.startsWith('DENY redirect')), JSON.stringify(g.blocked));
  await g.context.close();
  // 스크립트 이동(버튼): 행동은 끝났지만 이동이 막혔다. 뒤 검사의 실패는 정책 결과로 분류한다.
  const p: Plan = { version: 1, textRead: 'name+content', requirements: [{ id: 'R1', text: '로그인한 계정 화면에는 환영 문구가 보인다' }], questions: [], observations: [], unplanned: [], features: [],
    targets: { T1: { target: { role: 'button', name: '^나가기$' }, group: false, url: `${origin}/account` }, T2: { target: { text: '환영합니다, tester' }, group: false, url: `${origin}/account` } },
    scenarios: [{ id: 'S1', title: '나가기', covers: ['R1'], start: { url: `${origin}/account` }, steps: [{ id: 'S1.A1', op: 'click', target: 'T1' }],
      checks: [{ id: 'S1.C1', after: 'S1.A1', target: 'T2', read: 'visible', op: 'equals', expected: 'true', source: { kind: 'requirement', id: 'R1', quote: '환영 문구가 보인다' } }] }] };
  const out = fileURLToPath(new URL(`../runs/test-deny-${Date.now()}`, import.meta.url));
  const run = await runPlan({ plan: p, policy, runDir: join(out, 'run'), timeoutMs: 1500, storageState: r.ok ? r.state : undefined });
  assert.ok(run.scenarios[0].denied?.length, JSON.stringify(run.scenarios[0]));
  assert.deepEqual(preclassify(p, run).map(v => [v.id, v.class]), [['S1.A1', 'policy_blocked'], ['S1.C1', 'policy_blocked']]);
  assert.equal(sessions.size, before, '세션이 끊기지 않았다');
  // 로그인 상태 없이 재현하면 최초와 조건이 달라 판단 불가다(유료 API는 부르지 않는다).
  const j = await judge({ plan: p, run, send: async () => { throw new Error('호출 안 함'); }, model: 'claude-sonnet-5-5', budget: new Budget(1), reproduceDir: join(out, 'repro') });
  assert.match(j.verdicts.find(v => v.id === 'S1.C1')?.reproductionDetail ?? '', /로그인 상태가 최초와 다름/);
  // 계정 비밀값 환경 변수는 이름 규칙에 걸리지 않아도 앱 설정으로 빼고, PASS·SESSION 같은 이름도 넘기지 않는다.
  process.env.QA_TEST_PASS_X = 'x'; process.env.MY_ACCOUNT_SECRETISH = 'y'; process.env.APP_LOGIN_VALUE = 'z';
  const e = childEnv(['APP_LOGIN_VALUE']);
  assert.deepEqual([e.QA_TEST_PASS_X, e.MY_ACCOUNT_SECRETISH, e.APP_LOGIN_VALUE], [undefined, undefined, undefined]);
  delete process.env.QA_TEST_PASS_X; delete process.env.MY_ACCOUNT_SECRETISH; delete process.env.APP_LOGIN_VALUE;
});
