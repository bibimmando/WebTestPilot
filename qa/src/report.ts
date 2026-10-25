// ⑧·⑨ 결과 JSON과 보고서. 저장된 실행 결과(explore·plan·results·verdicts·summary)만 읽어 report.json을 만들고,
// 같은 내용을 HTML로 그려 Playwright로 PDF를 만든다. 새 검사를 하지 않으므로 저장된 결과로 몇 번이든 다시 만들 수 있다(설계 OUT-4).
// 설계: docs/design/V2_ARCHITECTURE.md 5장 8·9단계. 바꿀 때는 version을 올리고 PDF·웹 화면 담당과 맞춘다.
//   node src/report.ts <실행 결과 폴더>
// shortcut: 보고서 AI는 발견 제목(headline.ts, 숫자·인용 대조)뿐이고 요약 문장은 없다. 나머지 문장은 JSON 값을 그대로 옮긴 틀이다. 요약이 필요해지면 JSON 값을 바꾸지 않는 조건으로 붙인다.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { Browser } from 'playwright';
import type { Plan, Check } from './plan.ts';
import { REPRO_REASON_TEXT, type Judgment, type Verdict, type SystemLevel } from './triage.ts';
import type { RunResult } from './run.ts';
import type { SiteMap } from './sitemap.ts';
import { MOBILE, type AuditFinding, type Target } from './browser.ts';
import { pathOf } from './sitemap.ts';
import { ruleOf } from './rules.ts';

export type ReportItem = {
  /** 판정 항목 ID(검사·행동·시작). 다른 페이지에서 실행한 복제는 별도 항목이다 */
  id: string; scenario: string; variantOf?: string; page: string; title: string;
  /** 요구사항 검사와 자율 검사를 나눠 센다 */
  basis: 'requirement' | 'autonomous';
  level: SystemLevel; reason: string;
  /** 검사면 무엇을 어떻게 비교했는지(사실 원본). 보고서 문장은 이 값을 바꾸지 않는다 */
  /** expectedFromText: 관측 참조 기대값을 어디서 읽었는지(사람이 읽는 말). expectedFrom은 내부 검사 ID */
  check?: { read: string; op: string; target?: string; expected?: string; expectedFrom?: string; expectedFromText?: string; actual?: string;
    source: { kind: string; id?: string; rule?: string; quote?: string } };
  /** 사람이 따라 할 수 있는 재현 절차: 시작 URL과 이 항목까지의 행동 */
  steps: string[];
  /** 시작 조건(선행조건 검사) */
  preconditions: string[];
  /** 원래 실행 결과. 분류로 덮지 않는다 */
  observed: string;
  classification: { class: string; reason?: string; error?: string };
  /** 재현 두 축: 결과와 사유(판단 불가일 때). M5에서 초기화 불가·시작 상태 다름 같은 사유가 늘어난다 */
  /** 재현 두 축: 결과, 판단 불가 사유(reasonCode·이름), 설명 */
  reproduction?: { result: 'reproduced' | 'not_reproduced' | 'inconclusive'; reasonCode?: string; reasonName?: string; reason?: string; evidence?: string[] };
  /** 보고서 폴더 기준 증거 경로(최초 실행). 재실행 증거는 reproduction.evidence */
  evidence: string[];
  /** 이 항목의 실패 시점 증거 수집 실패. 촬영 실패는 사이트 결함이 아니다 */
  captureErrors?: string[];
  /** 시각 검사: 조건마다 판정 AI의 답과 근거, 조작을 막는지 */
  visual?: { criteria: { text: string; status?: string; evidence?: string }[]; blocksUse?: boolean; decision?: string };
};

/** 사이트 지도에서 페이지마다 계산한 품질·사용성 점검(AI 없음). confirmed = 새로 열어 다시 점검해도 같음 */
export type AuditItem = AuditFinding & { page: string; confirmed: boolean };

/** 발견(findingKey)마다 AI가 쓴 문제 한 줄. 숫자·인용이 검사 기록에 있는지 코드가 대조해 통과한 것만 둔다(headline.ts). facts: 입력 사실의 지문 */
export type Headlines = Record<string, { text: string; model: string; facts: string }>;

export type Report = {
  version: 'report/2';
  run: {
    name: string; startUrl: string; origins: string[];
    /** 완료 = 발견한 모든 페이지 종류를 계획함. 아니면 미완료 사유를 함께 남긴다 */
    endReason: 'completed' | 'incomplete';
    incompleteReasons: string[];
    /** 보고서에 쓴 판정 파일과 그 단계(done이 아니면 임시 결과), 그보다 뒤의 끝나지 않았거나 읽을 수 없는 재판정 */
    verdicts: { file: string; stage: string; later: { file: string; stage: string }[] };
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
  /** 기대값 없이 잡힌 오류 신호. 판정이 아니라 검토 대상. normal은 정상 거절(401·403·422)일 수 있는 것 */
  errorSignals: NonNullable<Judgment['errorSignals']>;
  normalRejections: number;
  /** 시나리오별 상한을 넘어 버린 신호 수 */
  signalsDropped: number;
  /** 품질·사용성 점검(일반 규칙 ③). 조작을 막으면 UI 결함, 아니면 개선 제안. 버그 집계와 따로 센다 */
  /** 발견 제목(AI). 없으면 보고서는 기대 동작과 코드가 만든 실제 한 줄을 보인다. 판정·등급에는 쓰지 않는다 */
  headlines?: Headlines;
  uiDefects: AuditItem[];
  improvements: AuditItem[];
  /** 다시 나오지 않았거나 화면이 안정되지 않아 확인하지 못한 점검 발견(관찰). 결함 건수에 넣지 않는다 */
  auditUnconfirmed: AuditItem[];
  /** 점검하지 못한 페이지와 사유 */
  auditErrors: string[];
  /** 자동화 실패(분류 결과, 원래 불일치 보존)·미완료: 사유별 개수와 항목 */
  incomplete: { total: number; byReason: Record<string, number>; items: ReportItem[] };
  /** 계획된 행동의 실행 결과. failureRate = (미실행 + 실행 여부 불명확) / 시도. 시도하지 못한 행동은 notRun에 원인별로 */
  actions: { planned: number; attempted: number; completed: number; notExecuted: Record<string, number>; uncertain: number;
    notRun: Record<string, number>; invalid: number; policyBlocked: number; failureRate: number | null; repeated: { target: string; failures: number; steps: string[] }[] };
  /** 증거 수집 실패: 실패한 기록 수와 위치(항목 ID: 사유). 행동 전후·시작·실패 시점 모두 센다 */
  evidenceGaps: { total: number; items: string[] };
  /** 행동이 새 탭·창을 연 시나리오(검사는 원래 탭을 읽었다) */
  newTabs: { scenario: string; after: string; url: string }[];
  /** 시각 검사에서 재현된 위반(UI 결함·개선 제안). AI 판정이라 버그와 따로 센다 */
  visual: ReportItem[];
  /** 실제로 통과한 검사 범위. 사이트 정상 보장이 아니다 */
  passed: { checks: number; byClass: Record<string, number> };
};

const AUDIT_TEXT: Record<AuditFinding['kind'], string> = { 'unnamed-control': '이름 없는 조작 요소', 'covered-control': '가려진 조작 요소', 'horizontal-overflow': '가로 넘침' };
const LEVEL_TEXT: Record<SystemLevel, string> = { bug_high: '버그 — 확신 높음', bug_medium: '버그 — 확신 중간', hold: '판단 보류', incomplete: '미완료', not_bug: '버그 아님',
  ui_defect: 'UI 결함(시각 판정)', improvement: '개선 제안(시각 판정)' };

/**
 * 판정 파일은 다시 판정할 때마다 verdicts-2.json …으로 늘어난다. 판정이 끝난(stage done) 것 중 가장 최근 것을 쓰고,
 * 끝난 것이 없으면 가장 최근 것을 쓰되 보고서에 그 단계를 남긴다(중간에 멈춘 재판정이 끝난 판정을 가리지 않게).
 */
function latestVerdicts(runDir: string): { path: string; later: { file: string; stage: string }[] } {
  const files = readdirSync(runDir).map(f => f.match(/^verdicts(?:-(\d+))?\.json$/)).filter(m => m)
    .map(m => ({ n: Number(m![1] ?? 1), file: m![0] })).sort((a, b) => b.n - a.n)
    // 기록 중에 멈춰 읽을 수 없는 파일은 고르지 않고 "읽을 수 없음"으로 남긴다.
    .map(f => { try { return { ...f, stage: read<{ stage?: string }>(join(runDir, f.file)).stage ?? 'unknown' }; } catch { return { ...f, stage: 'unreadable' }; } });
  const usable = files.filter(f => f.stage !== 'unreadable');
  if (!usable.length) throw new Error(`읽을 수 있는 판정 파일이 없음: ${runDir}`);
  const pick = usable.find(f => f.stage === 'done') ?? usable[0];
  return { path: join(runDir, pick.file), later: files.filter(f => f.n > pick.n).map(f => ({ file: f.file, stage: f.stage })) };
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));

const ROLE_TEXT: Record<string, string> = { link: '링크', button: '버튼', textbox: '입력칸', searchbox: '검색칸', checkbox: '체크박스', radio: '라디오 버튼', combobox: '선택 상자',
  listbox: '목록 상자', option: '선택지', heading: '제목', listitem: '목록 항목', list: '목록', article: '카드', paragraph: '문단', img: '이미지', banner: '머리말',
  contentinfo: '꼬리말', navigation: '메뉴', main: '본문', region: '영역', dialog: '창', tab: '탭', menuitem: '메뉴 항목', spinbutton: '숫자 입력칸', switch: '스위치',
  slider: '슬라이더', table: '표', row: '표 행', cell: '표 칸', status: '상태 표시', alert: '알림', form: '입력 양식', group: '묶음', complementary: '보조 영역', search: '검색 영역' };
