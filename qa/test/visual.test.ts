import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { runPlan } from '../src/run.ts';
import { judge } from '../src/triage.ts';
import { buildReport, renderHtml } from '../src/report.ts';
import { writeFileSync } from 'node:fs';
import { Budget, IMAGE_TOKENS, PRICES } from '../src/agent.ts';
import { validate, criteriaOf, type Plan, type Pinned } from '../src/plan.ts';
import { checkAssessment, decide, judgeVisual, replayResult } from '../src/visual.ts';
import type { RunResult } from '../src/run.ts';
import type { Verdict } from '../src/triage.ts';
import { mkdirSync } from 'node:fs';

let server: Server | undefined;
let origin = '';
before(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    try { res.end(await readFile(new URL(`./fixtures${new URL(req.url!, 'http://x').pathname}`, import.meta.url))); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server?.close(); });

const rule = { kind: 'inferred' as const, rule: 'content-readable', quote: '고정 머리말 아래의 첫 제목이 읽혀야 한다' };

test('시각 판정 결정: 하나라도 판단 불가면 증거 부족, 위반이 있으면 후보, 모두 충족일 때만 통과. 번호 누락·근거 없는 답은 받지 않는다', () => {
  const a = (...s: ('met' | 'unmet' | 'unknown')[]) => ({ criteria: s.map((status, i) => ({ n: i + 1, status, evidence: '제목 위에 검은 머리말이 겹쳐 있음' })), blocks_use: true, summary: '' });
  assert.equal(decide(a('met', 'met')).class, 'passed_visual');
  assert.equal(decide(a('met', 'unknown')).class, 'uncertain', '일부만 확인하고 통과시키지 않는다');
  assert.equal(decide(a('unmet', 'unknown')).class, 'app_defect_candidate');
  assert.deepEqual(checkAssessment(a('met'), 2), ['조건 1~2을 한 번씩 답해야 함 (받은 번호: 1)']);
  assert.match(checkAssessment({ criteria: [{ n: 1, status: 'unmet', evidence: '없음' }], blocks_use: false, summary: '' }, 1)[0], /근거/);
  assert.deepEqual(checkAssessment({ criteria: [{ n: 1, status: 'unknown', evidence: '' }], blocks_use: false, summary: '' }, 1), [], 'unknown은 근거 없이 받는다');
  assert.deepEqual(criteriaOf('1. 제목이 보인다\n2) 메뉴가 가리지 않는다'), ['제목이 보인다', '메뉴가 가리지 않는다']);
  assert.deepEqual(criteriaOf('제목이 보인다'), ['제목이 보인다']);
  assert.equal(criteriaOf('1. 제목이 보인다\n2. 메뉴가 가리지 않는다\n버튼을 누를 수 있다'), undefined, '번호 없는 줄을 조용히 버리지 않는다');
  assert.equal(criteriaOf('1. 제목이 보인다\n3. 메뉴가 가리지 않는다'), undefined, '건너뛴 번호를 다시 매기지 않는다');
  assert.equal(criteriaOf('제목이 보인다\n메뉴가 가리지 않는다'), undefined, '여러 줄이면 번호가 필요하다');
});

test('시각 재현 결과: 위반 조건이 모두 다시 보여야 재현됨, 모두 사라져야 재현 안 됨, 섞이면 판단 불가', () => {
  const r = (...s: ('yes' | 'no' | 'unknown')[]) => replayResult({ criteria: s.map((same, i) => ({ n: i + 1, same, evidence: '재현 화면에서 본 것' })) }).reproduction;
  assert.deepEqual([r('yes', 'yes'), r('no', 'no'), r('yes', 'no'), r('yes', 'unknown')], ['reproduced', 'flaky', 'reproduction_inconclusive', 'reproduction_inconclusive']);
});

test('시각 판정: 화면이 멈추기 전 촬영은 모델을 부르지 않고 증거 부족으로 둔다', async () => {
  const runDir = fileURLToPath(new URL(`../runs/test-visual-unready-${Date.now()}`, import.meta.url));
  mkdirSync(join(runDir, 'evidence'), { recursive: true });
  writeFileSync(join(runDir, 'evidence', 'S1.C1.visual.png'), 'x');
  const run = { runDir, scenarios: [{ id: 'S1', checks: [{ id: 'S1.C1', status: 'visual_pending', visual: { viewport: null, scroll: { x: 0, y: 0 }, box: null, image: 'evidence/S1.C1.visual.png', ready: false } }] }] } as unknown as RunResult;
  const v = { id: 'S1.C1', scenario: 'S1', kind: 'check', requirements: [], observed: 'visual_pending', class: 'needs_visual' } as Verdict;
  let calls = 0;
  await judgeVisual({ plan: overlapPlan(), run, verdicts: [v], send: async () => { calls++; throw new Error('부르면 안 됨'); }, model: 'claude-sonnet-5-5', budget: new Budget(1), logDir: 'triage' });
  assert.deepEqual([v.class, calls], ['uncertain', 0]);
  assert.match(JSON.stringify(v.triage), /멈추지 않은/);
});

