// 시각 판정 (설계 4단계 "시각 판정 응답 구조"·"시각 후보의 재현", member-02 판정 모듈에서 가져온 설계).
// 계산할 수 없는 화면 판단(read visual)을 AI가 조건마다 met·unmet·unknown과 근거로 답하고, 판정은 코드가 정한다.
// 코드는 판정을 낮추기만 한다: 하나라도 unknown이면 증거 부족, 근거 있는 unmet이 있을 때만 후보, 모두 met일 때만 통과.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { criteriaOf, type Plan } from './plan.ts';
import { ruleOf } from './rules.ts';
import type { RunResult } from './run.ts';
import type { VisualShot } from './reconcile.ts';
import { runAgent, type Budget, type Send, type Tool } from './agent.ts';
import type { ReproReason, Verdict } from './triage.ts';

const SYSTEM = readFileSync(new URL('../prompts/visual.md', import.meta.url), 'utf8');
const MIN_EVIDENCE = 6;

export type CriterionStatus = 'met' | 'unmet' | 'unknown';
export type VisualAssessment = { criteria: { n: number; status: CriterionStatus; evidence: string }[]; blocks_use: boolean; summary: string };
/** 판정 기록: 조건 문장, 모델 응답 원문, 코드가 낸 결과와 낮춘 사유, 재현 비교 */
export type VisualRecord = { criteria: string[]; shot: VisualShot; assessment?: VisualAssessment; decision?: string;
  replay?: { shot?: VisualShot; criteria?: { n: number; same: 'yes' | 'no' | 'unknown'; evidence: string }[]; log?: string } };

/** 모델 응답 → 분류. 조건 하나라도 판단 불가면 증거 부족이고, 위반 근거가 있을 때만 후보다. */
export function decide(a: VisualAssessment): { class: Verdict['class']; decision: string } {
  const unknown = a.criteria.filter(c => c.status === 'unknown').map(c => c.n);
  const unmet = a.criteria.filter(c => c.status === 'unmet').map(c => c.n);
  if (unmet.length) return { class: 'app_defect_candidate', decision: `조건 ${unmet.join(', ')} 위반${unknown.length ? `(조건 ${unknown.join(', ')}는 판단 불가)` : ''}` };
  if (unknown.length) return { class: 'uncertain', decision: `증거 부족: 조건 ${unknown.join(', ')}를 화면에서 판단할 수 없음` };
  return { class: 'passed_visual', decision: '모든 조건 충족' };
}

/** 조건 번호가 빠짐없이 한 번씩 있고, met·unmet에는 화면에서 본 근거가 있어야 받는다. */
export function checkAssessment(a: VisualAssessment, count: number): string[] {
  const errors: string[] = [];
  const ns = a.criteria.map(c => c.n).sort((x, y) => x - y);
  if (ns.length !== count || ns.some((n, i) => n !== i + 1)) errors.push(`조건 1~${count}을 한 번씩 답해야 함 (받은 번호: ${ns.join(', ') || '없음'})`);
  for (const c of a.criteria) {
    if (c.status !== 'unknown' && c.evidence.replace(/\s/g, '').length < MIN_EVIDENCE) errors.push(`조건 ${c.n}: ${c.status}에는 화면에서 본 근거(${MIN_EVIDENCE}자 이상)가 필요함. 볼 수 없으면 unknown`);
  }
  return errors;
}

const ASSESS: Anthropic.Tool = { name: 'visual_assessment', strict: true, description: '조건마다 판단과 근거를 제출한다.', input_schema: {
  type: 'object', additionalProperties: false, required: ['criteria', 'blocks_use', 'summary'], properties: {
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'status', 'evidence'], properties: {
      n: { type: 'integer', description: '조건 번호(1부터)' }, status: { enum: ['met', 'unmet', 'unknown'] },
      evidence: { type: 'string', description: '이미지에서 본 사실(위치·글자·겹친 요소). 볼 수 없으면 그 이유' } } } },
    blocks_use: { type: 'boolean', description: '위반이 정보 확인이나 조작을 실제로 막는가' },
    summary: { type: 'string' } } } };

type Same = 'yes' | 'no' | 'unknown';
type Replay = { criteria: { n: number; same: Same; evidence: string }[] };
const REPLAY: Anthropic.Tool = { name: 'replay_assessment', strict: true, description: '최초 화면의 위반 조건마다 재현 화면에도 보이는지 제출한다.', input_schema: {
  type: 'object', additionalProperties: false, required: ['criteria'], properties: {
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'same', 'evidence'], properties: {
      n: { type: 'integer', description: '위반 조건 번호' },
      same: { enum: ['yes', 'no', 'unknown'], description: 'yes: 같은 위반이 다시 보임, no: 재현 화면에서는 위반이 없음, unknown: 판단 불가' },
      evidence: { type: 'string' } } } } } } };

