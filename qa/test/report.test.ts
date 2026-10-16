import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildReport, renderHtml, writeReport } from '../src/report.ts';
import type { Plan } from '../src/plan.ts';

const browser = await chromium.launch();
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
    steps: [{ id: `${id}.A1`, status: 'ok', evidence: [`evidence/${id}.A1.after.png`] }],
    checks: [{ id: `${id}.C1`, status: id === 'S1' ? 'mismatch' : 'not_run', source: 'inferred', expected: '1', actual: '0', evidence: [`evidence/${id}.C1.png`] }] })) }));
  const system = { requirement: {}, autonomous: { bug_medium: 1, incomplete: 1 }, preparation: {}, variant: {} };
  writeFileSync(join(dir, 'run', 'verdicts.json'), JSON.stringify({ file: 'verdicts.json', stage: 'done', requirements: [], system, variants: [], features: [],
    pendingQuestions: plan.questions,
    errorSignals: [{ kind: 'http', text: 'GET 500', path: 'http://app.test/api', status: 500, at: [{ scenario: 'S1', after: 'S1.A1' }] },
      { kind: 'http', text: 'GET 403', path: 'http://app.test/admin', status: 403, normal: true, at: [{ scenario: 'S1', after: 'S1.A1' }] }],
    verdicts: [
      { id: 'S1.C1', scenario: 'S1', kind: 'check', requirements: [], observed: 'mismatch', class: 'app_defect_candidate', triage: { reason: '목록이 늘지 않음', quotes: [] },
        reproduction: 'reproduced', system: { level: 'bug_medium', reason: '일반 규칙 위반, 재현됨' } },
      { id: 'S2.C1', scenario: 'S2', kind: 'check', requirements: [], observed: 'not_run', class: 'not_run', cause: 'S2.A1', system: { level: 'incomplete', reason: '실행 안 됨(원인 S2.A1)' } },
    ] }));
  writeFileSync(join(dir, 'explore.json'), JSON.stringify({ complete: false, sitemap: { templates: [{ key: url, pages: [url] }, { key: 'http://app.test/cart', pages: ['http://app.test/cart'] }],
    visited: [url], failed: [], unvisited: ['http://app.test/help'] },
    conversations: [{ template: url, stop: 'done', planned: true, turns: 9 }, { template: 'http://app.test/cart', stop: 'stalled', planned: false, turns: 12, detail: '화면이 바뀌지 않는 행동 8번 연속' }] }));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ startUrl: url, spentUsd: 1.23456, budgetUsd: 10, timingMs: { total: 125_000 } }));
  // 실패 시점 스크린샷(1x1 PNG)
  writeFileSync(join(dir, 'run', 'evidence', 'S1.C1.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  return dir;
}

test('보고서: 판정을 구역으로 나누고, 사람이 따라 할 절차·근거·증거를 남기며, 미완료와 범위 밖을 숨기지 않는다', async () => {
  const dir = savedRun();
  const r = buildReport(dir);
  assert.deepEqual([r.version, r.run.startUrl, r.run.endReason, r.run.spentUsd], ['report/1', 'http://app.test/list', 'incomplete', 1.2346]);
  assert.deepEqual(r.run.incompleteReasons, ['http://app.test/cart: stalled (화면이 바뀌지 않는 행동 8번 연속)'], '계획 못 한 페이지 종류와 사유');
  assert.match(r.run.scope.writes, /차단/);
  assert.deepEqual(r.bugs.map(b => [b.id, b.level, b.basis]), [['S1.C1', 'bug_medium', 'autonomous']]);
  assert.deepEqual(r.bugs[0].steps, ['http://app.test/list 열기', 'click "Orb Lamp" 영역의 button'], '이름 없는 버튼도 라벨 영역으로 적는다');
  assert.deepEqual([r.bugs[0].check!.target, r.bugs[0].check!.expected, r.bugs[0].check!.actual, r.bugs[0].reproduction], ['listitem (list "담은 상품" 안)', '1', '0', { result: 'reproduced' }]);
  assert.deepEqual(r.bugs[0].evidence, ['run/evidence/S1.C1.png']);
  assert.deepEqual(r.incomplete.byReason, { '실행 안 됨(앞 항목에서 멈춤)': 1 }, '사유는 항목 ID 없이 종류로 센다');
  assert.deepEqual([r.errorSignals.map(g => g.status), r.normalRejections], [[500], 1], '정상 거절은 신호에서 빼고 개수만 남긴다');
  assert.deepEqual([r.questions.map(q => q.id), r.observations.length, r.coverage.unvisitedLinks], [['Q1'], 1, ['http://app.test/help']]);

  const html = renderHtml(r, dir);
  assert.ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), '페이지에서 온 글자는 HTML로 해석하지 않는다');
  assert.ok(!html.includes('<b>배지</b>'));
  assert.ok(html.includes('data:image/png;base64,'), '버그 항목에는 실패 시점 화면을 넣는다');

  // 저장된 결과로 보고서만 다시 만든다. 다시 만들어도 같은 report.json이다.
  const first = await writeReport(dir, browser);
  assert.ok(first.pdf, first.pdfError ?? "PDF 없음");
  assert.equal(readFileSync(first.pdf!).subarray(0, 4).toString(), '%PDF');
  const before = readFileSync(join(dir, 'report.json'), 'utf8');
  await writeReport(dir, browser);
  assert.equal(readFileSync(join(dir, 'report.json'), 'utf8'), before);
});
