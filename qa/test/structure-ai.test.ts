import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { Budget, type Send } from '../src/agent.ts';
import { applyReview, quoteOk, reviewStructure, structureQuestions, type StructureReview } from '../src/structure-ai.ts';
import { siteStructure } from '../src/structure.ts';
import type { PageInfo, SiteMap } from '../src/sitemap.ts';

const o = 'http://x.test';
const info = (title: string, links: string[], layout: string[] = []): PageInfo => ({ title, heading: title, search: false, shape: 'h1:1', api: [], forms: [],
  links: [...links.map(to => ({ to: o + to, text: to, layout: false, region: 'main' })), ...layout.map(to => ({ to: o + to, text: to, layout: true, region: 'nav#top' }))] });
// 홈 → 목록(/list) → 상세(/item/1·2), /home은 홈의 다른 주소, /tool/a·b는 서로 다른 도구인데 한 종류로 묶임, /login은 메뉴 링크 하나뿐.
const map: SiteMap = {
  visited: ['/', '/home', '/list', '/item/1', '/item/2', '/tool/a', '/tool/b', '/login'].map(p => o + p), unvisited: [], failed: [],
  templates: [{ key: o + '/', pages: [o + '/'] }, { key: o + '/home', pages: [o + '/home'] }, { key: o + '/list', pages: [o + '/list'] },
    { key: o + '/item/:x', pages: [o + '/item/1', o + '/item/2'] }, { key: o + '/tool/:x', pages: [o + '/tool/a', o + '/tool/b'] }, { key: o + '/login', pages: [o + '/login'] }],
  structure: {
    [o + '/']: info('Shop', ['/list', '/tool/a', '/tool/b']), [o + '/home']: info('Shop', ['/list', '/tool/a', '/tool/b']),
    [o + '/list']: info('Products', ['/item/1', '/item/2', '/item/3']), [o + '/item/1']: info('Lamp', []), [o + '/item/2']: info('Chair', []),
    [o + '/tool/a']: info('Calculator', []), [o + '/tool/b']: info('Drag and Drop', []), [o + '/login']: info('Sign in', ['/home', '/list']),
  },
};

test('구조 질문: 한 종류의 방문 페이지(A), 비슷한 두 종류(B), 중심 노드(C)를 질문으로 만들고 규칙 판정을 함께 둔다', () => {
  const { summary, questions } = structureQuestions(map, o + '/');
  assert.match(summary, /K\d \/list .*제목 "Products"/);
  assert.deepEqual(questions.filter(q => q.kind === 'A').map(q => [q.rule, q.refs.map(p => p.replace(o, ''))]), [['same', ['/item/1', '/item/2']], ['same', ['/tool/a', '/tool/b']]]);
  assert.ok(questions.some(q => q.kind === 'B' && q.rule === 'different' && q.refs.join() === `${o}/,${o}/home`), JSON.stringify(questions.map(q => q.refs)));
  assert.ok(questions.some(q => q.kind === 'C' && q.refs[0] === o + '/login'));
});

test('근거 인용: 조각마다 입력에 그대로 있어야 하고, 하나라도 없으면 실패', () => {
  assert.ok(quoteOk(['제목 "Lamp"', '제목 "Chair"'], '... 제목 "Lamp", h1 ... 제목 "Chair" ...'));
  assert.ok(!quoteOk(['제목 "Lamp"', '제목 "Sofa"'], '... 제목 "Lamp", h1 ... 제목 "Chair" ...'));
  assert.ok(!quoteOk([], 'x'));
  assert.ok(quoteOk(['겹침: 3 / 3'], '본문 링크 목적지 종류 겹침: 3 / 3'), '입력 안의 "/"를 구분자로 오인하지 않는다');
});

test('구조 AI 반영: 규칙과 다르고 근거가 확인된 답만 반영하고(A 나눔·B 합침·C 중심 노드 아님), 기록은 모두 남긴다', () => {
  const q = (id: string, kind: 'A' | 'B' | 'C', rule: 'same' | 'different' | 'hub', refs: string[], decision: string, ok = true) =>
    ({ id, kind, rule, refs: refs.map(r => o + r), decision, evidence: ['x'], quoteOk: ok, applied: false });
  const review: StructureReview = { model: 'm', stop: 'done', costUsd: 0, questions: [
    q('A1', 'A', 'same', ['/item/1', '/item/2'], 'same'),
    q('A2', 'A', 'same', ['/tool/a', '/tool/b'], 'different'),
    q('B3', 'B', 'different', ['/', '/home'], 'same'),
    q('C4', 'C', 'hub', ['/login'], 'not_hub'),
    q('C5', 'C', 'hub', ['/list'], 'not_hub', false),
  ] };
  const m = applyReview(map, review);
  assert.deepEqual(m.templates.map(t => [t.key.replace(o, ''), t.pages.map(p => p.replace(o, ''))]),
    [['/', ['/', '/home']], ['/list', ['/list']], ['/item/:x', ['/item/1', '/item/2']], ['/tool/:x', ['/tool/a']], ['/login', ['/login']], ['/tool/b', ['/tool/b']]]);
  assert.deepEqual(m.structureReview!.questions.map(x => x.applied), [false, true, true, true, false], '인용이 확인되지 않은 C5는 반영하지 않는다');
  const st = siteStructure(m, o + '/');
  assert.equal(st.templates.find(t => t.key === o + '/login')!.hub, false);
  assert.equal(map.templates.length, 6, '원래 사이트 지도는 바꾸지 않는다');
});

test('구조 AI 검토: 모델 답을 받아 반영하고, 입력에 없는 근거를 댄 답은 버린다', async () => {
  const send: Send = async req => ({ id: 'm', type: 'message', role: 'assistant', model: req.model, stop_reason: 'tool_use', stop_sequence: null,
    content: [{ type: 'tool_use', id: 't1', name: 'answer', input: { answers: [
      { id: 'A2', decision: 'different', evidence: ['제목 "Calculator"', '제목 "Drag and Drop"'] },
      { id: 'B3', decision: 'same', evidence: ['없는 근거 문구'] },
    ] } }],
    usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) as unknown as Anthropic.Message;
  const m = await reviewStructure({ map, startUrl: o + '/', send, model: 'claude-sonnet-5-5', budget: new Budget(1) });
  const r = m.structureReview!;
  assert.equal(r.stop, 'done');
  assert.deepEqual(r.questions.filter(x => x.applied).map(x => x.id), ['A2']);
  assert.equal(r.questions.find(x => x.id === 'B3')!.decision, 'unknown', '근거 인용 실패');
  assert.ok(m.templates.some(t => t.key === o + '/tool/b') && m.templates.some(t => t.key === o + '/home'));
});
