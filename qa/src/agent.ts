// 공통 에이전트 루프. 매 호출 전에 최악의 비용을 예약하고, 도구가 done을 돌려주면 끝낸다.
// SDK tool runner 대신 수동 루프를 쓰는 이유: 호출마다 비용 예약과 제출 즉시 종료가 필요하다.
import type Anthropic from '@anthropic-ai/sdk';

export type Send = (req: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
/** stall: 탐색이 정체돼 대화를 끝낼 때 그 사유(완료가 아니라 미완료 사유로 남는다). */
/** image: 도구 결과에 붙일 PNG(base64). 탐색의 screenshot 도구가 쓴다 */
export type ToolOutcome = { text: string; isError?: boolean; done?: unknown; stall?: string; image?: string };
export type Tool = { def: Anthropic.Tool; run: (input: any) => Promise<ToolOutcome> };

type Rate = { input: number; output: number; cacheRead?: number };
type Price = Rate & { over100k?: Rate };

/**
 * USD / 100만 토큰. 2026-10-06 기준 Anthropic 1차 API 가격. 목록에 없는 모델은 호출하지 않는다.
 * cacheRead가 없으면 입력 단가의 0.1배로 본다.
 */
export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  // 프롬프트가 10만 토큰을 넘으면 그 요청 전체가 높은 구간 가격이다.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, over100k: { input: 0.5, output: 2.5 } },
};

/** 이미지 한 장의 입력 토큰 상한. 고해상도 이미지 지원 모델의 최대치(약 4,800)를 넉넉히 덮는다 */
export const IMAGE_TOKENS = 5000;

const tier = (p: Price, promptTokens: number): Rate => (p.over100k && promptTokens > 100_000 ? p.over100k : p);

export class BudgetError extends Error {}

/** 실행 전체가 공유하는 비용 장부. 예약액은 정산 전까지 점유하고, 정산은 실제 usage로 한다. */
export class Budget {
  spent = 0;
  held = 0;
  /** 이 금액은 예약에 쓰지 않는다(탐색 중 분류·재현 몫을 남길 때). */
  floorUsd = 0;
  readonly limitUsd: number;
  /** 응답을 기다리는 호출 수와, 그 호출이 끝나기를 기다리는 예약 */
  private inflight = 0;
  private waiters: (() => void)[] = [];
  constructor(limitUsd: number) { this.limitUsd = limitUsd; }

  /** 요청의 최악 비용(입력은 UTF-8 바이트를 토큰 상한으로, 5분 캐시 쓰기 1.25배, 출력은 max_tokens)을 점유한다. 한도를 넘으면 BudgetError. */
  reserve(req: Anthropic.MessageCreateParamsNonStreaming): number {
    if (!PRICES[req.model]) throw new BudgetError(`가격을 모르는 모델: ${req.model}`);
    // 이미지는 base64 길이가 아니라 장당 토큰 상한으로 센다(바이트로 세면 수십 배 과대 예약된다).
    let images = 0;
    const text = JSON.stringify(req, function (this: { type?: string }, k, v) { return k === 'data' && this?.type === 'base64' ? (images++, '') : v; });
    const inputTokens = Buffer.byteLength(text, 'utf8') + images * IMAGE_TOKENS;
    const price = tier(PRICES[req.model], inputTokens);
    const worst = (inputTokens * 1.25 * price.input + req.max_tokens * price.output) / 1e6;
    const left = this.limitUsd - this.spent - this.held - this.floorUsd;
    if (worst > left) throw new BudgetError(`예약 $${worst.toFixed(4)}가 남은 예산 $${left.toFixed(4)}를 넘음`);
    this.held += worst;
    this.inflight++;
    return worst;
  }

  /**
   * 동시에 도는 다른 호출의 예약 때문에 모자라면 그 호출이 끝날 때까지 기다렸다가 다시 예약한다.
   * 기다리는 호출이 없으면(순차 실행·실제 소진) reserve처럼 바로 BudgetError다.
   */
  async reserveWhenFree(req: Anthropic.MessageCreateParamsNonStreaming): Promise<number> {
    for (;;) {
      try { return this.reserve(req); } catch (e) {
        if (!(e instanceof BudgetError) || this.inflight === 0 || !PRICES[req.model]) throw e;
        await new Promise<void>(res => this.waiters.push(res));
      }
    }
  }