/** 위반 조건마다의 재현 답 → 재현 결과. 모든 조건이 다시 보여야 재현됨, 모두 사라져야 재현 안 됨, 섞이거나 판단 불가면 판단 불가. */
export function replayResult(r: Replay): { reproduction: NonNullable<Verdict['reproduction']>; detail: string; reason?: ReproReason } {
  const by = (s: Same) => r.criteria.filter(c => c.same === s).map(c => c.n);
  const text = r.criteria.map(c => `조건 ${c.n} ${c.same}: ${c.evidence}`).join('; ');
  if (by('yes').length === r.criteria.length) return { reproduction: 'reproduced', detail: `같은 위반이 다시 보임 — ${text}` };
  if (by('no').length === r.criteria.length) return { reproduction: 'flaky', detail: `재현 화면에서는 위반이 없음 — ${text}` };
  return { reproduction: 'reproduction_inconclusive', reason: 'unclear', detail: `위반 조건마다 재현 결과가 다르거나 판단 불가 — ${text}` };
}

const image = (path: string): Anthropic.ImageBlockParam =>
  ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(path).toString('base64') } });

const checkOf = (plan: Plan, id: string) => plan.scenarios.flatMap(s => s.checks).find(c => c.id === id)!;

/** needs_visual 항목마다 별도 대화로 판정한다. 촬영 이미지가 없으면 판정하지 않고 증거 부족으로 남긴다. */
export async function judgeVisual(o: { plan: Plan; run: RunResult; verdicts: Verdict[]; send: Send; model: string; budget: Budget;
  logDir: string; concurrency?: number; onUpdate?: () => void }): Promise<void> {
  const queue = o.verdicts.filter(v => v.class === 'needs_visual');
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 1) }, async () => {
    for (let v = queue.shift(); v; v = queue.shift()) { await one(v); o.onUpdate?.(); }
  }));

  async function one(v: Verdict) {
    const c = checkOf(o.plan, v.id);
    const s = o.plan.scenarios.find(x => x.id === v.scenario)!;
    const shot = o.run.scenarios.find(x => x.id === v.scenario)?.checks.find(x => x.id === v.id)?.visual;
    const criteria = criteriaOf(c.expected ?? '') ?? [];
    // 계획 검증을 거치지 않은 조건 없는 검사는 빈 조건으로 "모두 충족"이 되므로 판정하지 않는다.
    if (!criteria.length) { v.class = 'uncertain'; v.triage = { error: '시각 검사의 조건을 읽을 수 없음' }; return; }
    if (!shot || !existsSync(join(o.run.runDir, shot.image))) {
      v.class = 'uncertain';
      v.triage = { error: '증거 부족: 시각 검사 촬영 이미지가 없음' };
      return;
    }
    v.visual = { criteria, shot };
    // 로딩·전환 중에 찍은 화면의 가림·빈칸을 결함으로 만들지 않는다. 판정 모델도 부르지 않는다.
    if (shot.ready === false) {
      v.class = 'uncertain';
      v.triage = { error: '증거 부족: 기한 안에 화면이 멈추지 않은 상태에서 촬영함' };
      return;
    }
    let accepted: VisualAssessment | undefined;
    const tool: Tool = { def: ASSESS, run: async (a: VisualAssessment) => {
      const errors = checkAssessment(a, criteria.length);
      if (errors.length) return { text: `고쳐서 다시 제출하세요:\n- ${errors.join('\n- ')}`, isError: true };
      accepted = a;
      return { text: '받았습니다.', done: true };
    } };
    const rule = ruleOf(c.source.rule);
    const user: Anthropic.ContentBlockParam[] = [{ type: 'text', text: [
      `시나리오 ${s.id}: ${s.title}`,
      `검사 ${c.id}: 아래 화면이 다음 조건을 모두 만족하는지 조건마다 판단하세요.`,
      ...criteria.map((t, i) => `${i + 1}. ${t}`),
      `근거 종류: ${c.source.kind}${c.source.quote ? ` — ${c.source.quote}` : ''}`,
      ...(rule ? [`일반 규칙 ${rule.id}: ${rule.rule}. 정상 예외: ${rule.exceptions ?? '없음'}`] : []),
      `화면 크기 ${JSON.stringify(shot.viewport)}, 스크롤 ${JSON.stringify(shot.scroll)}${shot.box ? `, 검사 대상 위치(화면 기준 px) ${JSON.stringify(shot.box)}` : ', 대상 없음(화면 전체)'}`,
      '이미지는 그 시점의 보이는 영역 스크린샷입니다.',
    ].join('\n') }, image(join(o.run.runDir, shot.image))];
    const result = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools: [tool], user, budget: o.budget, maxTurns: 3, maxTokens: 4000 });
    v.triageLog = log(o.run.runDir, o.logDir, v.id, result);
    if (!accepted) {
      v.class = 'uncertain';
      v.triage = { error: `시각 판정 미완료: ${result.stop}${result.detail ? ` (${result.detail})` : ''}` };
      return;
    }
    const d = decide(accepted);
    v.class = d.class;
    v.visual = { criteria, shot, assessment: accepted, decision: d.decision };
    v.triage = { reason: `${d.decision}. ${accepted.summary}`, quotes: [] };
  }
}

