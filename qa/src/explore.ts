// ① 탐색·계획. 모델은 ref로 페이지를 보고 행동하며, pin으로 대상을 고정한 뒤 submit_plan으로 계획을 낸다.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type Anthropic from '@anthropic-ai/sdk';
import { openContext, snapshot, resolveRef, resolveGroup, resolveText, type Policy } from './browser.ts';
import { validate, freeze, type Draft, type Pinned, type Plan, type Requirement } from './plan.ts';
import { runAgent, type AgentResult, type Budget, type Send, type Tool } from './agent.ts';

export const SYSTEM = readFileSync(new URL('../prompts/explore.md', import.meta.url), 'utf8');
const SNAPSHOT_CHARS = 24_000;
const ACTION_TIMEOUT = 5_000;

export type ExploreResult = AgentResult & { plan?: Plan; blocked: string[]; violations: string[] };
type Task = { policy: Policy; startUrl: string; requirements: Requirement[] };

export async function explore(o: Task & { browser: Browser; send: Send; model: string; budget: Budget; maxTurns: number }): Promise<ExploreResult> {
  assertStartAllowed(o);
  const { context, blocked, violations } = await openContext(o.browser, o.policy);
  try {
    const page = await context.newPage();
    await page.goto(o.startUrl);
    const tools = exploreTools(page, o, violations);
    const result = await runAgent({ send: o.send, model: o.model, system: SYSTEM, tools, user: taskMessage(o), budget: o.budget, maxTurns: o.maxTurns });
    return { ...result, plan: result.result as Plan | undefined, blocked, violations };
  } finally {
    await context.close();
  }
}

/** 시작 URL도 navigate와 같은 origin 정책을 따른다. */
export function assertStartAllowed(o: Task): void {
  if (!o.policy.origins.includes(new URL(o.startUrl).origin)) throw new Error(`시작 URL이 허용 origin 밖: ${o.startUrl}`);
}

/** 첫 사용자 메시지: 시작 URL, 권한, 요구사항. */
export function taskMessage(o: Task): string {
  return [
    `시작 URL: ${o.startUrl}`,
    `허용 origin: ${o.policy.origins.join(', ')} (쓰기 요청 ${o.policy.allowWrites ? '허용' : '차단'})`,
    '요구사항:',
    ...o.requirements.map(r => `- ${r.id}: ${r.text}`),
  ].join('\n');
}

/** 탐색 도구 전체. API 루프(explore)와 개발용 MCP 서버(mcp.ts)가 같은 도구를 쓴다. 계획이 통과하면 done에 Plan이 담긴다. */
export function exploreTools(page: Page, o: Task, violations: string[]): Tool[] {
  const pinned = new Map<string, Pinned>();
  return [...browserTools(page, o.policy, pinned, violations), {
    def: { name: 'submit_plan', description: '완성한 테스트 계획을 제출한다. 오류가 있으면 오류 목록이 돌아온다.', input_schema: DRAFT_SCHEMA },
    run: async (draft: Draft) => {
      if (violations.length) return { text: `정책 위반이 있어 계획을 받을 수 없다: ${violations.join(', ')}`, isError: true };
      let errors: string[];
      try { errors = validate(draft, o.requirements, pinned, o.policy.origins); } catch (e) {
        return { text: `계획 형식 오류: ${(e as Error).message}`, isError: true };
      }
      if (errors.length) return { text: `계획을 고쳐서 다시 제출하세요:\n- ${errors.join('\n- ')}`, isError: true };
      return { text: '계획을 받았습니다.', done: freeze(draft, o.requirements, pinned) };
    },
  }];
}