  /** 실패한 호출: 청구됐을 수 있어 예약액은 계속 점유하고, 응답 대기에서만 뺀다. */
  abandon(): void { this.settled(); }

  private settled(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    for (const w of this.waiters.splice(0)) w();
  }

  /** 실제 사용량으로 정산하고 점유했던 예약액을 놓는다. */
  charge(model: string, u: Anthropic.Usage, reserved = 0): number {
    this.held = Math.max(0, this.held - reserved);
    this.settled();
    if (!PRICES[model]) throw new BudgetError(`가격을 모르는 모델의 응답: ${model}`);
    const created = u.cache_creation_input_tokens ?? 0;
    const created1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    const price = tier(PRICES[model], u.input_tokens + created + read);
    const cost = (u.input_tokens * price.input + (created - created1h) * price.input * 1.25 + created1h * price.input * 2
      + read * (price.cacheRead ?? price.input * 0.1) + u.output_tokens * price.output) / 1e6;
    this.spent += cost;
    return cost;
  }
}

export type AgentResult = {
  stop: 'done' | 'no_submit' | 'max_turns' | 'budget' | 'stalled' | 'refusal' | 'max_tokens' | 'error';
  result?: unknown;
  detail?: string;
  messages: Anthropic.MessageParam[];
  turns: { request: Anthropic.MessageCreateParamsNonStreaming; response?: Anthropic.Message; reserved: number; cost?: number }[];
};

export async function runAgent(o: {
  send: Send; model: string; system: string; tools: Tool[]; user: string | Anthropic.ContentBlockParam[];
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
    try { reserved = await o.budget.reserveWhenFree(request); } catch (e) {
      if (e instanceof BudgetError) return end('budget', { detail: e.message });
      throw e;
    }
    const turn: AgentResult['turns'][number] = { request, reserved };
    turns.push(turn);
    let response: Anthropic.Message;
    try {
      response = await o.send(request);
      turn.response = response;
      turn.cost = o.budget.charge(response.model, response.usage, reserved);
    } catch (e) {
      // 호출 실패도 그때까지의 기록과 함께 돌려준다. 실패한 호출의 예약액은 청구 가능성이 있으므로 놓지 않는다.
      if (turn.cost === undefined && !turn.response) o.budget.abandon();
      return end('error', { detail: (e as Error).message });
    }
    if (response.model !== request.model) return end('error', { detail: `요청과 다른 모델이 응답함: ${response.model}` });
    // thinking 블록을 포함한 content를 그대로 되돌려야 다음 호출이 유효하다.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'pause_turn') continue;
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return end(response.stop_reason);
    if (response.stop_reason === 'end_turn') return end('no_submit');
    if (response.stop_reason !== 'tool_use') return end('error', { detail: `stop_reason ${response.stop_reason}` });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      // 브라우저 상태를 공유하므로 병렬 호출도 순서대로 실행한다.
      const outcome = await runTool(byName.get(block.name), block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, ...(outcome.isError ? { is_error: true } : {}),
        content: outcome.image ? [{ type: 'text', text: outcome.text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: outcome.image } }] : outcome.text });
      // 제출이 통과하면 같은 응답의 나머지 도구는 실행하지 않는다 (제출 뒤 행동이 계획 상태를 바꾸지 않도록).
      if (outcome.done !== undefined) {
        messages.push({ role: 'user', content: results });
        return end('done', { result: outcome.done });
      }
      if (outcome.stall) {
        messages.push({ role: 'user', content: results });
        return end('stalled', { detail: outcome.stall });
      }
    }
    // 남은 턴을 알려 준다. 모르면 마지막에야 제출해 거부된 계획을 고칠 턴이 남지 않는다(Maison 실측 2026-10-16).
    const left = o.maxTurns - i - 1;
    const notice: Anthropic.TextBlockParam[] = left <= Math.max(5, Math.floor(o.maxTurns * 0.2))
      ? [{ type: 'text', text: `남은 턴: ${left}번. 제출이 거부되면 고칠 턴도 필요하니 지금 작업을 마무리해 제출하세요.` }] : [];
    messages.push({ role: 'user', content: [...results, ...notice] });
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