test('시각 검사 계약: 번호 조건 필요, 관찰값 근거·관측 참조·선행조건 불가, 시각 규칙과 visual 읽기는 짝', () => {
  const pinned = new Map<string, Pinned>([['T1', { target: { role: 'heading', name: '^공지 제목$' }, group: false, url: 'http://a.test/' }]]);
  const draft = (check: Record<string, unknown>) => ({ features: [{ id: 'F1', name: '공지', page: 'http://a.test/' }], unplanned: [],
    scenarios: [{ id: 'S1', title: '제목', covers: ['F1'], start: { url: 'http://a.test/' }, steps: [],
      checks: [{ id: 'S1.C1', after: 'start', read: 'visual', op: 'satisfies', target: 'T1', expected: '1. 제목 글자가 모두 보인다', source: rule, ...check }] }] });
  const errs = (check: Record<string, unknown>) => validate(draft(check) as never, [], pinned, ['http://a.test']);
  assert.deepEqual(errs({}), []);
  assert.deepEqual(errs({ target: undefined }), [], '대상이 없으면 화면 전체');
  assert.match(errs({ expected: ' ' }).join(), /visual expects 1-6 criteria/);
  assert.match(errs({ expected: '1. 제목이 보인다\n버튼을 누를 수 있다' }).join(), /number every line/);
  assert.match(errs({ expected: Array.from({ length: 7 }, (_, i) => `${i + 1}. 조건`).join('\n') }).join(), /visual expects 1-6 criteria/);
  assert.match(errs({ op: 'equals' }).join(), /read visual allows op satisfies/);
  assert.match(errs({ precondition: true }).join(), /cannot be a precondition/);
  assert.match(errs({ expected: undefined, expected_from: 'S1.C1' }).join(), /not expected_from/);
  assert.match(errs({ source: { kind: 'inferred', rule: 'link-target', quote: '규칙이 적용되는 이유를 적는다' } }).join(), /needs a visual rule/);
  assert.match(errs({ read: 'text', op: 'satisfies' }).join(), /read text allows op/);
  assert.match(validate({ ...draft({}), scenarios: [{ ...draft({}).scenarios[0], checks: [{ ...draft({}).scenarios[0].checks[0], read: 'visible', op: 'equals', expected: 'true' }] }] } as never, [], pinned, ['http://a.test']).join(),
    /rule content-readable is judged from a screenshot/);
});

test('비용 예약: 이미지는 base64 길이가 아니라 장당 상한으로 센다', () => {
  const b = new Budget(10);
  const req = (data: string) => ({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user' as const, content: [
    { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data } }] }] });
  const small = b.reserve(req('x'));
  const big = b.reserve(req('x'.repeat(2_000_000)));
  assert.equal(small, big, '이미지 크기와 상관없이 같은 상한');
  assert.ok(small >= IMAGE_TOKENS * 1.25 * PRICES['claude-sonnet-5-5'].input / 1e6);
});