/** 대상 패턴(정규식)을 읽는 글자로: 아무 글자·숫자 자리는 "…", 이스케이프는 원래 글자, 너무 길면 줄인다. 그 밖의 정규식 문법(그룹·글자 묶음·반복)이 남으면 읽는 말로 못 옮기므로 undefined. */
const shownText = (p: string) => {
  const t = p.replace(/^\^|\$$/g, '').replace(/\\d(?:[+*]|\{[\d,]+\})?|\.[*+]\??/g, '…').trim();
  if (/\\[a-zA-Z]|(?<!\\)[()[\]{}|+*?]/.test(t)) return undefined;
  const u = t.replace(/\\(.)/g, '$1');
  return u.length > 40 ? `${u.slice(0, 38)}…` : u;
};
/** 대상 설명: "Start Shopping" 링크, "수량" 영역의 버튼 (2개 중 2번째) */
export function targetText(x: Target): string {
  const role = x.role ? ROLE_TEXT[x.role] ?? x.role : '';
  const name = x.name ?? x.text, shown = name && shownText(name), area = x.anchor && shownText(x.anchor);
  let s = shown ? `"${shown}" ${role || '글자'}` : role || '요소';
  if (area) s = `"${area}" 영역의 ${s}`;
  if (x.href) s += ` (주소 ${x.href})`;
  if (x.nth !== undefined && (x.of ?? 0) > 1) s += ` (${x.of}개 중 ${x.nth + 1}번째)`;
  return x.within ? `${targetText(x.within)} 안의 ${s}` : s;
}
/** 조건 설명: "빈 위시리스트" 제목 — 보임, 결과 목록 — 13개 */
function checkText(c: Check, target?: string): string {
  const t = target ?? '현재 주소';
  const v = c.expected !== undefined ? `"${c.expected}"` : '앞에서 읽은 값';
  const not = c.op === 'not_equals';
  if (c.read === 'visible') return `${t} — ${(c.expected === 'true') !== not ? '보임' : '보이지 않음'}`;
  if (c.read === 'checked') return `${t} — ${(c.expected === 'true') !== not ? '선택됨' : '선택 안 됨'}`;
  if (c.read === 'count') return `${t} — ${c.op === 'greater' ? `${c.expected}개보다 많음` : c.op === 'less' ? `${c.expected}개보다 적음` : not ? `${c.expected}개가 아님` : `${c.expected ?? '앞에서 읽은 수'}개`}`;
  return `${t}의 ${READ_TEXT[c.read] ?? c.read} — ${{ equals: v, not_equals: `${v}와 다름`, contains: `${v} 포함`, less: `${v}보다 작음`, greater: `${v}보다 큼`, same_number: `${v}의 숫자와 같음` }[c.op as string] ?? `${OP_TEXT[c.op] ?? c.op} ${v}`}`;
}

/** 저장된 실행 결과 폴더에서 report.json 내용을 만든다. 새 검사·모델 호출은 하지 않는다. */
export function buildReport(dir: string): Report {
  const plan = read<Plan>(join(dir, 'plan.json'));
  const results = read<RunResult>(join(dir, 'run', 'results.json'));
  const { path: verdictsFile, later: laterVerdicts } = latestVerdicts(join(dir, 'run'));
  const judgment = read<Judgment & { stage?: string }>(verdictsFile);
  const policy = read<{ origins: string[]; allowWrites?: boolean }>(join(dir, 'run', 'policy.json'));
  const explore = existsSync(join(dir, 'explore.json'))
    ? read<{ sitemap?: SiteMap; conversations?: { template: string; stop: string; planned: boolean; turns: number; detail?: string }[]; complete?: boolean }>(join(dir, 'explore.json')) : {};
  const summary = existsSync(join(dir, 'summary.json'))
    ? read<{ startUrl?: string; reset?: { registered: boolean; used?: boolean; calls: { at: 'run' | 'repro'; ok: boolean; reason?: string }[] }; login?: { status: 'none' | 'ok' | 'failed'; reason?: string }; spentUsd?: number; budgetUsd?: number; models?: { plan?: string; triage?: string }; timingMs?: { total?: number } }>(join(dir, 'summary.json')) : {};

  const scenarioOf = new Map(plan.scenarios.map(s => [s.id, s]));
  const resultOf = new Map(results.scenarios.map(s => [s.id, s]));
  // 사람이 따라 할 수 있게 대상·행동·조건을 읽는 말로 적는다(내부 패턴·역할 코드를 그대로 쓰지 않는다).
  const describe = (t?: string) => !t ? undefined : plan.targets[t] ? targetText(plan.targets[t].target as Target) : t;
  const describeCheck = (c: Check) => checkText(c, describe(c.target));
  const stepText = (st: Plan['scenarios'][number]['steps'][number]) => {
    const t = describe(st.target);
    return st.op === 'click' ? `${t} 누르기` : st.op === 'fill' ? `${t}에 "${st.value}" 입력`
      : st.op === 'select' ? `${t}에서 "${st.value}" 선택` : t ? `${t}에서 ${st.value} 키 누르기` : `${st.value} 키 누르기`;
  };

  const item = (v: Verdict): ReportItem => {
    const s = scenarioOf.get(v.scenario)!;
    const r = resultOf.get(v.scenario);
    const c = v.kind === 'check' ? s.checks.find(x => x.id === v.id) : undefined;
    const res = c ? r?.checks.find(x => x.id === c.id) : undefined;
    // 재현 절차: 이 항목 전까지의 행동. 행동 항목이면 그 행동까지.
    const upto = v.kind === 'start' ? -1 : v.kind === 'act' ? s.steps.findIndex(x => x.id === v.id) : c!.after === 'start' ? -1 : s.steps.findIndex(x => x.id === c!.after);
    const steps = [`${s.start.url} 열기${s.viewport === 'mobile' ? ` (화면 폭 ${MOBILE.width}px, 모바일)` : ''}`, ...s.steps.slice(0, upto + 1).map(stepText)];
    const ref = c?.expected_from ? s.checks.find(x => x.id === c.expected_from) : undefined;
    const stepEvidence = v.kind === 'act' ? r?.steps.find(x => x.id === v.id)?.evidence : undefined;
    const rep = v.reproduction;
    return {
      id: v.id, scenario: v.scenario, ...(s.variantOf ? { variantOf: s.variantOf } : {}), page: s.start.url, title: s.title,
      basis: (c ? c.source.kind === 'requirement' : s.covers.some(x => x.startsWith('R'))) ? 'requirement' : 'autonomous',
      level: v.system?.level ?? 'incomplete', reason: v.system?.reason ?? '판정 없음',
      ...(c ? { check: { read: c.read, op: c.op, target: describe(c.target), ...(res?.expected !== undefined ? { expected: res.expected } : c.expected !== undefined ? { expected: c.expected } : {}),
        ...(c.expected_from ? { expectedFrom: c.expected_from } : {}),
        ...(ref ? { expectedFromText: `${ref.after === 'start' ? '시작할 때' : '앞 단계에서'} ${describe(ref.target) ?? '현재 주소'}의 ${READ_TEXT[ref.read] ?? ref.read}를 읽은 값${c!.offset ? `에 ${c!.offset > 0 ? '+' : ''}${c!.offset}` : ''}` } : {}),
        ...(res?.actual !== undefined ? { actual: res.actual } : {}),
        source: { kind: c.source.kind, ...(c.source.id ? { id: c.source.id } : {}), ...(c.source.rule ? { rule: c.source.rule } : {}), ...(c.source.quote ? { quote: c.source.quote } : {}) } } } : {}),
      steps, preconditions: s.checks.filter(x => x.precondition).map(describeCheck), observed: v.observed,
      classification: { class: v.class, ...(v.triage && 'reason' in v.triage ? { reason: v.triage.reason } : {}), ...(v.triage && 'error' in v.triage ? { error: v.triage.error } : {}) },
      ...(rep ? { reproduction: { result: rep === 'reproduced' ? 'reproduced' as const : rep === 'flaky' ? 'not_reproduced' as const : 'inconclusive' as const,
        ...(v.reproductionReason ? { reasonCode: v.reproductionReason, reasonName: REPRO_REASON_TEXT[v.reproductionReason] } : {}),
        ...(v.reproductionDetail ? { reason: v.reproductionDetail } : {}),
        // 재실행 폴더(repro/)에 같은 항목의 증거가 있으면 연결한다. 재현 판정을 따라가 확인할 수 있게 한다.
        ...(() => { const e = ['png', 'aria.txt', 'visual.png'].map(x => `${judgment.reproduceDir ?? 'repro'}/evidence/${v.id}.${x}`).filter(p => existsSync(join(dir, p))); return e.length ? { evidence: e } : {}; })() } } : {}),
      evidence: [...(res?.evidence ?? []), ...(stepEvidence ?? [])].map(e => `run/${e}`),
      ...(v.captureErrors ? { captureErrors: v.captureErrors } : {}),
      ...(v.visual ? { visual: { criteria: v.visual.criteria.map((text, i) => {
        const a = v.visual!.assessment?.criteria.find(x => x.n === i + 1);
        return { text, ...(a ? { status: a.status, evidence: a.evidence } : {}) };
      }), ...(v.visual.assessment ? { blocksUse: v.visual.assessment.blocks_use } : {}), ...(v.visual.decision ? { decision: v.visual.decision } : {}) } } : {}),
    };
  };

  const items = judgment.verdicts.map(item);
  const of = (...levels: SystemLevel[]) => items.filter(x => levels.includes(x.level));
  const bugs = of('bug_high', 'bug_medium').sort((a, b) => Number(b.level === 'bug_high') - Number(a.level === 'bug_high'));
  // 자동화 실패로 분류된 항목은 판정상 "버그 아님"이지만 검사를 끝낸 것이 아니므로 미완료 구역에 원래 결과와 함께 보인다.
  const incomplete = items.filter(x => x.level === 'incomplete' || x.classification.class === 'automation_failure');
  const byReason: Record<string, number> = {};
  // 사유는 종류별로 센다. 원인 항목 ID·세부 값은 각 항목에 남아 있다.
  for (const x of incomplete) {
    const kind = x.classification.class === 'automation_failure' ? '자동화 실패로 분류(원래 결과 보존)'
      : x.reason.replace(/\(원인 [^)]*\)/, '(앞 항목에서 멈춤)').replace(/\(unresolved[^)]*\)/, '');
    byReason[kind] = (byReason[kind] ?? 0) + 1;
  }
  const passedClasses: Record<string, number> = {};
  for (const v of judgment.verdicts) if (v.kind === 'check' && v.class.startsWith('passed')) passedClasses[v.class] = (passedClasses[v.class] ?? 0) + 1;

  const conversations = explore.conversations ?? [];
  const templates = (explore.sitemap?.templates ?? []).map(t => ({
    template: t.key,
    conversations: conversations.filter(c => c.template === t.key).map(c => ({ stop: c.stop, planned: c.planned, turns: c.turns, ...(c.detail ? { detail: c.detail } : {}) })),
    // 계획만 있고 시작하지 못한 시나리오의 페이지는 넣지 않는다.
    executedPages: [...new Set(plan.scenarios.filter(s => resultOf.get(s.id)?.start === 'ok').map(s => s.start.url).filter(u => t.pages.some(p => pathOf(p) === pathOf(u))))],
  }));
  const incompleteReasons: string[] = [...new Set(templates.filter(t => !t.conversations.some(c => c.planned))
    .map(t => `${t.template}: ${t.conversations.map(c => `${c.stop}${c.detail ? ` (${c.detail})` : ''}`).join(', ') || '대화 없음'}`))];
  const signals = judgment.errorSignals ?? [];
  const audit: AuditItem[] = (explore.sitemap?.audit ?? []).flatMap(a => a.findings.map(f => ({ ...f, page: a.url })));
  if (!explore.sitemap) incompleteReasons.push('탐색 기록(explore.json의 사이트 지도) 없음: 탐색 범위를 알 수 없다');
  const actions = actionSummary(plan, resultOf);
  const gaps = results.scenarios.flatMap(s => [
    ...(s.startCaptureErrors ?? []).map(e => `${s.id}(시작): ${e}`),
    ...[...s.steps, ...s.checks].flatMap(x => (x.captureErrors ?? []).map(e => `${x.id}: ${e}`))]);
  actions.repeated = actions.repeated.map(r => ({ ...r, target: describe(r.target) ?? r.target }));

  return {
    version: 'report/2',
    run: {
      name: basename(dir), startUrl: summary.startUrl ?? explore.sitemap?.visited[0] ?? plan.scenarios[0]?.start.url ?? '', origins: policy.origins,
      // complete가 없는 예전 결과는 대화 기록으로 판단한다.
      endReason: (explore.complete ?? templates.every(t => t.conversations.some(c => c.planned))) && !incompleteReasons.length ? 'completed' : 'incomplete',
      incompleteReasons,
      verdicts: { file: basename(verdictsFile), stage: judgment.stage ?? 'unknown', later: laterVerdicts },
      scope: {
        writes: policy.allowWrites ? '허용' : '차단 — 서버에 저장되는 흐름(등록·주문 등)은 검사하지 않았다',
        login: summary.login?.status === 'ok' ? '앱 설정의 테스트 계정으로 로그인한 상태에서 검사(로그아웃 등 앱 설정의 금지 주소는 요청하지 않음)'
          : summary.login?.status === 'failed' ? `로그인 실패 — 로그인하지 않은 상태로 탐색·실행했다. 로그인 이후 기능은 미검사(${summary.login.reason ?? '사유 없음'})`
          : '로그인 안 함 — 로그인 이후 기능은 이번 범위 밖',
        reset: summary.reset?.registered && !policy.allowWrites ? '등록된 초기화가 있지만 부르지 않음 — 쓰기를 막아 서버 상태를 바꾸지 않으므로 초기화 없이 같은 시작 URL에서 재현'
          : !summary.reset?.registered
          ? (policy.allowWrites ? '등록된 초기화 없음 — 쓰기 허용 실행이라 재현은 판단 불가(초기화 불가)' : '등록된 초기화 없음 — 쓰기를 막아 서버 상태를 바꾸지 않으므로 초기화 없이 같은 시작 URL에서 재현')
          : summary.reset.calls.every(c => c.ok) ? `등록된 초기화를 호출하고 확인함(${summary.reset.calls.map(c => c.at === 'run' ? '실행 전' : '재현 전').join('·') || '호출 없음'})`
          : `초기화 실패 — ${summary.reset.calls.filter(c => !c.ok).map(c => `${c.at === 'run' ? '실행 전' : '재현 전'}: ${c.reason}`).join('; ')}`,
      },
      ...(summary.models ? { models: summary.models } : {}),
      ...(summary.spentUsd !== undefined ? { spentUsd: Number(summary.spentUsd.toFixed(4)) } : {}),
      ...(summary.budgetUsd !== undefined ? { budgetUsd: summary.budgetUsd } : {}),
      ...(summary.timingMs?.total !== undefined ? { durationMs: summary.timingMs.total } : {}),
    },
    coverage: { templates, unvisitedLinks: explore.sitemap?.unvisited ?? [], failedUrls: explore.sitemap?.failed ?? [],
      requirements: judgment.requirements, features: judgment.features ?? [] },
    system: judgment.system,
    bugs, hold: of('hold'), visual: of('ui_defect', 'improvement'), questions: judgment.pendingQuestions ?? [], observations: plan.observations,
    errorSignals: signals, normalRejections: signals.filter(g => g.normal).length,
    signalsDropped: results.scenarios.reduce((n, s) => n + (s.signalsDropped ?? 0), 0),
    uiDefects: audit.filter(a => a.confirmed && a.level === 'ui_defect'), improvements: audit.filter(a => a.confirmed && a.level === 'improvement'),
    auditUnconfirmed: audit.filter(a => !a.confirmed), auditErrors: explore.sitemap?.auditErrors ?? [],
    incomplete: { total: incomplete.length, byReason, items: incomplete },
    actions,
    evidenceGaps: { total: gaps.length, items: gaps },
    newTabs: results.scenarios.flatMap(s => (s.newTabs ?? []).map(t => ({ scenario: s.id, ...t }))),
    passed: { checks: Object.values(passedClasses).reduce((a, b) => a + b, 0), byClass: passedClasses },
    ...(existsSync(join(dir, 'headlines.json')) ? { headlines: validHeadlines(read<Headlines>(join(dir, 'headlines.json')), { bugs, visual: of('ui_defect', 'improvement') }) } : {}),
  };
}

