import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildReport, renderHtml, writeReport } from '../src/report.ts';
import type { Plan } from '../src/plan.ts';

const browser = await chromium.launch();
const url = 'http://app.test/list';
after(() => browser.close());

/** 저장된 실행 결과 폴더(cli가 쓰는 모양)를 만든다. 페이지 문구에 HTML이 섞여 있다. */
function savedRun(): string {
  const dir = fileURLToPath(new URL(`../runs/test-report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, import.meta.url));
  mkdirSync(join(dir, 'run', 'evidence'), { recursive: true });
  const url = 'http://app.test/list';
  const plan: Plan = {
    version: 1, requirements: [], unplanned: [], questions: [{ id: 'Q1', page: url, question: '쿠폰은 중복되나요?', options: ['예', '아니요'], feature: 'F1' }],
    features: [{ id: 'F1', name: '담기', page: url }], observations: [{ page: url, note: '<b>배지</b>가 늦게 바뀜' }],
    targets: {
      T1: { target: { role: 'button', anchor: '^Orb Lamp$', of: 1 }, group: false, url },
      T2: { target: { role: 'listitem', within: { role: 'list', name: '^담은 상품$' } }, group: true, url },
    },
    scenarios: ['S1', 'S2'].map(id => ({ id, title: id === 'S1' ? '<script>alert(1)</script> 담기' : '두 번째', covers: ['F1'], start: { url },
      steps: [{ id: `${id}.A1`, op: 'click' as const, target: 'T1' }],
      checks: [{ id: `${id}.C1`, after: `${id}.A1`, target: 'T2', read: 'count' as const, op: 'equals' as const, expected: '1',
        source: { kind: 'inferred' as const, rule: 'action-has-effect', quote: '담기를 누르면 목록이 늘어난다' } }] })),
  };
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir, 'run', 'policy.json'), JSON.stringify({ origins: ['http://app.test'] }));
  writeFileSync(join(dir, 'run', 'results.json'), JSON.stringify({ problems: [], requirements: [], scenarios: ['S1', 'S2'].map(id => ({
    id, valid: true, invalid: [], start: 'ok', precondition: 'none', blocked: [], violations: [],
    steps: [{ id: `${id}.A1`, status: 'ok', evidence: [`evidence/${id}.A1.after.png`], ...(id === 'S1' ? { captureErrors: ['screenshot: 시간 초과'] } : {}) }],
    checks: [{ id: `${id}.C1`, status: id === 'S1' ? 'mismatch' : 'not_run', source: 'inferred', expected: '1', actual: '0', evidence: [`evidence/${id}.C1.png`] }], ...(id === 'S1' ? { signalsDropped: 3 } : {}) })) }));
  const system = { requirement: {}, autonomous: { bug_medium: 1, incomplete: 1 }, preparation: {}, variant: {} };
  writeFileSync(join(dir, 'run', 'verdicts.json'), JSON.stringify({ file: 'verdicts.json', stage: 'done', requirements: [], system, variants: [], features: [],
    pendingQuestions: plan.questions,
    errorSignals: [{ kind: 'http', text: 'GET 500', path: 'http://app.test/api', status: 500, at: [{ scenario: 'S1', after: 'S1.A1' }] },
      { kind: 'http', text: 'GET 403', path: 'http://app.test/admin', status: 403, normal: true, at: [{ scenario: 'S1', after: 'S1.A1' }] }],
    verdicts: [
      { id: 'S1.C1', scenario: 'S1', kind: 'check', requirements: [], observed: 'mismatch', class: 'app_defect_candidate', triage: { reason: '목록이 늘지 않음', quotes: [] },
        reproduction: 'reproduced', system: { level: 'bug_medium', reason: '일반 규칙 위반, 재현됨' } },
      { id: 'S2.C1', scenario: 'S2', kind: 'check', requirements: [], observed: 'not_run', class: 'not_run', cause: 'S2.A1', system: { level: 'incomplete', reason: '실행 안 됨(원인 S2.A1)' } },
      { id: 'S2.A1', scenario: 'S2', kind: 'act', requirements: [], observed: 'not_executed:target_changed:0', class: 'automation_failure', triage: { reason: '대상을 잘못 찾음', quotes: [] }, captureErrors: ['aria: 페이지 닫힘'],
        system: { level: 'not_bug', reason: '자동화 실패로 분류(원래 결과는 보존)' } },
    ] }));
  // 중간에 멈춘 재판정 파일. 끝난 판정(verdicts.json)을 가리면 안 된다.
  writeFileSync(join(dir, 'run', 'verdicts-2.json'), JSON.stringify({ stage: 'preclassified', verdicts: [], system: {}, requirements: [] }));
  // 기록 중에 멈춰 깨진 재판정 파일. 보고서 생성을 막지 않는다.
  writeFileSync(join(dir, 'run', 'verdicts-3.json'), '{"stage": "tri');
  writeFileSync(join(dir, 'explore.json'), JSON.stringify({ complete: false, sitemap: { templates: [{ key: url, pages: [url] }, { key: 'http://app.test/cart', pages: ['http://app.test/cart'] }],
    visited: [url], failed: [], unvisited: ['http://app.test/help'],
    audit: [{ url, findings: [{ kind: 'covered-control', viewport: 'mobile', level: 'ui_defect', target: 'button "담기"', detail: 'button "담기" 를 div "" 가 가림', confirmed: true },
      { kind: 'unnamed-control', viewport: 'desktop', level: 'improvement', target: 'button', detail: 'button ("Orb Lamp" 안)', confirmed: false }] }],
    auditErrors: ['http://app.test/cart: 화면 크기를 바꾸지 못함'] },
    conversations: [{ template: url, stop: 'done', planned: true, turns: 9 }, { template: 'http://app.test/cart', stop: 'stalled', planned: false, turns: 12, detail: '화면이 바뀌지 않는 행동 8번 연속' }] }));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ startUrl: url, spentUsd: 1.23456, budgetUsd: 10, timingMs: { total: 125_000 } }));
  // 실패 시점 스크린샷(1x1 PNG)
  writeFileSync(join(dir, 'run', 'evidence', 'S1.C1.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  return dir;
}

test('보고서: 판정을 구역으로 나누고, 사람이 따라 할 절차·근거·증거를 남기며, 미완료와 범위 밖을 숨기지 않는다', async () => {
  const dir = savedRun();
  const r = buildReport(dir);
  assert.deepEqual([r.version, r.run.startUrl, r.run.endReason, r.run.spentUsd], ['report/2', 'http://app.test/list', 'incomplete', 1.2346]);
  assert.deepEqual(r.run.verdicts, { file: 'verdicts.json', stage: 'done', later: [{ file: 'verdicts-3.json', stage: 'unreadable' }, { file: 'verdicts-2.json', stage: 'preclassified' }] },
    '끝난 판정을 쓰고, 그 뒤의 끝나지 않았거나 읽을 수 없는 재판정을 함께 남긴다');
  assert.deepEqual(r.run.incompleteReasons, ['http://app.test/cart: stalled (화면이 바뀌지 않는 행동 8번 연속)'], '계획 못 한 페이지 종류와 사유');
  assert.match(r.run.scope.writes, /차단/);
  assert.deepEqual(r.bugs.map(b => [b.id, b.level, b.basis]), [['S1.C1', 'bug_medium', 'autonomous']]);
  assert.deepEqual(r.bugs[0].steps, ['http://app.test/list 열기', '"Orb Lamp" 영역의 버튼 누르기'], '이름 없는 버튼도 라벨 영역으로, 읽는 말로 적는다');
  assert.deepEqual([r.bugs[0].check!.target, r.bugs[0].check!.expected, r.bugs[0].check!.actual, r.bugs[0].reproduction], ['"담은 상품" 목록 안의 목록 항목', '1', '0', { result: 'reproduced' }]);
  assert.deepEqual(r.bugs[0].evidence, ['run/evidence/S1.C1.png']);
  assert.deepEqual(r.evidenceGaps, { total: 1, items: ['S1.A1: screenshot: 시간 초과'] }, '통과한 행동의 증거 수집 실패도 센다');
  assert.deepEqual(r.incomplete.byReason, { '실행 안 됨(앞 항목에서 멈춤)': 1, '자동화 실패로 분류(원래 결과 보존)': 1 }, '사유는 항목 ID 없이 종류로 세고, 자동화 실패도 미완료 구역에 보인다');
  assert.deepEqual(r.passed, { checks: 0, byClass: {} }, '통과는 실제 통과한 검사만 센다(자동화 실패는 통과가 아니다)');
  assert.deepEqual([r.errorSignals.map(g => g.status), r.normalRejections], [[500, 403], 1], '정상 거절일 수 있는 신호도 지우지 않고 표시만 한다');
  assert.deepEqual([r.uiDefects.map(a => [a.kind, a.viewport]), r.improvements, r.auditUnconfirmed.map(a => a.kind), r.auditErrors],
    [[['covered-control', 'mobile']], [], ['unnamed-control'], ['http://app.test/cart: 화면 크기를 바꾸지 못함']],
    '확인된 점검 발견만 UI 결함·개선 제안으로 세고, 확인하지 못한 것과 점검 실패는 따로 남긴다');
  assert.deepEqual(r.coverage.templates.find(t => t.template === url)!.executedPages, [url]);
  assert.deepEqual([r.questions.map(q => q.id), r.observations.length, r.coverage.unvisitedLinks], [['Q1'], 1, ['http://app.test/help']]);

  const html = renderHtml(r, dir);
  assert.ok(html.includes('UI 결함 (1) · 개선 제안 (0)') && html.includes('확인하지 못한 점검 발견 (1)') && html.includes('정상 거절일 수 있음'));
  assert.ok(html.includes('<td>S2.A1</td>') && html.includes('대상을 잘못 찾음'), '미완료 구역에 항목·원래 결과·분류 근거를 보인다');
  assert.ok(html.includes('수집 실패: aria: 페이지 닫힘'), '미완료 항목 표에도 증거 수집 실패를 보인다');
  assert.ok(html.includes('not_executed:target_changed:0'), '부록의 판정 못 한 항목에 원래 결과를 남긴다');
  assert.ok(html.includes('수집 상한을 넘어 버린 신호 3건'), '버린 오류 신호 수를 숨기지 않는다');
  // 시각 판정이 개선 제안뿐이면 UI 결함 타일에 넣지 않는다.
  const onlyImprovement = renderHtml({ ...r, bugs: [], visual: [{ ...r.bugs[0], level: 'improvement' }] }, dir);
  assert.ok(onlyImprovement.includes('<p class="num">1</p><p class="tlabel">UI 결함</p>'), '점검 UI 결함 1건만 센다');
  const { targetText } = await import('../src/report.ts');
  assert.equal(targetText({ role: 'link', name: '^Shop$', href: '/shop', nth: 1, of: 2 }), '"Shop" 링크 (주소 /shop) (2개 중 2번째)', '주소로 구별한 링크는 주소도 적는다');
  assert.equal(targetText({ text: String.raw`^(?!\s*Quantity\s*$)\s*\S.{0,39}$`, anchor: '^Quantity$' }), '"Quantity" 영역의 요소','읽는 말로 못 옮기는 정규식은 보이지 않는다');
  assert.equal(targetText({ role: 'paragraph', name: String.raw`^\d+ pieces? saved$` }), '문단', '선택 문법이 남으면 이름을 빼고 역할만');
  assert.equal(targetText({ role: 'paragraph', name: String.raw`^\d+ pieces saved \(total\)$` }), '"… pieces saved (total)" 문단', '숫자 자리는 …, 이스케이프한 괄호는 글자로');
  assert.ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '페이지에서 온 글자는 HTML로 해석하지 않는다');
  assert.ok(!html.includes('<b>배지</b>'));
  assert.ok(html.includes('data:image/png;base64,'), '버그 항목에는 실패 시점 화면을 넣는다');

  // 발견 제목: AI가 없으면 기대 동작 + 검사 기록으로 만든 실제 한 줄
  assert.ok(html.includes('실제: &quot;담은 상품&quot; 목록 안의 목록 항목의 개수 0 (기대 1)'), html.match(/실제: [^<]*/)?.[0] ?? '실제 줄 없음');

  // AI 제목: 기록에 없는 숫자는 돌려보내고, 고친 제목만 남긴다. 판정은 그대로다.
  const { writeHeadlines, checkHeadline } = await import('../src/headline.ts');
  const { Budget } = await import('../src/agent.ts');
  const titles = ['담기 뒤 목록 항목이 3개로 보임', '담기 버튼을 눌러도 목록 항목이 0개(기대 1개)'];
  const seen: string[] = [];
  const h = await writeHeadlines({ dir, model: 'claude-sonnet-5-5', budget: new Budget(1), send: async req => {
    const last = req.messages.at(-1)!;
    if (Array.isArray(last.content) && last.content[0].type === 'tool_result') seen.push(String((last.content[0] as { content: unknown }).content));
    const text = titles.shift()!;
    return { id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: `t${titles.length}`, name: 'headline', input: { text } }],
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
  } });
  assert.match(seen[0], /숫자 3은 기록에 없습니다/);
  assert.deepEqual(Object.values(h).map(x => x.text), ['담기 버튼을 눌러도 목록 항목이 0개(기대 1개)']);
  const titled = buildReport(dir);
  assert.deepEqual(titled.bugs.map(b => b.level), r.bugs.map(b => b.level), '제목은 판정을 바꾸지 않는다');
  const titledHtml = renderHtml(titled, dir);
  assert.ok(titledHtml.includes('담기 버튼을 눌러도 목록 항목이 0개(기대 1개)') && titledHtml.includes('기대 동작: '), '제목 아래에 기대 동작을 남긴다');
  assert.deepEqual(checkHeadline('"Orb Lamp" 버튼', 'x "Orb Lamp" 영역'), []);
  assert.deepEqual(checkHeadline('"Orb Lampe" 버튼', 'x "Orb Lamp" 영역'), ['인용 "Orb Lampe"은 기록에 그대로 없습니다']);
  assert.match(checkHeadline('가'.repeat(61), '')[0], /60자 이내/);

  // 저장된 결과로 보고서만 다시 만든다. 다시 만들어도 같은 report.json이다.
  const first = await writeReport(dir, browser);
  assert.ok(first.pdf, first.pdfError ?? "PDF 없음");
  assert.equal(readFileSync(first.pdf!).subarray(0, 4).toString(), '%PDF');
  const before = readFileSync(join(dir, 'report.json'), 'utf8');
  await writeReport(dir, browser);
  assert.equal(readFileSync(join(dir, 'report.json'), 'utf8'), before);
});

test('행동 실행 집계: 시도 기준 실패율, 시도하지 못한 행동의 원인, 같은 대상의 반복 실패', async () => {
  const { actionSummary } = await import('../src/report.ts');
  const step = (id: string, target?: string) => ({ id, op: 'click' as const, ...(target ? { target } : {}) });
  const plan = { scenarios: [
    { id: 'S1', steps: [step('S1.A1', 'T1'), step('S1.A2', 'T2')] },
    // 같은 버튼을 다른 ID(T3)로 pin했다. 반복 실패는 같은 대상으로 묶는다.
    { id: 'S2', steps: [step('S2.A1', 'T3')] },
    { id: 'S3', steps: [step('S3.A1')] },
    { id: 'S4', steps: [step('S4.A1')] },
    { id: 'S5', steps: [step('S5.A1')] },
  ], targets: { T1: { target: { role: 'button', name: '^담기$' } }, T3: { target: { role: 'button', name: '^담기$' } } } } as unknown as Plan;
  const res = (id: string, steps: { id: string; status: string; reason?: string }[], extra = {}) =>
    [id, { id, valid: true, invalid: [], start: 'ok', precondition: 'none', steps, checks: [], blocked: [], violations: [], ...extra }] as const;
  const a = actionSummary(plan, new Map<string, any>([
    res('S1', [{ id: 'S1.A1', status: 'not_executed', reason: 'target_changed' }, { id: 'S1.A2', status: 'not_run' }]),
    res('S2', [{ id: 'S2.A1', status: 'uncertain_execution' }]),
    res('S3', [{ id: 'S3.A1', status: 'ok' }]),
    res('S4', [{ id: 'S4.A1', status: 'not_run' }], { start: 'failed' }),
    res('S5', [{ id: 'S5.A1', status: 'ok' }], { valid: false }),
  ]));
  assert.deepEqual(a, { planned: 6, attempted: 3, completed: 1, notExecuted: { target_changed: 1 }, uncertain: 1,
    notRun: { '앞 행동에서 멈춤': 1, '시작 실패': 1 }, invalid: 1, policyBlocked: 0, failureRate: 0.667, repeated: [{ target: 'T1', failures: 2, steps: ['S1.A1', 'S2.A1'] }] });
});