/** 가짜 시각 판정 모델: 첫 답은 조건 번호를 빠뜨려 거절되고, 다시 위반으로 답한다. 재현 비교에는 replay로 답한다. */
function fakeVisual(o: { verdict: 'unmet' | 'met' | 'unknown'; replay: 'yes' | 'no' }) {
  const seen: { tool: string; images: number }[] = [];
  const send = async (req: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> => {
    const tool = req.tools![0] as Anthropic.Tool;
    const user = req.messages[0].content as Anthropic.ContentBlockParam[];
    seen.push({ tool: tool.name, images: user.filter(b => b.type === 'image').length });
    const input = tool.name === 'replay_assessment' ? { criteria: [{ n: 1, same: o.replay, evidence: '재현 화면에서도 제목 윗부분이 머리말에 덮여 있음' }] }
      : req.messages.length === 1 ? { criteria: [], blocks_use: true, summary: '번호 누락' }
      : { criteria: [{ n: 1, status: o.verdict, evidence: '제목 윗부분이 검은 머리말 띠에 덮여 글자 일부가 안 보임' }], blocks_use: true, summary: '고정 머리말이 제목을 덮음' };
    return { id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: `tu${seen.length}`, name: tool.name, input }],
      usage: { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as unknown as Anthropic.Message;
  };
  return Object.assign(send, { seen });
}

const overlapPlan = (): Plan => ({
  version: 1, textRead: 'name+content', requirements: [], observations: [], questions: [], unplanned: [],
  features: [{ id: 'F1', name: '공지 보기', page: `${origin}/overlap.html` }],
  targets: { T1: { target: { role: 'heading', name: '^공지 제목$' }, group: false, url: `${origin}/overlap.html` } },
  scenarios: [{ id: 'S1', title: '공지 제목', covers: ['F1'], start: { url: `${origin}/overlap.html` }, steps: [],
    checks: [{ id: 'S1.C1', after: 'start', target: 'T1', read: 'visual', op: 'satisfies', expected: '1. 제목 글자 전체가 다른 요소에 가려지지 않고 보인다', source: rule }] }],
});

for (const c of [
  { verdict: 'unmet' as const, replay: 'yes' as const, level: 'ui_defect', reproduction: 'reproduced' },
  { verdict: 'unmet' as const, replay: 'no' as const, level: 'hold', reproduction: 'flaky' },
  { verdict: 'met' as const, replay: 'yes' as const, level: 'not_bug', reproduction: undefined },
  { verdict: 'unknown' as const, replay: 'yes' as const, level: 'incomplete', reproduction: undefined },
]) test(`시각 판정 끝까지: ${c.verdict}${c.verdict === 'unmet' ? `, 재현 ${c.replay}` : ''} → ${c.level}`, async () => {
  // cli와 같은 폴더 모양: 실행 결과(plan.json)와 run/·repro/
  const out = fileURLToPath(new URL(`../runs/test-visual-${c.verdict}-${c.replay}-${Date.now()}`, import.meta.url));
  const runDir = join(out, 'run');
  const run = await runPlan({ plan: overlapPlan(), policy: { origins: [origin] }, runDir, timeoutMs: 1500 });
  const r = run.scenarios[0].checks[0];
  assert.equal(r.status, 'visual_pending', JSON.stringify(r));
  assert.ok(r.visual && existsSync(join(runDir, r.visual.image)) && r.visual.box, '촬영 이미지와 대상 위치를 남긴다');
  const send = fakeVisual(c);
  const j = await judge({ plan: overlapPlan(), run, send, model: 'claude-sonnet-5-5', budget: new Budget(5), reproduceDir: join(out, 'repro') });
  const v = j.verdicts.find(x => x.id === 'S1.C1')!;
  assert.equal(v.system?.level, c.level, JSON.stringify(v));
  assert.equal(v.reproduction, c.reproduction);
  assert.equal(v.visual?.assessment?.criteria.length, 1, '모델 응답 원문을 남긴다');
  assert.deepEqual(send.seen.slice(0, 2), [{ tool: 'visual_assessment', images: 1 }, { tool: 'visual_assessment', images: 1 }], '번호가 빠진 답은 거절하고 다시 받는다');
  if (c.verdict === 'unmet') assert.deepEqual(send.seen[2], { tool: 'replay_assessment', images: 2 }, '재현은 최초·재현 이미지 두 장을 함께 본다');
  else assert.equal(send.seen.length, 2, '후보가 아니면 재현하지 않는다');
  if (c.level !== 'ui_defect') return;
  writeFileSync(join(out, 'plan.json'), JSON.stringify(overlapPlan()));
  const rep = buildReport(out);
  assert.deepEqual([rep.visual.map(x => [x.id, x.level]), rep.bugs.length], [[['S1.C1', 'ui_defect']], 0], '시각 위반은 버그와 따로 센다');
  assert.deepEqual(rep.visual[0].visual?.criteria.map(x => x.status), ['unmet']);
  assert.ok(rep.visual[0].reproduction?.evidence?.includes('repro/evidence/S1.C1.visual.png'), '재현 이미지를 연결한다');
  const html = renderHtml(rep, out);
  assert.ok(html.includes('시각 판정 (1)') && html.includes('조작을 막음: 예') && html.includes('data:image/png;base64,'));
});