/** 발견 묶기: 원래 시나리오 하나가 한 발견이다(같은 종류 다른 페이지 복제 포함). 심각한 순서. 보고서 본문과 AI 제목이 같은 묶음을 쓴다 */
export const findingKey = (x: ReportItem) => x.variantOf ?? x.scenario;
export function findingGroups(rep: Pick<Report, 'bugs' | 'visual'>): ReportItem[][] {
  const bySeverity = (a: ReportItem, b: ReportItem) => SEVERITY.indexOf(a.level) - SEVERITY.indexOf(b.level);
  const groups = new Map<string, ReportItem[]>();
  for (const x of [...rep.bugs, ...rep.visual]) groups.set(findingKey(x), [...groups.get(findingKey(x)) ?? [], x]);
  return [...groups.values()].map(items => items.sort(bySeverity)).sort((a, b) => bySeverity(a[0], b[0]));
}

const clip = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
// 목록 비교가 실패했을 때의 뜻(비교 방식마다 다르다). 값 비교는 실제 값 옆에 기대 조건을 쓴다.
const ITEMS_FAILED: Record<string, (e: string) => string> = {
  any_contain: e => `"${e}" 포함 항목 없음`, any_equal: e => `"${e}"와 같은 항목 없음`, all_contain: e => `"${e}" 미포함 항목 있음`, all_equal: e => `"${e}"와 다른 항목 있음`,
  sorted_asc: () => '오름차순이 아님', sorted_desc: () => '내림차순이 아님', equals: () => '기대한 목록과 다름', not_equals: () => '달라야 할 목록과 같음' };
const EXPECTED_AS: Record<string, (e: string) => string> = {
  equals: e => `기대 ${e}`, not_equals: e => `기대: ${e}와 달라야 함`, contains: e => `기대: ${e} 포함`, less: e => `기대: ${e}보다 작음`,
  greater: e => `기대: ${e}보다 큼`, same_number: e => `기대: "${e}"의 숫자와 같음` };
/** 검사 기록만으로 만든 "실제" 한 줄(모델 없음). 발견 제목이 기대 동작이라 무엇이 틀렸는지 보이게 한다 */
export function actualLine(x: ReportItem): string {
  const c = x.check;
  if (x.visual) { const unmet = x.visual.criteria.filter(k => k.status === 'unmet').length; return `화면 조건 ${x.visual.criteria.length}개 중 ${unmet}개 위반`; }
  if (!c) return clip(x.reason, 80);
  const target = c.target ?? '현재 주소';
  if (c.actual === undefined) return `${target}의 ${READ_TEXT[c.read] ?? c.read}을 읽지 못함`;
  const e = clip(c.expected ?? '', 40);
  if (c.read === 'items') return `${target}: ${ITEMS_FAILED[c.op]?.(e) ?? `${OP_TEXT[c.op] ?? c.op} 아님 (기대 ${e})`}`;
  return `${target}의 ${READ_TEXT[c.read] ?? c.read} ${clip(c.actual, 40)} (${EXPECTED_AS[c.op]?.(e) ?? `${OP_TEXT[c.op] ?? c.op} ${e}`})`;
}

