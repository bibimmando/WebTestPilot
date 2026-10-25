// 발견 제목(M6 보고서 AI의 첫 조각): 판정이 끝난 발견마다 "무엇이 잘못됐나" 한 줄을 AI가 쓴다.
// 판정·등급·재현은 바꾸지 않는다. 제목의 숫자와 인용이 검사 기록에 그대로 있는지 코드가 대조하고, 통과한 것만 headlines.json에 남긴다.
// 통과하지 못하면 보고서는 기대 동작 + 코드가 만든 실제 한 줄을 보인다.
//
//   node src/headline.ts <실행 결과 폴더> [--model claude-sonnet-5-5] [--budget 1]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Budget, runAgent, type Send, type Tool } from './agent.ts';
import { buildReport, findingGroups, findingKey, actualLine, type Headlines, type ReportItem } from './report.ts';

const SYSTEM = readFileSync(new URL('../prompts/headline.md', import.meta.url), 'utf8');
const MAX_LEN = 60;

/** 모델에 주는 사실: 기대 동작, 재현 절차, 실패한 검사의 기대·실제·분류 근거·화면 조건. 증거 파일·이미지는 주지 않는다 */
export function headlineFacts(items: ReportItem[]): string {
  const x = items[0];
  const steps = items.reduce((a, y) => y.steps.length > a.steps.length ? y : a, x).steps;
  const byCheck = new Map<string, ReportItem>();
  for (const y of items) if (!byCheck.has(y.id.slice(y.scenario.length))) byCheck.set(y.id.slice(y.scenario.length), y);
  const cut = (s = '', n = 400) => s.length > n ? `${s.slice(0, n)}…` : s;
  return [
    `기대 동작(계획의 시나리오 제목): ${x.title.replace(' (같은 템플릿 다른 페이지)', '')}`,
    `영향 페이지: ${new Set(items.map(y => y.page)).size}곳`,
    `재현 절차:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `실패한 검사:\n${[...byCheck.values()].map(y => [
      `- ${actualLine(y)}`,
      y.check && y.check.read !== 'visual' ? `  대상: ${y.check.target ?? '현재 주소'} / 읽은 것: ${y.check.read} / 비교: ${y.check.op} / 기대: ${cut(y.check.expected)} / 실제: ${cut(y.check.actual ?? '(읽지 못함)')}` : '',
      ...(y.visual?.criteria.map(c => `  화면 조건: ${c.text} — ${c.status === 'unmet' ? '위반' : c.status === 'met' ? '만족' : '판단 불가'}${c.evidence ? `: ${cut(c.evidence, 300)}` : ''}`) ?? []),
      y.classification.reason ? `  분류 근거: ${cut(y.classification.reason)}` : '',
    ].filter(Boolean).join('\n')).join('\n')}`,
  ].join('\n');
}

/** 제목 대조: 한 줄·길이, 숫자와 따옴표 인용이 사실 글에 그대로 있어야 한다. 틀린 점 목록(비면 통과) */
export function checkHeadline(text: string, facts: string): string[] {
  const errors: string[] = [];
  const t = text.trim();
  if (!t || /\n/.test(t)) errors.push('한 줄로 쓰세요');
  if (t.length > MAX_LEN) errors.push(`${MAX_LEN}자 이내로 줄이세요(지금 ${t.length}자)`);
  const nums = new Set(facts.match(/\d+(?:[.,]\d+)*/g) ?? []);
  for (const n of t.match(/\d+(?:[.,]\d+)*/g) ?? []) if (!nums.has(n)) errors.push(`숫자 ${n}은 기록에 없습니다`);
  for (const m of t.matchAll(/["“'‘]([^"”'’]+)["”'’]/g)) if (!facts.includes(m[1])) errors.push(`인용 "${m[1]}"은 기록에 그대로 없습니다`);
  return errors;
}

/** 발견마다 제목을 쓰고 headlines.json(통과한 것)과 headlines-log.json(모든 시도)을 남긴다. 실패해도 보고서는 만들어진다 */
export async function writeHeadlines(o: { dir: string; send: Send; model: string; budget: Budget; maxItems?: number }): Promise<Headlines> {
  const groups = findingGroups(buildReport(o.dir)).slice(0, o.maxItems ?? 40);
  const out: Headlines = {};
  const log: { key: string; stop: string; detail?: string; text?: string; cost: number }[] = [];
  for (const items of groups) {
    const facts = headlineFacts(items);
    let accepted: string | undefined;
    const tool: Tool = {
      def: { name: 'headline', description: '발견 제목 한 줄을 제출한다.', strict: true, input_schema: {
        type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } } },
      run: async (input: { text: string }) => {
        const errors = checkHeadline(input.text, facts);
        if (errors.length) return { text: `고쳐서 다시 제출하세요:\n- ${errors.join('\n- ')}`, isError: true };
        accepted = input.text.trim();
        return { text: '받았습니다.', done: true };
      },
    };
    const r = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools: [tool], user: facts, budget: o.budget, maxTurns: 3, maxTokens: 2000, effort: 'low' });
    const key = findingKey(items[0]);
    if (accepted) out[key] = { text: accepted, model: o.model };
    log.push({ key, stop: accepted ? 'done' : r.stop, ...(r.detail ? { detail: r.detail } : {}), ...(accepted ? { text: accepted } : {}), cost: r.turns.reduce((a, t) => a + (t.cost ?? 0), 0) });
    if (r.stop === 'budget') break;
  }
  writeFileSync(join(o.dir, 'headlines.json'), JSON.stringify(out, null, 2));
  writeFileSync(join(o.dir, 'headlines-log.json'), JSON.stringify(log, null, 2));
  return out;
}

if (import.meta.main) {
  const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { model: { type: 'string', default: 'claude-sonnet-5-5' }, budget: { type: 'string', default: '1' } } });
  const dir = positionals[0];
  if (!dir || !(Number(a.budget) > 0)) { console.error('사용법: node src/headline.ts <실행 결과 폴더> [--model claude-sonnet-5-5] [--budget 1]'); process.exit(2); }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // 키는 환경변수 또는 저장소 루트 .env(cli.ts와 같은 규칙). 값은 출력하지 않는다.
  const env = join(import.meta.dirname, '..', '..', '.env');
  const apiKey = process.env.ANTHROPIC_API_KEY ?? (existsSync(env) ? readFileSync(env, 'utf8').match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1] : undefined);
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없다 (환경변수 또는 루트 .env)');
  const client = new Anthropic({ apiKey });
  const budget = new Budget(Number(a.budget));
  const h = await writeHeadlines({ dir, send: req => client.messages.create(req), model: a.model!, budget });
  console.log(`제목 ${Object.keys(h).length}개 · 비용(추정) $${budget.spent.toFixed(4)} → ${join(dir, 'headlines.json')}`);
  console.log('보고서를 다시 만들려면: node src/report.ts', dir);
}
