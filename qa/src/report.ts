// ⑧·⑨ 결과 JSON과 보고서. 저장된 실행 결과(explore·plan·results·verdicts·summary)만 읽어 report.json을 만들고,
// 같은 내용을 HTML로 그려 Playwright로 PDF를 만든다. 새 검사를 하지 않으므로 저장된 결과로 몇 번이든 다시 만들 수 있다(설계 OUT-4).
// 설계: docs/design/V2_ARCHITECTURE.md 5장 8·9단계. 바꿀 때는 version을 올리고 PDF·웹 화면 담당과 맞춘다.
//   node src/report.ts <실행 결과 폴더>
// shortcut: 보고서 AI(요약 문장)는 없다. 모든 문장은 JSON 값을 그대로 옮긴 틀이다. 요약이 필요해지면 JSON 값을 바꾸지 않는 조건으로 붙인다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Browser } from 'playwright';
import type { Plan, Check } from './plan.ts';
import type { Judgment, Verdict, SystemLevel } from './triage.ts';
import type { RunResult } from './run.ts';
import type { SiteMap } from './sitemap.ts';
import type { Target } from './browser.ts';
import { pathOf } from './sitemap.ts';

export type ReportItem = {
  /** 판정 항목 ID(검사·행동·시작). 다른 페이지에서 실행한 복제는 별도 항목이다 */
  id: string; scenario: string; variantOf?: string; page: string; title: string;
  /** 요구사항 검사와 자율 검사를 나눠 센다 */
  basis: 'requirement' | 'autonomous';
  level: SystemLevel; reason: string;
  /** 검사면 무엇을 어떻게 비교했는지(사실 원본). 보고서 문장은 이 값을 바꾸지 않는다 */
  check?: { read: string; op: string; target?: string; expected?: string; expectedFrom?: string; actual?: string;
    source: { kind: string; id?: string; rule?: string; quote?: string } };
  /** 사람이 따라 할 수 있는 재현 절차: 시작 URL과 이 항목까지의 행동 */
  steps: string[];
  /** 시작 조건(선행조건 검사) */
  preconditions: string[];
  /** 원래 실행 결과. 분류로 덮지 않는다 */
  observed: string;
  classification: { class: string; reason?: string; error?: string };
  /** 재현 두 축: 결과와 사유(판단 불가일 때). M5에서 초기화 불가·시작 상태 다름 같은 사유가 늘어난다 */
  reproduction?: { result: 'reproduced' | 'not_reproduced' | 'inconclusive'; reason?: string };
  /** 보고서 폴더 기준 증거 경로 */
  evidence: string[];
};

export type Report = {
  version: 'report/1';
  run: {
    name: string; startUrl: string; origins: string[];
    /** 완료 = 발견한 모든 페이지 종류를 계획함. 아니면 미완료 사유를 함께 남긴다 */
    endReason: 'completed' | 'incomplete';
    incompleteReasons: string[];
    /** 이번 실행이 다루지 않는 범위(M5 전까지 로그인·초기화 없음). 결과를 "사이트 전체 정상"으로 읽지 않게 한다 */
    scope: { writes: string; login: string; reset: string };
    models?: { plan?: string; triage?: string };
    /** 토큰 사용량 기준 추정이며 청구서가 아니다 */
    spentUsd?: number; budgetUsd?: number; durationMs?: number;
  };
  coverage: {
    templates: { template: string; conversations: { stop: string; planned: boolean; turns: number; detail?: string }[]; executedPages: string[] }[];
    unvisitedLinks: string[]; failedUrls: string[];
    requirements: Judgment['requirements'];
    features: Judgment['features'];
  };
  /** 시스템 판정 집계(요구사항·자율·준비 확인·복제) */
  system: Judgment['system'];
  bugs: ReportItem[];
  hold: ReportItem[];
  questions: Judgment['pendingQuestions'];
  /** 탐색 중 관찰했지만 검사로 만들지 못한 의심 사항 */
  observations: Plan['observations'];
  /** 기대값 없이 잡힌 오류 신호(정상 거절 제외). 판정이 아니라 검토 대상 */
  errorSignals: NonNullable<Judgment['errorSignals']>;
  normalRejections: number;
  /** 자동화 실패·미완료: 사유별 개수와 항목 */
  incomplete: { total: number; byReason: Record<string, number>; items: ReportItem[] };
  /** 실제로 완료한 검사 범위. 사이트 정상 보장이 아니다 */
  passed: { checks: number; byClass: Record<string, number> };
};