/**
 * AI 제목에 주는 사실. text는 모델 입력 전체, verifiable은 제목의 숫자·인용을 대조할 기록(재현 절차 글자, 검사 대상·기대·실제, 화면 조건과 그 근거).
 * 분류 근거(AI 판단)·영향 페이지 수·절차 번호는 맥락으로만 주고 대조에 쓰지 않는다. 같은 검사의 페이지별 값이 다르면 조합마다 페이지 수를 준다.
 */
export function headlineFacts(items: ReportItem[]): { text: string; verifiable: string } {
  const x = items[0];
  const steps = items.reduce((a, y) => y.steps.length > a.steps.length ? y : a, x).steps;
  const byCheck = new Map<string, ReportItem[]>();
  for (const y of items) { const k = y.id.slice(y.scenario.length); byCheck.set(k, [...byCheck.get(k) ?? [], y]); }
  const cut = (s = '', n = 400) => s.length > n ? `${s.slice(0, n)}…` : s;
  const verifiable: string[] = [...steps];
  const checks = [...byCheck.values()].map(ys => {
    const y = ys[0];
    const lines = [`- ${actualLine(y)}`];
    if (y.check && y.check.read !== 'visual') {
      const pairs = new Map<string, number>();
      for (const z of ys) { const k = JSON.stringify([z.check?.expected ?? '', z.check?.actual ?? '(읽지 못함)']); pairs.set(k, (pairs.get(k) ?? 0) + 1); }
      lines.push(`  대상: ${y.check.target ?? '현재 주소'} / 읽은 것: ${y.check.read} / 비교: ${y.check.op}`);
      for (const [k, n] of pairs) { const [exp, act] = JSON.parse(k) as string[]; lines.push(`  ${n}곳: 기대 ${cut(exp)} / 실제 ${cut(act)}`); verifiable.push(exp, act); }
      verifiable.push(y.check.target ?? '');
    }
    for (const c of y.visual?.criteria ?? []) {
      lines.push(`  화면 조건: ${c.text} — ${c.status === 'unmet' ? '위반' : c.status === 'met' ? '만족' : '판단 불가'}${c.evidence ? `: ${cut(c.evidence, 300)}` : ''}`);
      verifiable.push(c.text, c.evidence ?? '');
    }
    if (y.classification.reason) lines.push(`  분류 근거(AI 판단, 사실 대조 대상 아님): ${cut(y.classification.reason)}`);
    return lines.join('\n');
  });
  return { text: [
    `기대 동작(계획의 시나리오 제목): ${x.title.replace(' (같은 템플릿 다른 페이지)', '')}`,
    `영향 페이지: ${new Set(items.map(y => y.page)).size}곳`,
    `재현 절차:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `실패한 검사:\n${checks.join('\n')}`,
  ].join('\n'), verifiable: verifiable.join('\n') };
}

const HEADLINE_MAX = 60;
/** 제목 대조: 한 줄·길이, 숫자와 따옴표 인용이 대조용 기록(verifiable)에 그대로 있어야 한다. 틀린 점 목록(비면 통과) */
export function checkHeadline(text: string, verifiable: string): string[] {
  const errors: string[] = [];
  const t = text.trim();
  if (!t || /\n/.test(t)) errors.push('한 줄로 쓰세요');
  if (t.length > HEADLINE_MAX) errors.push(`${HEADLINE_MAX}자 이내로 줄이세요(지금 ${t.length}자)`);
  const nums = new Set(verifiable.match(/\d+(?:[.,]\d+)*/g) ?? []);
  for (const n of t.match(/\d+(?:[.,]\d+)*/g) ?? []) if (!nums.has(n)) errors.push(`숫자 ${n}은 검사 기록(대상·기대·실제·화면 조건·절차)에 없습니다`);
  for (const m of t.matchAll(/["“'‘]([^"”'’]+)["”'’]/g)) if (!verifiable.includes(m[1])) errors.push(`인용 "${m[1]}"은 검사 기록에 그대로 없습니다`);
  return errors;
}
/** 제목을 만든 입력 사실의 지문. 재판정·재실행으로 사실이 바뀌면 예전 제목을 쓰지 않는다 */
export const factsHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** 저장된 제목 중 지금 사실과 지문이 같고 대조를 다시 통과한 것만 쓴다(손으로 고친 파일·예전 판정의 제목을 막는다) */
function validHeadlines(saved: Headlines, rep: Pick<Report, 'bugs' | 'visual'>): Headlines {
  const out: Headlines = {};
  for (const g of findingGroups(rep)) {
    const h = saved[findingKey(g[0])];
    if (!h) continue;
    const f = headlineFacts(g);
    if (h.facts === factsHash(f.text) && !checkHeadline(h.text, f.verifiable).length) out[findingKey(g[0])] = h;
  }
  return out;
}

/**
 * 계획된 행동마다 시도·완료·미실행(사유별)·실행 여부 불명확·실행 안 됨(원인별)을 센다. 실패율은 시도한 행동 기준이고,
 * 시도하지 못한 행동은 분모에서 숨기지 않고 원인과 함께 따로 남긴다. 무효 시나리오의 행동은 믿을 수 없어 invalid로만 센다.
 * 같은 대상에서 두 번 이상 실패한 행동은 평균에 묻히지 않게 따로 보인다(복제 페이지·여러 시나리오의 같은 대상).
 */
export function actionSummary(plan: Plan, resultOf: Map<string, RunResult['scenarios'][number]>): Report['actions'] {
  const a: Report['actions'] = { planned: 0, attempted: 0, completed: 0, notExecuted: {}, uncertain: 0, notRun: {}, invalid: 0, policyBlocked: 0, failureRate: null, repeated: [] };
  const add = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  const failed = new Map<string, { id: string; steps: string[] }>();
  for (const s of plan.scenarios) {
    const r = resultOf.get(s.id);
    a.planned += s.steps.length;
    if (r && !r.valid) { a.invalid += s.steps.length; continue; }
    // 실행 안 된 행동의 원인: 시나리오가 돌지 않음 → 시작 실패 → 선행조건 실패 → 앞 행동에서 멈춤 → 검사 오류로 멈춤.
    const stoppedAt = r?.steps.find(x => x.status === 'not_executed' || x.status === 'uncertain_execution');
    const cause = !r || r.start === 'not_run' ? '시나리오 실행 안 됨' : r.start === 'failed' ? '시작 실패'
      : r.precondition === 'failed' ? '선행조건 실패' : stoppedAt ? `앞 행동(${stoppedAt.id})에서 멈춤` : r.checks.some(c => c.status === 'error') ? '검사 오류로 멈춤' : '기록 없음';
    for (const st of s.steps) {
      const x = r?.steps.find(y => y.id === st.id);
      if (!x || x.status === 'not_run') { add(a.notRun, cause.startsWith('앞 행동') ? '앞 행동에서 멈춤' : cause); continue; }
      if (x.status === 'not_executed' && x.reason === 'denied_by_app_config') { a.policyBlocked++; continue; }
      a.attempted++;
      if (x.status === 'ok') { a.completed++; continue; }
      if (x.status === 'uncertain_execution') a.uncertain++;
      else add(a.notExecuted, x.reason ?? 'unknown');
      // 같은 요소를 다른 ID로 pin한 경우도 한 대상으로 묶는다(대상 설명이 같으면 같은 대상).
      if (st.target) { const k = JSON.stringify(plan.targets?.[st.target]?.target ?? st.target); failed.set(k, { id: failed.get(k)?.id ?? st.target, steps: [...failed.get(k)?.steps ?? [], st.id] }); }
    }
  }
  a.failureRate = a.attempted ? Number(((a.attempted - a.completed) / a.attempted).toFixed(3)) : null;
  a.repeated = [...failed.values()].filter(f => f.steps.length > 1).map(f => ({ target: f.id, failures: f.steps.length, steps: f.steps }));
  return a;
}

const actionText = (a: Report['actions']) => {
  const list = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${esc(k)} ${n}`).join(', ');
  return `계획 ${a.planned} · 시도 ${a.attempted} · 완료 ${a.completed} · 미실행 ${Object.values(a.notExecuted).reduce((x, y) => x + y, 0)}${Object.keys(a.notExecuted).length ? ` (${list(a.notExecuted)})` : ''}`
    + ` · 실행 여부 불명확 ${a.uncertain} · 실행 실패율 ${a.failureRate === null ? '—' : `${(a.failureRate * 100).toFixed(1)}%`}`
    + `${Object.keys(a.notRun).length ? `. 시도하지 못한 행동: ${list(a.notRun)}` : ''}${a.invalid ? `. 무효 시나리오의 행동 ${a.invalid}개는 세지 않음` : ''}${a.policyBlocked ? `. 앱 설정이 금지해 누르지 않은 행동 ${a.policyBlocked}개(시도에 넣지 않음)` : ''}`;
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

// 보고서에 보이는 말. 내부 코드(report.json 값)는 그대로 두고 읽는 사람의 말로만 바꾼다.
const READ_TEXT: Record<string, string> = { text: '글자', value: '값', checked: '선택 상태', visible: '보임 여부', count: '개수', url: '주소', items: '항목 목록', visual: '화면' };
const OP_TEXT: Record<string, string> = { equals: '기대와 같은지', not_equals: '기대와 다른지', contains: '기대를 포함하는지', less: '기대보다 작은지', greater: '기대보다 큰지',
  same_number: '기대 문구의 숫자와 같은지', all_equal: '모든 항목이 기대와 같은지', all_contain: '모든 항목이 기대를 포함하는지', any_equal: '기대와 같은 항목이 있는지',
  any_contain: '기대를 포함한 항목이 있는지', sorted_asc: '오름차순인지', sorted_desc: '내림차순인지', satisfies: '조건을 모두 만족하는지', record: '기록' };
const SOURCE_TEXT: Record<string, string> = { requirement: '요구사항', constraint: '화면 안내 문구', inferred: '일반적인 웹 동작', observed: '시작 시점 관찰', business_rule: '업무 규칙 답변' };
const CLASS_TEXT: Record<string, string> = { passed: '통과', passed_inferred: '통과(일반 규칙)', passed_observed: '통과(시작 상태)', passed_visual: '통과(화면)', mismatch: '불일치(분류 전)',
  app_defect_candidate: '앱 결함 후보', automation_failure: '자동화 실패', uncertain: '판단 불가', not_run: '실행 안 됨', invalid: '무효', uncertain_execution: '실행 여부 불명확',
  precondition_failed: '시작 조건 준비 실패', not_applicable: '다른 페이지에 대상 없음', needs_triage: '분류 미완료', needs_visual: '시각 판정 필요', policy_blocked: '정책이 막음', write_blocked: '쓰기 차단' };
const SEVERITY: SystemLevel[] = ['bug_high', 'bug_medium', 'ui_defect', 'improvement'];
/** 미완료 사유(앞부분)별 뜻. 판정하지 못한 이유를 읽는 사람이 이해하도록 */
const INCOMPLETE_MEANING: [string, string][] = [
  ['실행 안 됨', '앞 단계가 실패해 뒤 검사를 하지 못했다.'],
  ['시작 조건 준비 실패', '검사를 시작할 화면 상태를 만들지 못했다(예: 기대한 목록·문구가 시작 화면에 없음).'],
  ['자동화 실패', '앱 문제가 아니라 자동화가 다른 요소를 누르거나 값을 잘못 읽은 것으로 판단했다. 원래 결과는 부록에 남겼다.'],
  ['AI 분류가 판단 불가', '실패 원인이 앱인지 자동화인지 증거로 가르지 못했다.'],
  ['분류 미완료', '실패 원인 분류를 끝내지 못했다.'],
  ['쓰기 차단으로 확인 불가', '앱의 저장·전송 요청을 검사 정책이 막아서, 그 뒤 화면 결과가 앱 탓인지 알 수 없다. 테스트 계정과 초기화를 준비해 쓰기 허용 실행에서 다시 확인한다.'],
  ['재현 판단 불가', '다시 실행해 같은 결과인지 확인하지 못했다.'],
  ['시각 위반 재현 판단 불가', '다시 실행한 화면으로 같은 위반인지 확인하지 못했다.'],
  ['실행 여부 불명확', '행동이 실제로 실행됐는지 확인하지 못했다.'],
  ['실제 값을 읽지 못함', '비교할 값을 화면에서 읽지 못했다.'],
  ['증거 부족', '판정에 필요한 증거(화면·기록)가 없다.'],
  ['앱 설정이 금지한 행동', '앱 설정이 막은 주소(로그아웃 등)라 실행하지 않았다.'],
];
const meaningOf = (reason: string) => INCOMPLETE_MEANING.find(([k]) => reason.startsWith(k))?.[1] ?? '';
const AUDIT_MEANING: Record<AuditFinding['kind'], string> = {
  'unnamed-control': '화면 낭독기 같은 보조 기술이 무엇을 하는 조작인지 알 수 없다(접근성).',
  'covered-control': '다른 요소가 덮고 있어 누르면 엉뚱한 요소가 눌린다.',
  'horizontal-overflow': '화면보다 넓은 내용이 있어 페이지가 가로로 밀린다.',
};
const HOLD_TEXT: [string, string][] = [
  ['같은 템플릿 다른 페이지에서 이름으로 고정한 대상이 없음', '같은 종류의 다른 페이지에 같은 이름의 요소가 없다. 페이지마다 이름이 다른 것인지(예: 상품 이름) 요소가 빠진 것인지 사람이 확인해야 한다.'],
  ['재실행에서 재현 안 됨', '처음에는 어긋났지만 다시 실행하니 같은 결과가 나오지 않았다. 간헐적인 문제일 수 있다.'],
  ['시각 위반이 재현 화면에서 보이지 않음', '처음 화면에서는 위반이 보였지만 다시 실행한 화면에서는 보이지 않았다.'],
  ['행동 실패가 재현됨', '같은 행동이 다시 실패했지만, 앱이 바뀐 것인지 결함인지 판단할 근거가 없다.'],
];
const holdText = (reason: string) => HOLD_TEXT.find(([k]) => reason.startsWith(k))?.[1] ?? reason;

/**
 * 보고서 HTML. 모든 값은 report.json에서 옮긴다(문장을 지어내지 않고, 내부 코드만 읽는 말로 바꾼다).
 * 읽는 순서 = 중요도 순서: 1쪽 한눈 요약(주요 발견) → 2쪽 검사 범위와 한계 → 발견 상세(시나리오 하나에 한 쪽)
 * → 보류·품질 점검·오류 신호·미완료(묶어서 짧게) → 부록(원자료·내부 기록). 쪽 나눔은 쪽 사이에만 두어 빈 쪽을 만들지 않는다.
 * 레이아웃은 member-05 PDF 프로토타입(표지·번호 구역·가로선 표·문제마다 한 쪽)을 참고했다.
 */
export function renderHtml(rep: Report, dir: string): string {
  const img = (path: string, alt: string) => existsSync(join(dir, path))
    ? `<img src="data:image/png;base64,${readFileSync(join(dir, path)).toString('base64')}" alt="${esc(alt)}">` : '';
  const shot = (x: ReportItem) => { const png = x.evidence.find(e => e.endsWith('.png') && !e.includes('.before.')); return png ? img(png, `${x.title} 화면`) : ''; };
  const badge = (level: SystemLevel) => `<span class="badge ${level}">${esc(LEVEL_TEXT[level])}</span>`;
  const host = (u: string) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch { return u; } };
  const pageList = (pages: string[], max = 6) => `${pages.slice(0, max).map(p => esc(host(p))).join(', ')}${pages.length > max ? ` 외 ${pages.length - max}곳` : ''}`;
  const r = rep.run;

  // 발견 하나 = 원래 시나리오 하나. 그 안에서 실패한 검사를 차례로 보인다.
  const scenarioKey = findingKey;
  const checkKey = (x: ReportItem) => x.id.slice(x.scenario.length);
  const findings = findingGroups(rep);
  const pagesOf = (items: ReportItem[]) => [...new Set(items.map(x => x.page))];
  const plainTitle = (t: string) => t.replace(' (같은 템플릿 다른 페이지)', '');
  // 발견 제목: AI가 쓴 문제 한 줄(사실 대조를 통과한 것)이 있으면 그것, 없으면 기대 동작 + 코드가 만든 실제 한 줄.
  const headlineOf = (g: ReportItem[]) => rep.headlines?.[findingKey(g[0])]?.text;

  const why = (x: ReportItem) => {
    if (!x.check) return '';
    const s = x.check.source;
    const rule = s.rule ? ruleOf(s.rule) : undefined;
    return `${esc(SOURCE_TEXT[s.kind] ?? s.kind)}${s.id ? ` ${esc(s.id)}` : ''}${rule ? `: ${esc(rule.rule)}` : ''}${s.quote ? `<br><span class="quote">“${esc(s.quote)}”</span>` : ''}`;
  };
  // 판정을 왜 이 등급으로 했는지(규칙 ID 대신 뜻으로).
  const judged = (x: ReportItem) => {
    const src = x.check?.source.kind;
    if (x.level === 'bug_high') return src === 'requirement' ? '요구사항과 다르게 동작했고, 다시 실행해도 같았다.' : '화면에서 읽은 두 값을 직접 비교해 어긋났고, 다시 실행해도 같았다.';
    if (x.level === 'bug_medium') return src === 'constraint' ? '화면 안내 문구와 다르게 동작했고, 다시 실행해도 같았다. 안내가 이 기대를 뜻하는지는 사람이 확인한다.'
      : '일반적인 웹 동작과 달랐고, 다시 실행해도 같았다. 앱이 의도적으로 다르게 만들었을 수 있어 확신 중간으로 둔다.';
    if (x.level === 'ui_defect') return '화면 조건을 위반했고 다시 실행한 화면에서도 같았다. 정보 확인이나 조작을 막는다.';
    if (x.level === 'improvement') return '화면 조건을 위반했고 다시 실행한 화면에서도 같았다. 조작을 막지는 않는다.';
    return esc(x.reason);
  };
  const repro = (x: ReportItem) => x.reproduction
    ? `<b>${esc({ reproduced: '재현됨', not_reproduced: '재현 안 됨', inconclusive: '판단 불가' }[x.reproduction.result])}</b>${x.reproduction.reasonName ? ` (${esc(x.reproduction.reasonName)})` : ''}`
    : '다시 실행하지 않음';
  const failedCheck = (items: ReportItem[], i: number, many: boolean) => {
    const x = items[0];
    const others = items.slice(1);
    return `<div class="check">
    ${many ? `<h4>실패한 검사 ${i + 1} ${badge(x.level)}</h4>` : ''}
    <table class="kv"><tr><th>왜 문제인가</th><td>${why(x)}</td></tr><tr><th>판정</th><td>${judged(x)}</td></tr></table>
    ${x.check && x.check.read !== 'visual' ? `<p class="muted">확인한 것: ${esc(x.check.target ?? '현재 주소')}의 ${esc(READ_TEXT[x.check.read] ?? x.check.read)} — ${esc(OP_TEXT[x.check.op] ?? x.check.op)}</p>
      <div class="compare"><div class="exp"><p class="label">기대</p><p>${x.check.op === 'not_equals' ? '다음 값과 달라야 함: ' : ''}${esc(x.check.expected ?? '')}</p>${x.check.expectedFromText ? `<p class="from">${esc(x.check.expectedFromText)}</p>` : ''}</div>
      <div class="act"><p class="label">실제</p><p>${esc(x.check.actual ?? '(읽지 못함)')}</p></div></div>` : ''}
    ${x.visual ? `<ol class="criteria">${x.visual.criteria.map(c => `<li>${esc(c.text)}${c.status ? ` — <b>${esc(c.status === 'met' ? '만족' : c.status === 'unmet' ? '위반' : '판단 불가')}</b>: ${esc(c.evidence)}` : ''}</li>`).join('')}</ol>${x.visual.blocksUse !== undefined ? `<p>조작을 막음: ${x.visual.blocksUse ? '예' : '아니요'}</p>` : ''}` : ''}
    <p><span class="muted">다시 실행</span> ${repro(x)}</p>
    ${others.length ? `<p class="muted">같은 검사를 다른 페이지에서도 실행한 결과 (${others.length})</p><table class="small"><tr><th>페이지</th><th>판정</th>${x.check && x.check.read !== 'visual' ? '<th>기대</th><th>실제</th>' : ''}<th>다시 실행</th></tr>${others.map(y => `<tr><td>${esc(host(y.page))}</td><td>${badge(y.level)}</td>${x.check && x.check.read !== 'visual' ? `<td>${esc(y.check?.expected ?? '')}</td><td>${esc(y.check?.actual ?? '(읽지 못함)')}</td>` : ''}<td>${repro(y)}</td></tr>`).join('')}</table>` : ''}
  </div>`;
  };
  const finding = (items: ReportItem[], n: number) => {
    const x = items[0];
    const pages = pagesOf(items);
    const checks = new Map<string, ReportItem[]>();
    for (const y of items) checks.set(checkKey(y), [...checks.get(checkKey(y)) ?? [], y]);
    const list = [...checks.values()];
    // 재현 방법은 가장 많은 행동을 거친 검사의 절차(같은 시나리오라 앞부분이 같다).
    const steps = items.reduce((a, y) => y.steps.length > a.steps.length ? y : a, x).steps;
    return `<section class="finding" id="f${n}"><div class="head">
    <p class="kicker">발견 ${n} · ${esc(x.basis === 'requirement' ? '요구사항 검사' : '자율 검사')}</p>
    <h3>${badge(x.level)} ${esc(headlineOf(items) ?? plainTitle(x.title))}</h3>
    <p class="sub">${headlineOf(items) ? `기대 동작: ${esc(plainTitle(x.title))}` : `실제: ${esc(actualLine(x))}`}</p>
    <table class="kv"><tr><th>영향 페이지</th><td>${pages.length}곳 — ${pageList(pages, 13)}</td></tr>
      ${x.preconditions.length ? `<tr><th>시작 조건</th><td>${x.preconditions.map(esc).join('<br>')}</td></tr>` : ''}</table></div>
    <h4>재현 방법</h4>
    <table class="steps">${steps.map((st, i) => `<tr><td>${i + 1}</td><td>${esc(st)}</td></tr>`).join('')}</table>
    ${list.map((c, i) => failedCheck(c, i, list.length > 1)).join('')}
    ${shot(x)}
  </section>`;
  };

  // 판단 보류: 사유별로 묶고, 그 안에서 같은 검사(시나리오)의 페이지를 모은다.
  const holdGroups = () => {
    const byReason = new Map<string, Map<string, ReportItem[]>>();
    for (const x of rep.hold) {
      const reason = holdText(x.reason);
      const m = byReason.get(reason) ?? new Map<string, ReportItem[]>();
      const k = `${scenarioKey(x)}${checkKey(x)}`;
      m.set(k, [...m.get(k) ?? [], x]);
      byReason.set(reason, m);
    }
    return [...byReason].map(([reason, m]) => `<div class="group"><p class="gtitle">${esc(reason)}</p>
      <table class="list"><tr><th>검사</th><th>페이지</th></tr>${[...m.values()].map(xs => { const pages = [...new Set(xs.map(y => y.page))]; return `<tr><td>${esc(plainTitle(xs[0].title))}${xs[0].check ? ` <span class="muted">— ${esc(xs[0].check.target ?? '현재 주소')}의 ${esc(READ_TEXT[xs[0].check.read] ?? xs[0].check.read)}</span>` : ''}</td><td>${pages.length}곳 — ${pageList(pages)}</td></tr>`; }).join('')}</table></div>`).join('');
  };
  // 품질 점검: 종류·화면별 건수와 뜻, 예시 페이지.
  const auditGroups = (list: AuditItem[]) => {
    const g = new Map<string, AuditItem[]>();
    for (const a of list) g.set(`${a.level}|${a.kind}|${a.viewport}`, [...g.get(`${a.level}|${a.kind}|${a.viewport}`) ?? [], a]);
    return [...g.values()].sort((a, b) => Number(b[0].level === 'ui_defect') - Number(a[0].level === 'ui_defect'));
  };
  const auditSummary = (list: AuditItem[]) => list.length ? `<table><tr><th class="nw">구분</th><th>종류</th><th class="nw">화면</th><th class="nw">건수</th><th>뜻</th><th>페이지</th></tr>${auditGroups(list).map(g => `<tr><td class="nw">${g[0].level === 'ui_defect' ? 'UI 결함' : '개선 제안'}</td><td class="nw">${esc(AUDIT_TEXT[g[0].kind])}</td><td class="nw">${g[0].viewport === 'mobile' ? '모바일' : '데스크톱'}</td><td class="nw">${g.length}</td><td>${esc(AUDIT_MEANING[g[0].kind])}</td><td>${pageList([...new Set(g.map(a => a.page))], 4)}</td></tr>`).join('')}</table>` : '<p class="empty">없음</p>';
  // 부록 B: 페이지별로 한 줄씩.
  const auditByPage = (list: AuditItem[]) => {
    const g = new Map<string, AuditItem[]>();
    for (const a of list) g.set(a.page, [...g.get(a.page) ?? [], a]);
    return list.length ? `<table class="small"><tr><th>페이지</th><th>구분</th><th>종류</th><th>화면</th><th>내용</th></tr>${[...g].map(([page, xs]) => xs.map((a, i) => `<tr>${i === 0 ? `<td rowspan="${xs.length}">${esc(host(page))}</td>` : ''}<td class="nw">${a.level === 'ui_defect' ? 'UI 결함' : '개선 제안'}</td><td>${esc(AUDIT_TEXT[a.kind])}</td><td class="nw">${a.viewport === 'mobile' ? '모바일' : '데스크톱'}</td><td>${esc(a.detail)}</td></tr>`).join('')).join('')}</table>` : '<p class="empty">없음</p>';
  };
  // 부록 A: 미완료 항목을 사유별로.
  const incompleteByReason = () => {
    const g = new Map<string, ReportItem[]>();
    for (const x of rep.incomplete.items) {
      const k = x.classification.class === 'automation_failure' ? '자동화 실패로 분류(원래 결과 보존)' : x.reason.replace(/\(원인 [^)]*\)/, '(앞 항목에서 멈춤)').replace(/\(unresolved[^)]*\)/, '');
      g.set(k, [...g.get(k) ?? [], x]);
    }
    return [...g].sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => `<p class="gtitle">${esc(k)} (${xs.length})</p>
      <table class="small fixed"><col style="width:9%"><col style="width:19%"><col style="width:34%"><col style="width:26%"><col style="width:12%"><tr><th>항목</th><th>검사·페이지</th><th>원래 결과</th><th>판정 사유·분류 근거</th><th>증거</th></tr>${xs.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(plainTitle(x.title))}<br><span class="muted">${esc(host(x.page))}</span></td><td>${esc(x.observed)}${x.check && x.check.read !== 'visual' && (x.check.expected !== undefined || x.check.actual !== undefined) ? `<br>기대 ${esc(x.check.expected ?? '')} / 실제 ${esc(x.check.actual ?? '(읽지 못함)')}` : ''}</td><td>${esc(x.reason)}${x.classification.reason ? `<br>${esc(x.classification.reason)}` : ''}${x.classification.error ? `<br>${esc(x.classification.error)}` : ''}${x.captureErrors ? `<br>수집 실패: ${x.captureErrors.map(esc).join('; ')}` : ''}</td><td>${x.evidence.map(esc).join('<br>') || '없음'}</td></tr>`).join('')}</table>`).join('');
  };
  const obsByPage = () => {
    const g = new Map<string, string[]>();
    for (const o of rep.observations) g.set(o.page, [...g.get(o.page) ?? [], o.note]);
    return [...g].map(([page, notes]) => `<p class="gtitle">${esc(host(page))}</p><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`).join('');
  };

  const high = rep.bugs.filter(x => x.level === 'bug_high').length;
  const pagesRun = new Set(rep.coverage.templates.flatMap(t => t.executedPages)).size;
  const tile = (n: number | string, label: string, sub = '', tone = '') => `<div class="tile ${tone}"><p class="num">${n}</p><p class="tlabel">${label}</p>${sub ? `<p class="tsub">${sub}</p>` : ''}</div>`;
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const date = r.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  // 판정 항목 전체: 버그·시각 위반·보류·판정 못 함·통과(각각 report.json 개수). 버그 아님으로 끝난 자동화 실패는 판정 못 함에 이미 들어 있다.
  const judgedTotal = rep.bugs.length + rep.visual.length + rep.hold.length + rep.incomplete.total + rep.passed.checks;
  const incompleteRate = judgedTotal ? Math.round(rep.incomplete.total / judgedTotal * 100) : 0;
  const uiDefectsAll = rep.visual.filter(x => x.level === 'ui_defect').length + rep.uiDefects.length;
  const count = (o: Record<string, number | undefined>) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${esc(LEVEL_TEXT[k as SystemLevel] ?? k)} ${n}`).join(', ') || '없음';

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>QA 보고서 ${esc(r.name)}</title><style>
    :root { --accent: #1d5e73; --ink: #1f2a30; --muted: #66757d; --line: #d9e2e7; --head: #e8eff3; --soft: #f5f8fa;
      --high: #b3261e; --medium: #c77700; --hold: #4a5bb5; --incomplete: #7a858b; --ok: #2e7d4f; --ui: #7b3fc4; }
    * { box-sizing: border-box; }
    body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; font-size: 10.5px; line-height: 1.6; color: var(--ink); margin: 0; }
    @media screen { body { max-width: 900px; margin: 0 auto; padding: 24px 28px 60px; } }
    /* 쪽 나눔은 표지 뒤와 부록 앞에만 둔다. 나머지는 이어서 흐르고, 내용 덩어리는 쪽 경계에서 쪼개지지 않게 묶는다(넘친 몇 줄만 다음 쪽에 남는 빈 쪽을 막는다). */
    .cover { break-after: page; } .appendix { break-before: page; }
    .finding { border-top: 2px solid var(--line); padding-top: 14px; margin-top: 26px; }
    .head, .check, table.steps, img, .group, table.kv { break-inside: avoid; }
    .finding h3, .finding .kicker, h4 { break-after: avoid; }
    h1 { font-size: 26px; font-weight: 400; margin: 4px 0 2px; }
    .subtitle { font-size: 13px; color: var(--accent); margin: 0 0 4px; word-break: break-all; }
    h2 { font-size: 16px; font-weight: 400; color: var(--accent); margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--line); break-after: avoid; }
    .appendix > h2:first-of-type { margin-top: 0; }
    h2 .no { font-variant-numeric: tabular-nums; margin-right: 8px; color: var(--muted); }
    h3 { font-size: 15px; font-weight: 500; margin: 2px 0 2px; line-height: 1.4; } .sub { margin: 0 0 10px; color: var(--muted); }
    h4 { font-size: 11px; color: var(--accent); margin: 14px 0 4px; font-weight: 600; break-after: avoid; }
    .kicker { font-size: 9px; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; margin: 0; }
    .note, .muted { color: var(--muted); } .note { font-size: 9.5px; } .empty { color: var(--muted); } .quote { color: var(--muted); }
    .gtitle { font-weight: 600; margin: 12px 0 4px; break-after: avoid; } .group { break-inside: avoid; }
    table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
    th { background: var(--head); color: #3d4b52; font-weight: 400; font-size: 9.5px; }
    td, th { padding: 6px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); word-break: break-word; }
    tr { break-inside: avoid; }
    table.kv th { width: 92px; background: none; color: var(--muted); }
    table.small td, table.small th { padding: 4px 6px; font-size: 9px; }
    /* 긴 원래 결과(목록 JSON 등)가 자동 너비를 차지해 나머지 열이 한 글자 폭으로 눌리지 않게 열 너비를 고정한다. */
    table.fixed { table-layout: fixed; } table.fixed td { overflow-wrap: anywhere; }
    td.nw, th.nw, table.list td:first-child { white-space: nowrap; }
    .tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 14px 0 6px; }
    .tile { border: 1px solid var(--line); border-top: 3px solid var(--accent); padding: 8px 10px; }
    .tile.high { border-top-color: var(--high); } .tile.ui { border-top-color: var(--ui); } .tile.hold { border-top-color: var(--hold); } .tile.incomplete { border-top-color: var(--incomplete); } .tile.ok { border-top-color: var(--ok); }
    .num { font-size: 22px; margin: 0; line-height: 1.2; } .tlabel { margin: 0; font-size: 10px; } .tsub { margin: 0; font-size: 9px; color: var(--muted); }
    .badge { white-space: nowrap; display: inline-block; font-size: 9px; font-weight: 400; padding: 1px 6px; border-radius: 3px; color: #fff; background: var(--incomplete); vertical-align: 2px; }
    .badge.bug_high { background: var(--high); } .badge.bug_medium { background: var(--medium); } .badge.hold { background: var(--hold); }
    .badge.ui_defect, .badge.improvement { background: var(--ui); } .badge.not_bug { background: var(--ok); }
    .check { margin-top: 10px; } .check + .check { border-top: 1px dashed var(--line); padding-top: 6px; }
    .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; }
    .compare > div { border: 1px solid var(--line); border-left: 3px solid var(--ok); padding: 6px 10px; } .compare .act { border-left-color: var(--high); }
    .compare .label { margin: 0; font-size: 9px; color: var(--muted); } .compare p { margin: 2px 0; word-break: break-all; } .compare .from { font-size: 9px; color: var(--muted); }
    table.steps td:first-child { width: 28px; color: var(--muted); }
    ol.criteria { padding-left: 18px; margin: 4px 0; }
    img { display: block; max-width: 100%; max-height: 300px; border: 1px solid var(--line); margin: 10px 0; }
    ul, ol { margin: 0; padding-left: 16px; }
    .appendix h2 { font-size: 14px; } .appendix .rec { break-inside: avoid; border-bottom: 1px solid var(--line); padding: 4px 0; font-size: 9px; word-break: break-all; }
  </style></head><body>

  <section class="sheet cover">
    <p class="kicker">WebTestPilot · QA Report${date ? ` · ${esc(date)}` : ''}</p>
    <h1>웹사이트 검사 결과 보고서</h1>
    <p class="subtitle">${esc(r.startUrl)}</p>
    <p class="note">페이지 종류 ${rep.coverage.templates.length}개 · 검사한 페이지 ${pagesRun}곳 · 쓰기 ${esc(r.scope.writes.split(' — ')[0])} · 로그인 ${esc(r.scope.login.split(' — ')[0])}${r.durationMs !== undefined ? ` · ${Math.round(r.durationMs / 60000)}분` : ''}${r.spentUsd !== undefined ? ` · $${r.spentUsd.toFixed(2)}` : ''}</p>
    <div class="tiles">
      ${tile(rep.bugs.length, '버그', `확신 높음 ${high} · 중간 ${rep.bugs.length - high}`, 'high')}
      ${tile(uiDefectsAll, 'UI 결함', `화면 판정 ${uiDefectsAll - rep.uiDefects.length} · 점검 ${rep.uiDefects.length} · 개선 제안 ${rep.visual.length - (uiDefectsAll - rep.uiDefects.length) + rep.improvements.length}`, 'ui')}
      ${tile(rep.hold.length, '판단 보류', rep.questions.length ? `질문 ${rep.questions.length}` : '', 'hold')}
      ${tile(rep.incomplete.total, '판정 못 함', '자동화 실패 포함', 'incomplete')}
      ${tile(rep.passed.checks, '통과한 검사', '실제로 완료한 검사만', 'ok')}
    </div>
    <p class="note">버그·UI 결함 수는 페이지마다 센 판정 수다. 아래 주요 발견은 같은 검사를 하나로 묶은 것이다.</p>
    <h2><span class="no">01</span>주요 발견 (${findings.length})</h2>
    ${findings.length ? `<table class="list"><tr><th>발견</th><th>판정</th><th>내용</th><th>영향</th></tr>${findings.map((g, i) => `<tr><td><a href="#f${i + 1}">발견 ${i + 1}</a></td><td>${badge(g[0].level)}</td><td>${esc(headlineOf(g) ?? plainTitle(g[0].title))}<br><span class="muted">${headlineOf(g) ? `기대 동작: ${esc(plainTitle(g[0].title))}` : `실제: ${esc(actualLine(g[0]))}`}</span>${new Set(g.map(checkKey)).size > 1 ? ` <span class="muted">(검사 ${new Set(g.map(checkKey)).size}개 실패)</span>` : ''}</td><td class="nw">${pagesOf(g).length}곳</td></tr>`).join('')}</table>` : '<p class="empty">버그·화면 결함으로 판정한 발견이 없다.</p>'}
    ${rep.uiDefects.length || rep.improvements.length ? `<p class="note">이 밖에 브라우저가 계산한 품질 점검에서 UI 결함 ${rep.uiDefects.length}건·개선 제안 ${rep.improvements.length}건이 나왔다(05).</p>` : ''}
    <p class="note">판정은 시스템 판정이다. 통과한 검사는 사이트 전체가 정상이라는 뜻이 아니며, 최종 결함 여부는 사람이 확인한다.</p>
  </section>

  <section class="sheet">
    <h2><span class="no">02</span>검사 범위와 한계</h2>
    <table class="kv">
      ${row('검사 방식', rep.coverage.requirements.length ? `주어진 요구사항 ${rep.coverage.requirements.length}개를 먼저 계획하고, 사이트를 탐색해 찾은 다른 기능도 기대 동작을 정해 실제 브라우저로 실행했다.` : '요구사항 없이 사이트를 탐색해 기능을 찾고, 찾은 기능마다 기대 동작을 정해 실제 브라우저로 실행했다.')}
      ${row('페이지 종류', `${rep.coverage.templates.length}개 (${r.endReason === 'completed' ? '발견한 종류를 모두 계획함. 실행된 페이지는 아래 표' : `일부 계획 못 함 — ${r.incompleteReasons.map(esc).join('; ') || '사유 없음'}`})`)}
      ${row('검사한 페이지', `${pagesRun}곳${rep.coverage.unvisitedLinks.length ? ` · 방문하지 않은 링크 ${rep.coverage.unvisitedLinks.length}개(부록 D)` : ''}`)}
      ${row('쓰기 요청', esc(r.scope.writes))}${row('로그인', esc(r.scope.login))}${row('초기화', esc(r.scope.reset))}
      ${row('검사하지 않은 것', '터치 전용 동작, iframe·shadow DOM 안, 앱 설정에 없는 로그인 이후 기능')}
    </table>
    <table class="list"><tr><th>페이지 종류</th><th>검사한 페이지</th></tr>
    ${rep.coverage.templates.map(t => `<tr><td>${esc(host(t.template))}${t.conversations.some(c => c.planned) ? '' : ' <span class="muted">(계획 못 함)</span>'}</td><td>${t.executedPages.length ? pageList(t.executedPages, 13) : '<span class="muted">실행된 페이지 없음</span>'}</td></tr>`).join('')}</table>
    <h4>결과를 얼마나 믿을 수 있나</h4>
    <table class="kv">
      ${row('판정 못 한 비율', `${incompleteRate}% (판정 못 함 ${rep.incomplete.total} / 전체 판정 항목 ${judgedTotal}: 버그 ${rep.bugs.length}·화면 판정 ${rep.visual.length}·보류 ${rep.hold.length}·판정 못 함 ${rep.incomplete.total}·통과 ${rep.passed.checks}) — 사유는 07`)}
      ${row('행동 실행', actionText(rep.actions))}
      ${row('증거 수집 실패', `${rep.evidenceGaps.total}건`)}
      ${row('오류 신호', `${rep.errorSignals.length - rep.normalRejections}건 (정상 거절일 수 있는 것 ${rep.normalRejections}건 별도${rep.signalsDropped ? `, 수집 상한을 넘어 버린 신호 ${rep.signalsDropped}건` : ''})`)}
    </table>
  </section>

  ${findings.length ? `<h2><span class="no">03</span>발견 상세</h2><p class="note">발견마다 구분선으로 나눈다. 재현 방법은 시작 주소부터 그 검사까지 실제로 한 행동이다. 화면 판정 (시각 판정 (${rep.visual.length})건)은 화면을 보고 조건마다 판정한 AI 판정이라 버그와 따로 센다.</p>` : ''}
  ${findings.map((g, i) => finding(g, i + 1)).join('')}

  <section class="rest">
  <h2><span class="no">04</span>판단 보류 (${rep.hold.length})</h2>
  <p class="note">결함인지 정상인지 시스템이 정하지 못해 사람의 확인이 필요한 항목이다. 사유별로 묶었다.</p>
  ${rep.hold.length ? holdGroups() : '<p class="empty">없음</p>'}
  ${rep.questions.length ? `<p class="gtitle">답을 기다리는 업무 규칙 질문 (${rep.questions.length})</p><ul>${rep.questions.map(q => `<li>${esc(q.question)} — 선택지: ${q.options.map(esc).join(' / ')}${q.overLimit ? ' (질문 한도 초과: 규칙 미확인)' : ''}</li>`).join('')}</ul>` : ''}

  <h2><span class="no">05</span>품질·사용성 점검 — UI 결함 (${rep.uiDefects.length}) · 개선 제안 (${rep.improvements.length})</h2>
  <p class="note">페이지마다 브라우저가 계산한 점검이다(AI 없음). 조작을 막으면 UI 결함, 아니면 개선 제안이며 버그와 따로 센다. 새로 열어 다시 점검해도 같았던 것만 센다. 한 줄씩은 부록 B.</p>
  ${auditSummary([...rep.uiDefects, ...rep.improvements])}
  ${rep.auditUnconfirmed.length ? `<p class="note">확인하지 못한 점검 발견 (${rep.auditUnconfirmed.length})건은 결함 건수에 넣지 않았다(부록 B).</p>` : ''}
  ${rep.auditErrors.length ? `<p>점검하지 못한 페이지: ${rep.auditErrors.map(esc).join('; ')}</p>` : ''}

  <h2><span class="no">06</span>오류 신호 (${rep.errorSignals.length})</h2><p class="note">기대값 없이 잡힌 콘솔·요청 오류다. 판정이 아니라 검토 대상이다. 401·403·422는 검사 의도대로의 거절일 수 있어 따로 표시한다.${rep.signalsDropped ? ` 단계마다 수집 상한이 있어 ${rep.signalsDropped}건은 버렸다(목록이 전부가 아니다).` : ''}</p>
  ${rep.errorSignals.length ? `<table class="small"><tr><th>종류</th><th>내용</th><th>경로</th><th>난 곳</th></tr>${rep.errorSignals.map(g => `<tr><td>${esc(g.kind)}${g.status ? ` ${g.status}` : ''}${g.normal ? ' (정상 거절일 수 있음)' : ''}</td><td>${esc(g.text)}</td><td>${esc(g.path)}</td><td>${g.at.length}곳</td></tr>`).join('')}</table>` : '<p class="empty">없음</p>'}

  <h2><span class="no">07</span>판정하지 못한 항목 (${rep.incomplete.total})</h2>
  <p class="note">끝까지 판정하지 못한 검사다. 결함이 없다는 뜻이 아니다. 항목별 목록은 부록 A.</p>
  <table><tr><th>사유</th><th class="nw">건수</th><th>뜻</th></tr>${Object.entries(rep.incomplete.byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td class="nw">${n}</td><td>${esc(meaningOf(k))}</td></tr>`).join('')}</table>
  ${rep.actions.repeated.length ? `<p class="gtitle">같은 요소에서 반복된 행동 실패</p><table class="list"><tr><th>요소</th><th>실패</th></tr>${rep.actions.repeated.map(x => `<tr><td>${esc(x.target)}</td><td>${x.failures}번</td></tr>`).join('')}</table>` : ''}
  </section>

  <section class="appendix">
  <p class="kicker">부록 · 원자료와 내부 기록</p>
  <h2>A. 판정하지 못한 항목</h2>${rep.incomplete.items.length ? incompleteByReason() : '<p class="empty">없음</p>'}
  <h2>B. 품질 점검 발견 (페이지별)</h2>${auditByPage([...rep.uiDefects, ...rep.improvements])}
  ${rep.auditUnconfirmed.length ? `<p class="gtitle">확인하지 못한 점검 발견 (${rep.auditUnconfirmed.length})</p><p class="note">다시 열어 점검했을 때 나오지 않았거나 화면이 안정되지 않았다. 결함 건수에 넣지 않는다.</p>${auditByPage(rep.auditUnconfirmed)}` : ''}
  <h2>C. 탐색 중 관찰한 이상 (${rep.observations.length})</h2>${rep.observations.length ? obsByPage() : '<p class="empty">없음</p>'}
  <h2>D. 실행 정보</h2>
  <table class="kv">
    ${row('실행', esc(r.name))}${row('허용 origin', r.origins.map(esc).join(', '))}
    ${r.models ? row('모델', `계획 ${esc(r.models.plan)}, 분류 ${esc(r.models.triage)}`) : ''}
    ${r.spentUsd !== undefined ? row('비용(추정)', `$${r.spentUsd.toFixed(2)}${r.budgetUsd ? ` / 한도 $${r.budgetUsd}` : ''} — 토큰 사용량 기준 추정`) : ''}
    ${row('판정 파일', `${esc(r.verdicts.file)} (${r.verdicts.stage === 'done' ? '판정 완료' : `판정 미완료: ${esc(r.verdicts.stage)} 단계 — 임시 결과`})${r.verdicts.later.length ? `. 이후 재판정: ${r.verdicts.later.map(l => `${esc(l.file)} ${esc(l.stage)}`).join(', ')}` : ''}`)}
    ${row('판정 집계', `요구사항 ${count(rep.system.requirement)} · 자율 ${count(rep.system.autonomous)} · 다른 페이지 실행 ${count(rep.system.variant)} · 준비 확인 ${count(rep.system.preparation)}`)}
    ${row('통과 내역', `${rep.passed.checks}개 (${Object.entries(rep.passed.byClass).map(([k, n]) => `${esc(CLASS_TEXT[k] ?? k)} ${n}`).join(', ')})`)}
    ${rep.newTabs.length ? row('새로 열린 탭', `${rep.newTabs.map(t => `${esc(t.scenario)} ${esc(t.after)} → ${esc(t.url)}`).join('<br>')}`) : ''}
    ${rep.coverage.failedUrls.length ? row('열지 못한 URL', rep.coverage.failedUrls.map(esc).join(', ')) : ''}
    ${rep.coverage.unvisitedLinks.length ? row('방문하지 않은 링크', rep.coverage.unvisitedLinks.map(u => esc(host(u))).join(', ')) : ''}
  </table>
  ${rep.coverage.requirements.length ? `<p class="gtitle">요구사항</p><table><tr><th>ID</th><th>계획</th><th>결과</th></tr>${rep.coverage.requirements.map(q => `<tr><td>${esc(q.id)}</td><td>${esc(q.plan)}</td><td>${Object.entries(q.classes).map(([k, n]) => `${esc(CLASS_TEXT[k] ?? k)} ${n}`).join(', ')}</td></tr>`).join('')}</table>` : ''}
  ${findings.length ? `<h2>E. 발견 기록</h2><p class="note">본문 발견마다 내부 기록 번호, 원래 실행 결과, 실패 원인 분류의 근거, 증거 파일 위치다. 같은 결과를 다시 확인할 때 쓴다.</p>
  ${findings.map((g, i) => g.map(x => `<div class="rec"><b>발견 ${i + 1}</b> · ${esc(x.id)} (${esc(host(x.page))}) · ${esc(LEVEL_TEXT[x.level])} · 원래 결과 ${esc(x.observed)}${x.check && x.check.read !== 'visual' ? ` · 기대 ${esc(x.check.expected ?? '')} / 실제 ${esc(x.check.actual ?? '(읽지 못함)')}` : ''} · 분류 ${esc(CLASS_TEXT[x.classification.class] ?? x.classification.class)} · 판정 ${esc(x.reason)}${x.check?.expectedFrom ? ` · 기대값 출처 ${esc(x.check.expectedFrom)}` : ''}${x.reproduction?.reason ? `<br>다시 실행: ${esc(x.reproduction.reason)}` : ''}${x.classification.reason ? `<br>분류 근거: ${esc(x.classification.reason)}` : ''}${x.captureErrors ? `<br>증거 수집 실패: ${x.captureErrors.map(esc).join('; ')}` : ''}<br>증거: ${x.evidence.map(esc).join(', ') || '없음'}${x.reproduction?.evidence ? ` · 재실행: ${x.reproduction.evidence.map(esc).join(', ')}` : ''}</div>`).join('')).join('')}` : ''}
  </section>
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
    await page.pdf({ path: join(dir, 'report.pdf'), format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#66757d;padding:0 16mm;display:flex;justify-content:space-between;font-family:'Malgun Gothic',sans-serif"><span>WebTestPilot | ${esc(report.run.name)}</span><span class="pageNumber"></span></div>` });
    return { report, pdf: join(dir, 'report.pdf') };
  } catch (e) {
    // 새 JSON·HTML과 예전 PDF가 같은 결과처럼 보이지 않게 예전 PDF를 지운다.
    rmSync(join(dir, 'report.pdf'), { force: true });
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