function browserTools(page: Page, policy: Policy, pinned: Map<string, Pinned>, violations: string[]): Tool[] {
  const after = async (what: string) =>
    `${what}. 현재 URL: ${page.url()}${violations.length ? `\n정책 위반: ${violations.join(', ')}` : ''}`;
  const ref = { type: 'string', description: 'snapshot의 ref (예: e12)' } as const;
  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[],
    run: (input: any) => Promise<string>): Tool => ({
    def: { name, description, strict: true, input_schema: { type: 'object', properties, required, additionalProperties: false } },
    run: async input => ({ text: await run(input) }),
  });

  return [
    tool('snapshot', '현재 페이지(또는 ref 영역)의 접근성 트리를 ref와 함께 읽는다.', { ref: { ...ref, description: '생략하면 페이지 전체' } }, [],
      async ({ ref }) => {
        const full = await snapshot(page, ref);
        if (full.length <= SNAPSHOT_CHARS) return full;
        for (let depth = 8; depth >= 2; depth--) {
          const part = await snapshot(page, ref, depth);
          if (part.length <= SNAPSHOT_CHARS) return `${part}\n(깊이 ${depth}까지만 표시. 자세히 볼 영역의 ref로 다시 snapshot하세요.)`;
        }
        return `${(await snapshot(page, ref, 1)).slice(0, SNAPSHOT_CHARS)}\n(너무 커서 일부만 표시. 영역 ref로 다시 snapshot하세요.)`;
      }),
    tool('navigate', '허용 origin 안의 URL로 이동한다.', { url: { type: 'string' } }, ['url'], async ({ url }) => {
      if (!policy.origins.includes(new URL(url, page.url()).origin)) throw new Error(`허용되지 않은 origin: ${url}`);
      await page.goto(new URL(url, page.url()).href);
      return after('이동함');
    }),
    tool('click', '요소를 클릭한다.', { ref }, ['ref'], async ({ ref }) => {
      await page.getByRef(ref).click({ timeout: ACTION_TIMEOUT });
      return after(`${ref} 클릭함`);
    }),
    tool('fill', '입력칸에 값을 채운다.', { ref, value: { type: 'string' } }, ['ref', 'value'], async ({ ref, value }) => {
      await page.getByRef(ref).fill(value, { timeout: ACTION_TIMEOUT });
      return after(`${ref}에 입력함`);
    }),
    tool('select', '선택 상자에서 옵션을 고른다.', { ref, value: { type: 'string', description: '옵션 라벨' } }, ['ref', 'value'],
      async ({ ref, value }) => {
        await page.getByRef(ref).selectOption({ label: value }, { timeout: ACTION_TIMEOUT });
        return after(`${ref}에서 선택함`);
      }),
    tool('press', '키를 누른다 (예: Enter, Escape, Tab).', { key: { type: 'string' } }, ['key'], async ({ key }) => {
      await page.keyboard.press(key);
      return after(`${key} 누름`);
    }),
    tool('pin', '계획에 쓸 요소를 고정하고 대상 ID(T1 등)를 받는다. 개수를 셀 요소는 group=true. '
      + 'ref가 없는 텍스트(예: "- text: 합계 100원")는 그 줄을 담은 요소의 ref와 text로 고정한다.',
      { ref, group: { type: 'boolean' }, text: { type: 'string', description: 'ref 요소 안의 텍스트 (선택)' } }, ['ref', 'group'],
      async ({ ref, group, text }) => {
        if (text !== undefined && group) throw new Error('text와 group은 함께 쓸 수 없음');
        const r = text !== undefined ? await resolveText(page, ref, text) : group ? await resolveGroup(page, ref) : await resolveRef(page, ref);
        if (!r.ok) throw new Error(`${ref}를 고정할 수 없음: ${REASONS[r.reason]}`);
        const id = `T${pinned.size + 1}`;
        pinned.set(id, { target: r.target, group, url: page.url() });
        return `${id} = ${JSON.stringify(r.target)}`;
      }),
  ];
}

const REASONS: Record<string, string> = {
  unknown_ref: '현재 snapshot에 없는 ref (페이지가 바뀌었으면 다시 snapshot)',
  unnamed: '이름·텍스트가 없어 식별할 수 없음',
  value_only: '숫자 값만 있어 값이 바뀌면 식별할 수 없음',
  ambiguous: '같은 모양의 요소와 구분되지 않음',
  text_not_found: '그 ref 요소가 직접 담은 텍스트가 아님 (- text: 줄의 바로 위 요소 ref를 쓰세요)',
};

const source = {
  type: 'object', additionalProperties: false, required: ['kind'],
  properties: { kind: { enum: ['requirement', 'observed', 'heuristic'] }, id: { type: 'string' },
    quote: { type: 'string', description: 'requirement: 요구사항 원문 인용 / heuristic: 근거가 된 일반 규칙 한 문장' } },
};
const DRAFT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object', additionalProperties: false, required: ['scenarios', 'unplanned'],
  properties: {
    scenarios: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'covers', 'start', 'steps', 'checks'],
      properties: {
        id: { type: 'string', description: 'S1, S2 ...' }, title: { type: 'string' },
        covers: { type: 'array', items: { type: 'string' } },
        start: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' } } },
        steps: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'op'],
          properties: { id: { type: 'string', description: 'S1.A1 ...' }, op: { enum: ['click', 'fill', 'select', 'press'] },
            target: { type: 'string', description: 'pin으로 받은 대상 ID' }, value: { type: 'string', description: 'fill/select 값, press 키' } } } },
        checks: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['id', 'after', 'target', 'read', 'op', 'expected', 'source'],
          properties: { id: { type: 'string', description: 'S1.C1 ...' }, after: { type: 'string', description: '"start" 또는 이 시나리오의 단계 ID' },
            target: { type: 'string' }, read: { enum: ['text', 'value', 'checked', 'visible', 'count'] },
            op: { enum: ['equals', 'contains'] }, expected: { type: 'string' }, source } } },
      } } },
    unplanned: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['requirement', 'reason'],
      properties: { requirement: { type: 'string' }, reason: { type: 'string' } } } },
  },
};
