// 공통 에이전트 루프. 매 호출 전에 최악의 비용을 예약하고, 도구가 done을 돌려주면 끝낸다.
// SDK tool runner 대신 수동 루프를 쓰는 이유: 호출마다 비용 예약과 제출 즉시 종료가 필요하다.
import type Anthropic from '@anthropic-ai/sdk';

export type Send = (req: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
export type ToolOutcome = { text: string; isError?: boolean; done?: unknown };
export type Tool = { def: Anthropic.Tool; run: (input: any) => Promise<ToolOutcome> };

/** USD / 100만 토큰. 2026-10-06 기준 Anthropic 1차 API 가격. 목록에 없는 모델은 호출하지 않는다. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

export class BudgetError extends Error {}

/** 실행 전체가 공유하는 비용 장부. 예약은 최악의 경우로, 정산은 실제 usage로 한다. */
export class Budget {
  spent = 0;
  readonly limitUsd: number;
  constructor(limitUsd: number) { this.limitUsd = limitUsd; }

  /** 요청의 최악 비용(입력은 UTF-8 바이트를 토큰 상한으로, 캐시 쓰기 1.25배, 출력은 max_tokens). 한도를 넘으면 BudgetError. */
  reserve(req: Anthropic.MessageCreateParamsNonStreaming): number {
    const price = PRICES[req.model];
    if (!price) throw new BudgetError(`가격을 모르는 모델: ${req.model}`);
    const inputTokens = Buffer.byteLength(JSON.stringify(req), 'utf8');
    const worst = (inputTokens * 1.25 * price.input + req.max_tokens * price.output) / 1e6;
    if (this.spent + worst > this.limitUsd) {
      throw new BudgetError(`예약 $${worst.toFixed(4)}가 남은 예산 $${(this.limitUsd - this.spent).toFixed(4)}를 넘음`);
    }
    return worst;
  }

  charge(model: string, u: Anthropic.Usage): number {
    const price = PRICES[model];
    if (!price) throw new BudgetError(`가격을 모르는 모델의 응답: ${model}`);
    const cost = (u.input_tokens * price.input + (u.cache_creation_input_tokens ?? 0) * price.input * 1.25
      + (u.cache_read_input_tokens ?? 0) * price.input * 0.1 + u.output_tokens * price.output) / 1e6;
    this.spent += cost;
    return cost;
  }
}

export type AgentResult = {
  stop: 'done' | 'no_submit' | 'max_turns' | 'budget' | 'refusal' | 'max_tokens';
  result?: unknown;
  detail?: string;
  messages: Anthropic.MessageParam[];
  turns: { request: Anthropic.MessageCreateParamsNonStreaming; response?: Anthropic.Message; reserved: number; cost?: number }[];
};

export async function runAgent(o: {
  send: Send; model: string; system: string; tools: Tool[]; user: string;
  budget: Budget; maxTurns: number; maxTokens?: number; effort?: 'low' | 'medium' | 'high';
}): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.user }];
  const turns: AgentResult['turns'] = [];
  const byName = new Map(o.tools.map(t => [t.def.name, t]));
  const end = (stop: AgentResult['stop'], extra: Partial<AgentResult> = {}): AgentResult => ({ stop, messages, turns, ...extra });

  for (let i = 0; i < o.maxTurns; i++) {
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: o.model, max_tokens: o.maxTokens ?? 16000, system: o.system,
      tools: o.tools.map(t => t.def), messages: [...messages],
      output_config: { effort: o.effort ?? 'medium' },
      cache_control: { type: 'ephemeral' },
    };
    let reserved: number;
    try { reserved = o.budget.reserve(request); } catch (e) {
      if (e instanceof BudgetError) return end('budget', { detail: e.message });
      throw e;
    }
    const turn: AgentResult['turns'][number] = { request, reserved };
    turns.push(turn);
    const response = await o.send(request);
    turn.response = response;
    turn.cost = o.budget.charge(response.model, response.usage);
    // thinking 블록을 포함한 content를 그대로 되돌려야 다음 호출이 유효하다.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return end(response.stop_reason);
    if (response.stop_reason !== 'tool_use') return end('no_submit');

    const results: Anthropic.ToolResultBlockParam[] = [];
    let done: unknown;
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      // 브라우저 상태를 공유하므로 병렬 호출도 순서대로 실행한다.
      const outcome = await runTool(byName.get(block.name), block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.text, ...(outcome.isError ? { is_error: true } : {}) });
      if (outcome.done !== undefined) done = outcome.done;
    }
    messages.push({ role: 'user', content: results });
    if (done !== undefined) return end('done', { result: done });
  }
  return end('max_turns');
}

async function runTool(tool: Tool | undefined, input: unknown): Promise<ToolOutcome> {
  if (!tool) return { text: '알 수 없는 도구', isError: true };
  try {
    return await tool.run(input);
  } catch (e) {
    return { text: `도구 오류: ${(e as Error).message.split('\n')[0]}`, isError: true };
  }
}