const LEVEL_TEXT: Record<SystemLevel, string> = { bug_high: '버그 — 확신 높음', bug_medium: '버그 — 확신 중간', hold: '판단 보류', incomplete: '미완료', not_bug: '버그 아님' };

/** 판정 파일은 다시 판정할 때마다 verdicts-2.json …으로 늘어난다. 가장 최근 것을 쓴다. */
function latestVerdicts(runDir: string): string {
  const n = readdirSync(runDir).map(f => f.match(/^verdicts(?:-(\d+))?\.json$/)).filter(m => m).map(m => Number(m![1] ?? 1));
  if (!n.length) throw new Error(`판정 파일이 없음: ${runDir}`);
  const max = Math.max(...n);
  return join(runDir, max === 1 ? 'verdicts.json' : `verdicts-${max}.json`);
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

/** 저장된 실행 결과 폴더에서 report.json 내용을 만든다. 새 검사·모델 호출은 하지 않는다. */
export function buildReport(dir: string): Report {
  const plan = read<Plan>(join(dir, 'plan.json'));
  const results = read<RunResult>(join(dir, 'run', 'results.json'));
  const judgment = read<Judgment>(latestVerdicts(join(dir, 'run')));
  const policy = read<{ origins: string[]; allowWrites?: boolean }>(join(dir, 'run', 'policy.json'));
  const explore = existsSync(join(dir, 'explore.json'))
    ? read<{ sitemap?: SiteMap; conversations?: { template: string; stop: string; planned: boolean; turns: number; detail?: string }[]; complete?: boolean }>(join(dir, 'explore.json')) : {};
  const summary = existsSync(join(dir, 'summary.json'))
    ? read<{ startUrl?: string; spentUsd?: number; budgetUsd?: number; models?: { plan?: string; triage?: string }; timingMs?: { total?: number } }>(join(dir, 'summary.json')) : {};

  const scenarioOf = new Map(plan.scenarios.map(s => [s.id, s]));
  const resultOf = new Map(results.scenarios.map(s => [s.id, s]));
  // 사람이 따라 할 수 있게 대상을 글로 적는다. 이름 없는 버튼은 라벨 영역과 순서로 적는다(예: "Orb Table Lamp" 영역의 button).
  const plain = (p?: string) => p?.replace(/^\^|\$$/g, '');
  const label = (x: Target): string => [
    x.anchor ? `"${plain(x.anchor)}" 영역의` : '', x.role ?? '요소', x.name ? `"${plain(x.name)}"` : '', x.text ? `글자 "${plain(x.text)}"` : '',
    x.nth !== undefined ? `(${x.of ?? '?'}개 중 ${x.nth + 1}번째)` : '', x.within ? `(${label(x.within)} 안)` : '',
  ].filter(Boolean).join(' ');
  const describe = (t?: string) => !t ? undefined : plan.targets[t] ? label(plan.targets[t].target as Target) : t;
  const describeCheck = (c: Check) => `${describe(c.target) ?? 'URL'}의 ${c.read} ${c.op} ${c.expected !== undefined ? JSON.stringify(c.expected) : `${c.expected_from}의 값`}`;

  const item = (v: Verdict): ReportItem => {
    const s = scenarioOf.get(v.scenario)!;
    const r = resultOf.get(v.scenario);
    const c = v.kind === 'check' ? s.checks.find(x => x.id === v.id) : undefined;
    const res = c ? r?.checks.find(x => x.id === c.id) : undefined;
    // 재현 절차: 이 항목 전까지의 행동. 행동 항목이면 그 행동까지.
    const upto = v.kind === 'start' ? -1 : v.kind === 'act' ? s.steps.findIndex(x => x.id === v.id) : c!.after === 'start' ? -1 : s.steps.findIndex(x => x.id === c!.after);
    const steps = [`${s.start.url} 열기`, ...s.steps.slice(0, upto + 1).map(st => `${st.op} ${describe(st.target) ?? ''}${st.value !== undefined ? ` 값 ${JSON.stringify(st.value)}` : ''}`.trim())];
    const stepEvidence = v.kind === 'act' ? r?.steps.find(x => x.id === v.id)?.evidence : undefined;
    const rep = v.reproduction;
    return {
      id: v.id, scenario: v.scenario, ...(s.variantOf ? { variantOf: s.variantOf } : {}), page: s.start.url, title: s.title,
      basis: c?.source.kind === 'requirement' || s.covers.some(x => x.startsWith('R')) ? 'requirement' : 'autonomous',
      level: v.system?.level ?? 'incomplete', reason: v.system?.reason ?? '판정 없음',
      ...(c ? { check: { read: c.read, op: c.op, target: describe(c.target), ...(res?.expected !== undefined ? { expected: res.expected } : c.expected !== undefined ? { expected: c.expected } : {}),
        ...(c.expected_from ? { expectedFrom: c.expected_from } : {}), ...(res?.actual !== undefined ? { actual: res.actual } : {}),
        source: { kind: c.source.kind, ...(c.source.id ? { id: c.source.id } : {}), ...(c.source.rule ? { rule: c.source.rule } : {}), ...(c.source.quote ? { quote: c.source.quote } : {}) } } } : {}),
      steps, preconditions: s.checks.filter(x => x.precondition).map(describeCheck), observed: v.observed,
      classification: { class: v.class, ...(v.triage && 'reason' in v.triage ? { reason: v.triage.reason } : {}), ...(v.triage && 'error' in v.triage ? { error: v.triage.error } : {}) },
      ...(rep ? { reproduction: { result: rep === 'reproduced' ? 'reproduced' as const : rep === 'flaky' ? 'not_reproduced' as const : 'inconclusive' as const,
        ...(v.reproductionDetail ? { reason: v.reproductionDetail } : {}) } } : {}),
      evidence: [...(res?.evidence ?? []), ...(stepEvidence ?? [])].map(e => `run/${e}`),
    };
  };

  const items = judgment.verdicts.map(item);
  const of = (...levels: SystemLevel[]) => items.filter(x => levels.includes(x.level));
  const bugs = of('bug_high', 'bug_medium').sort((a, b) => Number(b.level === 'bug_high') - Number(a.level === 'bug_high'));
  const incomplete = of('incomplete');
  const byReason: Record<string, number> = {};
  // 사유는 종류별로 센다. 원인 항목 ID·세부 값은 각 항목에 남아 있다.
  for (const x of incomplete) {
    const kind = x.reason.replace(/\(원인 [^)]*\)/, '(앞 항목에서 멈춤)').replace(/\(unresolved[^)]*\)/, '');
    byReason[kind] = (byReason[kind] ?? 0) + 1;
  }
  const passedClasses: Record<string, number> = {};
  for (const v of judgment.verdicts) if (v.kind === 'check' && v.system?.level === 'not_bug') passedClasses[v.class] = (passedClasses[v.class] ?? 0) + 1;

  const conversations = explore.conversations ?? [];
  const templates = (explore.sitemap?.templates ?? []).map(t => ({
    template: t.key,
    conversations: conversations.filter(c => c.template === t.key).map(c => ({ stop: c.stop, planned: c.planned, turns: c.turns, ...(c.detail ? { detail: c.detail } : {}) })),
    executedPages: [...new Set(plan.scenarios.map(s => s.start.url).filter(u => t.pages.some(p => pathOf(p) === pathOf(u))))],
  }));
  const incompleteReasons = [...new Set(templates.filter(t => !t.conversations.some(c => c.planned))
    .map(t => `${t.template}: ${t.conversations.map(c => `${c.stop}${c.detail ? ` (${c.detail})` : ''}`).join(', ') || '대화 없음'}`))];
  const signals = judgment.errorSignals ?? [];

  return {
    version: 'report/1',
    run: {
      name: basename(dir), startUrl: summary.startUrl ?? explore.sitemap?.visited[0] ?? plan.scenarios[0]?.start.url ?? '', origins: policy.origins,
      // complete가 없는 예전 결과는 대화 기록으로 판단한다.
      endReason: (explore.complete ?? templates.every(t => t.conversations.some(c => c.planned))) && !incompleteReasons.length ? 'completed' : 'incomplete',
      incompleteReasons,
      scope: {
        writes: policy.allowWrites ? '허용' : '차단 — 서버에 저장되는 흐름(등록·주문 등)은 검사하지 않았다',
        login: '지원 안 함 — 로그인 이후 기능은 이번 범위 밖',
        reset: '지원 안 함 — 재현은 초기화 없이 같은 시작 URL에서 한 번 더 실행',
      },
      ...(summary.models ? { models: summary.models } : {}),
      ...(summary.spentUsd !== undefined ? { spentUsd: Number(summary.spentUsd.toFixed(4)) } : {}),
      ...(summary.budgetUsd !== undefined ? { budgetUsd: summary.budgetUsd } : {}),
      ...(summary.timingMs?.total !== undefined ? { durationMs: summary.timingMs.total } : {}),
    },
    coverage: { templates, unvisitedLinks: explore.sitemap?.unvisited ?? [], failedUrls: explore.sitemap?.failed ?? [],
      requirements: judgment.requirements, features: judgment.features ?? [] },
    system: judgment.system,
    bugs, hold: of('hold'), questions: judgment.pendingQuestions ?? [], observations: plan.observations,
    errorSignals: signals.filter(g => !g.normal), normalRejections: signals.filter(g => g.normal).length,
    incomplete: { total: incomplete.length, byReason, items: incomplete },
    passed: { checks: Object.values(passedClasses).reduce((a, b) => a + b, 0), byClass: passedClasses },
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** 보고서 HTML. 모든 값은 report.json에서 그대로 옮긴다. 버그 항목에는 실패 시점 스크린샷을 넣는다. */
export function renderHtml(rep: Report, dir: string): string {
  const shot = (x: ReportItem) => {
    const png = x.evidence.find(e => e.endsWith('.png') && !e.includes('.before.'));
    if (!png || !existsSync(join(dir, png))) return '';
    return `<img src="data:image/png;base64,${readFileSync(join(dir, png)).toString('base64')}" alt="${esc(x.id)} 실패 시점 화면">`;
  };
  const card = (x: ReportItem, withShot: boolean) => `<section class="item ${x.level}">
    <h3>${esc(x.id)} · ${esc(LEVEL_TEXT[x.level])} · ${esc(x.basis === 'requirement' ? '요구사항 검사' : '자율 검사')}${x.variantOf ? ` · ${esc(x.variantOf)}의 다른 페이지 실행` : ''}</h3>
    <p class="title">${esc(x.title)}</p>
    <dl>
      <dt>페이지</dt><dd>${esc(x.page)}</dd>
      <dt>판정 이유</dt><dd>${esc(x.reason)}</dd>
      ${x.check ? `<dt>검사</dt><dd>${esc(x.check.target ?? 'URL')}의 ${esc(x.check.read)}를 ${esc(x.check.op)}로 비교</dd>
      <dt>기대</dt><dd>${x.check.op === 'not_equals' ? '다음 값과 달라야 함: ' : ''}${esc(x.check.expected ?? '')}${x.check.expectedFrom ? ` (${esc(x.check.expectedFrom)}에서 읽은 값)` : ''}</dd>
      <dt>실제</dt><dd>${esc(x.check.actual ?? '(읽지 못함)')}</dd>
      <dt>기대 근거</dt><dd>${esc(x.check.source.kind)}${x.check.source.id ? ` ${esc(x.check.source.id)}` : ''}${x.check.source.rule ? ` 규칙 ${esc(x.check.source.rule)}` : ''}${x.check.source.quote ? ` — “${esc(x.check.source.quote)}”` : ''}</dd>` : ''}
      <dt>원래 결과</dt><dd>${esc(x.observed)}</dd>
      <dt>분류</dt><dd>${esc(x.classification.class)}${x.classification.reason ? ` — ${esc(x.classification.reason)}` : ''}${x.classification.error ? ` — ${esc(x.classification.error)}` : ''}</dd>
      ${x.reproduction ? `<dt>재현</dt><dd>${esc(x.reproduction.result)}${x.reproduction.reason ? ` — ${esc(x.reproduction.reason)}` : ''}</dd>` : ''}
      ${x.preconditions.length ? `<dt>시작 조건</dt><dd><ul>${x.preconditions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></dd>` : ''}
      <dt>재현 절차</dt><dd><ol>${x.steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol></dd>
      <dt>증거</dt><dd>${x.evidence.map(esc).join('<br>') || '없음'}</dd>
    </dl>${withShot ? shot(x) : ''}</section>`;
  const r = rep.run;
  const count = (o: Record<string, number | undefined>) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${esc(LEVEL_TEXT[k as SystemLevel] ?? k)} ${n}`).join(', ') || '없음';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>QA 보고서 ${esc(r.name)}</title><style>
    body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; font-size: 11px; color: #1a1a1a; margin: 0; }
    h1 { font-size: 20px; } h2 { font-size: 15px; border-bottom: 1px solid #999; padding-bottom: 2px; margin-top: 22px; } h3 { font-size: 12px; margin: 0 0 4px; }
    table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #ccc; padding: 3px 5px; text-align: left; vertical-align: top; }
    .item { border: 1px solid #bbb; border-left-width: 5px; padding: 6px 8px; margin: 8px 0; break-inside: avoid; }
    .bug_high { border-left-color: #b00020; } .bug_medium { border-left-color: #e08a00; } .hold { border-left-color: #5a6acf; } .incomplete { border-left-color: #888; }
    dl { display: grid; grid-template-columns: 70px 1fr; gap: 2px 8px; margin: 4px 0; } dt { font-weight: bold; } dd { margin: 0; word-break: break-all; }
    img { max-width: 100%; max-height: 360px; border: 1px solid #ccc; margin-top: 4px; } .note { color: #555; } ul, ol { margin: 0; padding-left: 16px; }
  </style></head><body>
  <h1>QA 보고서 — ${esc(r.startUrl)}</h1>
  <p class="note">이 보고서는 실제로 실행한 범위의 결과다. 통과한 검사는 사이트 전체가 정상이라는 뜻이 아니다. 최종 결함 여부는 사람이 확인한다.</p>
  <h2>실행 범위</h2><table>
    <tr><th>실행</th><td>${esc(r.name)}</td></tr>
    <tr><th>허용 origin</th><td>${r.origins.map(esc).join(', ')}</td></tr>
    <tr><th>종료</th><td>${r.endReason === 'completed' ? '발견한 모든 페이지 종류를 계획함' : `미완료 — ${r.incompleteReasons.map(esc).join('; ') || '사유 없음'}`}</td></tr>
    <tr><th>쓰기 요청</th><td>${esc(r.scope.writes)}</td></tr><tr><th>로그인</th><td>${esc(r.scope.login)}</td></tr><tr><th>초기화</th><td>${esc(r.scope.reset)}</td></tr>
    ${r.spentUsd !== undefined ? `<tr><th>비용(추정)</th><td>$${r.spentUsd.toFixed(2)}${r.budgetUsd ? ` / 한도 $${r.budgetUsd}` : ''}</td></tr>` : ''}
    ${r.durationMs !== undefined ? `<tr><th>소요 시간</th><td>${Math.round(r.durationMs / 60000)}분</td></tr>` : ''}
    ${r.models ? `<tr><th>모델</th><td>계획 ${esc(r.models.plan)}, 분류 ${esc(r.models.triage)}</td></tr>` : ''}
  </table>
  <h2>요약</h2><table>
    <tr><th>요구사항 검사</th><td>${count(rep.system.requirement)}</td></tr><tr><th>자율 검사</th><td>${count(rep.system.autonomous)}</td></tr>
    <tr><th>다른 페이지 실행(복제)</th><td>${count(rep.system.variant)}</td></tr><tr><th>준비 확인(선행조건)</th><td>${count(rep.system.preparation)}</td></tr>
    <tr><th>오류 신호</th><td>${rep.errorSignals.length}건 (정상 거절 ${rep.normalRejections}건 제외)</td></tr>
    <tr><th>답을 기다리는 질문</th><td>${rep.questions.length}개</td></tr>
  </table>
  <h2>버그 (${rep.bugs.length})</h2>${rep.bugs.map(x => card(x, true)).join('') || '<p>없음</p>'}
  <h2>판단 보류 (${rep.hold.length})</h2>${rep.hold.map(x => card(x, false)).join('') || '<p>없음</p>'}
  ${rep.questions.length ? `<h3>업무 규칙 질문</h3><ul>${rep.questions.map(q => `<li>${esc(q.id)} ${esc(q.question)} — 선택지: ${q.options.map(esc).join(' / ')}${q.feature ? ` (기능 ${esc(q.feature)})` : ''}${q.overLimit ? ' (질문 한도 초과: 규칙 미확인)' : ''}</li>`).join('')}</ul>` : ''}
  <h2>탐색 중 관찰한 이상 (${rep.observations.length})</h2>${rep.observations.length ? `<ul>${rep.observations.map(o => `<li>${esc(o.page)} — ${esc(o.note)}</li>`).join('')}</ul>` : '<p>없음</p>'}
  <h2>오류 신호 (${rep.errorSignals.length})</h2><p class="note">기대값 없이 잡힌 콘솔·요청 오류다. 판정이 아니라 검토 대상이다.</p>
  ${rep.errorSignals.length ? `<table><tr><th>종류</th><th>내용</th><th>경로</th><th>난 곳</th></tr>${rep.errorSignals.map(g => `<tr><td>${esc(g.kind)}${g.status ? ` ${g.status}` : ''}</td><td>${esc(g.text)}</td><td>${esc(g.path)}</td><td>${g.at.slice(0, 5).map(a => `${esc(a.scenario)} ${esc(a.after)}`).join(', ')}${g.at.length > 5 ? ` 외 ${g.at.length - 5}곳` : ''}</td></tr>`).join('')}</table>` : '<p>없음</p>'}
  <h2>자동화 실패·미완료 (${rep.incomplete.total})</h2>
  <table><tr><th>사유</th><th>개수</th></tr>${Object.entries(rep.incomplete.byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('')}</table>
  <h2>통과한 검사 범위</h2><p>${rep.passed.checks}개 (${Object.entries(rep.passed.byClass).map(([k, n]) => `${esc(k)} ${n}`).join(', ')}). 실제로 완료한 검사만 센다.</p>
  <h2>페이지 종류</h2><table><tr><th>페이지 종류</th><th>탐색 대화</th><th>계획 실행 페이지</th></tr>
  ${rep.coverage.templates.map(t => `<tr><td>${esc(t.template)}</td><td>${t.conversations.map(c => `${esc(c.stop)}${c.planned ? ' (계획함)' : ''}, 턴 ${c.turns}${c.detail ? ` — ${esc(c.detail)}` : ''}`).join('<br>') || '대화 없음'}</td><td>${t.executedPages.map(esc).join('<br>') || '없음'}</td></tr>`).join('')}</table>
  ${rep.coverage.unvisitedLinks.length ? `<p>방문하지 않은 링크 ${rep.coverage.unvisitedLinks.length}개: ${rep.coverage.unvisitedLinks.slice(0, 20).map(esc).join(', ')}${rep.coverage.unvisitedLinks.length > 20 ? ' …' : ''}</p>` : ''}
  ${rep.coverage.failedUrls.length ? `<p>열지 못한 URL: ${rep.coverage.failedUrls.map(esc).join(', ')}</p>` : ''}
  ${rep.coverage.requirements.length ? `<h2>요구사항</h2><table><tr><th>ID</th><th>계획</th><th>결과</th></tr>${rep.coverage.requirements.map(q => `<tr><td>${esc(q.id)}</td><td>${esc(q.plan)}</td><td>${Object.entries(q.classes).map(([k, n]) => `${esc(k)} ${n}`).join(', ')}</td></tr>`).join('')}</table>` : ''}
  </body></html>`;
}

/**
 * report.json·report.html을 쓰고 PDF를 만든다. PDF가 실패해도 JSON·HTML은 남기고 실패 사유를 돌려준다(설계 OUT-4).
 * 같은 폴더에서 다시 부르면 저장된 결과로 보고서만 새로 만든다.
 */
export async function writeReport(dir: string, browser: Browser): Promise<{ report: Report; pdf?: string; pdfError?: string }> {
  const report = buildReport(dir);
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  const html = renderHtml(report, dir);
  writeFileSync(join(dir, 'report.html'), html);
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: join(dir, 'report.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    return { report, pdf: join(dir, 'report.pdf') };
  } catch (e) {
    return { report, pdfError: (e as Error).message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) { console.error('사용법: node src/report.ts <실행 결과 폴더>'); process.exit(2); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const r = await writeReport(dir, browser);
    console.log(`report.json · report.html${r.pdf ? ' · report.pdf' : ` (PDF 실패: ${r.pdfError})`} → ${dir}`);
    console.log(`버그 ${r.report.bugs.length} · 보류 ${r.report.hold.length} · 오류 신호 ${r.report.errorSignals.length} · 미완료 ${r.report.incomplete.total} · 통과 검사 ${r.report.passed.checks}`);
  } finally { await browser.close(); }
}