/**
 * 시각 후보의 재현. 재실행이 같은 화면 크기·스크롤 위치에서 촬영됐을 때만, 최초와 재현 이미지를 함께 보내 같은 위반이 다시 보이는지 묻는다.
 * 실행 코드·무효·선행조건 같은 공통 재현 조건은 reproduce()가 먼저 판단한다(그때는 reproduction이 이미 정해져 있다).
 */
export async function replayVisual(o: { plan: Plan; first: RunResult; again: RunResult | undefined; verdicts: Verdict[]; send: Send; model: string; budget: Budget; logDir: string }): Promise<void> {
  for (const v of o.verdicts) {
    if (!v.visual?.assessment || v.class !== 'app_defect_candidate' || v.reproduction) continue;
    const inconclusive = (detail: string, reason: ReproReason = 'execution_incomplete') => { v.reproduction = 'reproduction_inconclusive'; v.reproductionReason = reason; v.reproductionDetail = detail; };
    const second = o.again?.scenarios.find(x => x.id === v.scenario)?.checks.find(x => x.id === v.id);
    if (!o.again || !second) { inconclusive('재실행 결과 없음'); continue; }
    if (second.status !== 'visual_pending' || !second.visual || !existsSync(join(o.again.runDir, second.visual.image))) { inconclusive(`재실행에서 촬영하지 못함(${second.status})`); continue; }
    const first = v.visual.shot;
    v.visual.replay = { shot: second.visual };
    if (JSON.stringify(first.viewport) !== JSON.stringify(second.visual.viewport) || JSON.stringify(first.scroll) !== JSON.stringify(second.visual.scroll)) {
      inconclusive(`화면 크기·스크롤 위치가 최초와 다름(최초 ${JSON.stringify([first.viewport, first.scroll])}, 재실행 ${JSON.stringify([second.visual.viewport, second.visual.scroll])})`, 'view_differs');
      continue;
    }
    if (second.visual.ready === false) { inconclusive('재실행에서 화면이 멈추기 전에 촬영함'); continue; }
    const unmet = v.visual.assessment.criteria.filter(c => c.status === 'unmet');
    let answer: Replay | undefined;
    const tool: Tool = { def: REPLAY, run: async (a: Replay) => {
      const want = unmet.map(c => c.n).join(','), got = a.criteria.map(c => c.n).sort((x, y) => x - y).join(',');
      if (want !== got) return { text: `위반 조건 ${want}마다 한 번씩 답해야 함 (받은 번호: ${got || '없음'})`, isError: true };
      if (a.criteria.some(c => c.same !== 'unknown' && c.evidence.replace(/\s/g, '').length < MIN_EVIDENCE)) return { text: `yes·no에는 재현 화면에서 본 근거(${MIN_EVIDENCE}자 이상)가 필요함`, isError: true };
      answer = a;
      return { text: '받았습니다.', done: true };
    } };
    const user: Anthropic.ContentBlockParam[] = [{ type: 'text', text: [
      `검사 ${v.id}. 첫 이미지는 최초 실행, 둘째 이미지는 같은 시작 조건·같은 화면 크기·같은 스크롤 위치에서 다시 실행한 화면입니다.`,
      '최초 실행에서 판단한 위반:',
      ...unmet.map(c => `${c.n}. ${v.visual!.criteria[c.n - 1]} — ${c.evidence}`),
      '위반 조건마다 재현 화면에도 같은 위반이 보이는지 답하세요. 표시된 내용(이름·숫자)이 달라도 같은 위반이면 yes입니다.',
    ].join('\n') }, image(join(o.first.runDir, first.image)), image(join(o.again.runDir, second.visual.image))];
    const result = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools: [tool], user, budget: o.budget, maxTurns: 3, maxTokens: 2000 });
    v.visual.replay.log = log(o.first.runDir, o.logDir, `${v.id}.replay`, result);
    if (!answer) { inconclusive(`재현 비교 미완료: ${result.stop}`); continue; }
    v.visual.replay.criteria = answer.criteria;
    const res = replayResult(answer);
    v.reproduction = res.reproduction;
    v.reproductionDetail = res.detail;
    if (res.reason) v.reproductionReason = res.reason;
  }
}

function log(runDir: string, dir: string, id: string, result: Awaited<ReturnType<typeof runAgent>>): string {
  mkdirSync(join(runDir, dir), { recursive: true });
  const path = `${dir}/${id}.visual.json`;
  // 이미지 base64는 기록에서 뺀다(증거 파일로 이미 있다).
  writeFileSync(join(runDir, path), JSON.stringify({ stop: result.stop, detail: result.detail, turns: result.turns },
    function (this: { type?: string }, k, val) { return k === 'data' && this?.type === 'base64' ? '(이미지 생략)' : val; }, 2));
  return path;
}
