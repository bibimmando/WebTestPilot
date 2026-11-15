// 공통 에이전트 루프. 매 호출 전에 최악의 비용을 예약하고, 도구가 done을 돌려주면 끝낸다.
// SDK tool runner 대신 수동 루프를 쓰는 이유: 호출마다 비용 예약과 제출 즉시 종료가 필요하다.
import type Anthropic from '@anthropic-ai/sdk';

export type Send = (req: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
/** stall: 탐색이 정체돼 대화를 끝낼 때 그 사유(완료가 아니라 미완료 사유로 남는다). */
/** image: 도구 결과에 붙일 PNG(base64). 탐색의 screenshot 도구가 쓴다 */
export type ToolOutcome = { text: string; isError?: boolean; done?: unknown; stall?: string; image?: string };
/** turnsLeft: 이 응답 뒤에 남은 모델 턴 수 */
export type Tool = { def: Anthropic.Tool; run: (input: any, ctx?: { turnsLeft: number; maxTurns: number }) => Promise<ToolOutcome> };

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

/** 요청(또는 그 일부)의 입력 토큰 상한: UTF-8 바이트 수. 이미지는 base64 길이가 아니라 장당 토큰 상한으로 센다(바이트로 세면 수십 배 과대 예약된다). */
export function upperTokens(x: unknown): number {
  let images = 0;
  const text = JSON.stringify(x, function (this: { type?: string }, k, v) { return k === 'data' && this?.type === 'base64' ? (images++, '') : v; });
  return Buffer.byteLength(text, 'utf8') + images * IMAGE_TOKENS;
}

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

  /**
   * 요청의 최악 비용(입력 토큰 상한 × 5분 캐시 쓰기 1.25배, 출력은 max_tokens)을 점유한다. 한도를 넘으면 BudgetError.
   * 입력 토큰 상한은 UTF-8 바이트다. 호출한 쪽이 더 좁은 상한(inputTokens, 앞 응답의 실제 토큰 + 그 뒤 더한 내용의 바이트)을 알면 그것을 쓴다.
   */
  reserve(req: Anthropic.MessageCreateParamsNonStreaming, inputTokens = upperTokens(req)): number {
    if (!PRICES[req.model]) throw new BudgetError(`가격을 모르는 모델: ${req.model}`);
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
  async reserveWhenFree(req: Anthropic.MessageCreateParamsNonStreaming, inputTokens?: number): Promise<number> {
    for (;;) {
      try { return this.reserve(req, inputTokens); } catch (e) {
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
  /** 글로만 답했거나 글이 잘렸을 때 한 번 제출을 다시 요청한다(제출 도구 하나뿐인 대화용) */
  nudge?: boolean;
  /** 일시적 실패 뒤 다시 보낼 때까지 기다리는 시간(테스트용으로 줄인다) */
  retryDelaysMs?: number[];
}): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.user }];
  const turns: AgentResult['turns'] = [];
  const byName = new Map(o.tools.map(t => [t.def.name, t]));
  let nudged = false;
  /** 앞 응답까지의 실제 토큰(입력+출력)과 그때의 메시지 수. 다음 예약의 입력 상한을 좁히는 데 쓴다 */
  let known: { tokens: number; messages: number } | undefined;
  const end = (stop: AgentResult['stop'], extra: Partial<AgentResult> = {}): AgentResult => ({ stop, messages, turns, ...extra });

  for (let i = 0; i < o.maxTurns; i++) {
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      // 도구 정의·시스템 프롬프트는 대화마다 같다. 그 끝에 캐시 지점을 따로 두어 다음 대화(페이지 종류별 탐색, 분류)가 읽기 가격으로 다시 쓴다.
      // 대화 끝 지점(cache_control)만 있으면 새 대화의 첫 호출은 이 공통 앞부분을 매번 새로 쓴다(toolshop 11/10: 대화 7개 모두 첫 호출 캐시 읽기 0, 약 1.2만 토큰 쓰기).
      model: o.model, max_tokens: o.maxTokens ?? 16000, system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      tools: o.tools.map(t => t.def), messages: [...messages],
      output_config: { effort: o.effort ?? 'medium' },
      cache_control: { type: 'ephemeral' },
    };
    // 둘째 호출부터 입력 상한 = 앞 응답의 실제 입력+출력 토큰 + 그 뒤에 더한 메시지의 바이트. 전체를 바이트로 세면 토큰의 2~3배라
    // 실제 $0.02~0.05인 호출에 $0.8~1.1을 예약해 예산 $6 중 $3.6만 쓰고 남은 페이지 종류를 시작하지 못했다(Maison 11/13 A·A2·B2).
    const hint = known ? known.tokens + upperTokens(messages.slice(known.messages)) : undefined;
    let reserved: number;
    try { reserved = await o.budget.reserveWhenFree(request, hint); } catch (e) {
      if (e instanceof BudgetError) return end('budget', { detail: e.message });
      throw e;
    }
    const turn: AgentResult['turns'][number] = { request, reserved };
    turns.push(turn);
    let response: Anthropic.Message;
    try {
      response = await sendRetrying(o.send, request, o.retryDelaysMs);
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
    const u = response.usage;
    known = { tokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + u.output_tokens, messages: messages.length };

    if (response.stop_reason === 'pause_turn') continue;
    // 제출 도구만 쓰는 짧은 대화: 판단을 글로만 쓰고 끝내거나(end_turn) 글이 출력 한도에서 잘리면(max_tokens) 한 번만 도구로 제출하라고 다시 요청한다.
    // 분류 실측(10/21·22)의 분류 실패가 모두 이 모양이었다. end_turn은 완결된 응답이라 thinking 블록이 있어도 그대로 두고 다시 요청한다.
    // max_tokens는 잘린 thinking·도구 블록을 다시 보내지 않도록 글만 있는 응답일 때만 다시 요청한다.
    const retryable = response.stop_reason === 'end_turn' ? response.content.every(b => b.type !== 'tool_use')
      : response.stop_reason === 'max_tokens' && response.content.every(b => b.type === 'text');
    if (o.nudge && !nudged && i + 1 < o.maxTurns && retryable) {
      nudged = true;
      // 잘린 글은 실측에서 모두 도구 호출 형식을 글로 흉내 내며 같은 줄을 수백 번 되풀이한 것이었다. 다시 보내면 비용이 들고 같은 패턴을 이어 가므로 앞부분만 남긴다.
      if (response.stop_reason === 'max_tokens') {
        const text = response.content.map(b => b.type === 'text' ? b.text : '').join('');
        messages[messages.length - 1] = { role: 'assistant', content: [{ type: 'text', text: `${text.slice(0, 2000)}\n…(출력 한도에서 잘림)` }] };
      }
      messages.push({ role: 'user', content: response.stop_reason === 'max_tokens' ? '답이 출력 한도에서 잘렸습니다. 설명을 짧게 줄여 지금 도구로 제출하세요.' : '결과를 도구로 제출하지 않았습니다. 위 판단을 도구로 제출하세요.' });
      continue;
    }
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return end(response.stop_reason);
    if (response.stop_reason === 'end_turn') return end('no_submit');
    if (response.stop_reason !== 'tool_use') return end('error', { detail: `stop_reason ${response.stop_reason}` });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      // 브라우저 상태를 공유하므로 병렬 호출도 순서대로 실행한다.
      const outcome = await runTool(byName.get(block.name), block.input, { turnsLeft: o.maxTurns - i - 1, maxTurns: o.maxTurns });
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

/** 잠깐 끊긴 네트워크·과부하처럼 다시 보내면 될 수 있는 실패. 요청 내용 문제(400 등)는 다시 보내지 않는다. */
const TRANSIENT = /Connection error|ECONNRESET|ETIMEDOUT|ENETUNREACH|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|overloaded|\b(429|500|502|503|504|529)\b/i;
/**
 * 일시적 실패는 같은 예약으로 5초·20초·60초 뒤 다시 보낸다. SDK 기본 재시도는 몇 초뿐이라 1분 남짓 끊기면 대화가 통째로 끝났고,
 * 실패한 호출의 예약은 청구됐을 수 있어 놓지 않으므로 남은 대화가 예산 부족으로 시작조차 못 했다(Maison·Adminator·Agora 11/14: 세 실행이 같은 3초 사이에 끊김).
 */
export async function sendRetrying(send: Send, request: Anthropic.MessageCreateParamsNonStreaming, delays = [5000, 20000, 60000]): Promise<Anthropic.Message> {
  for (let i = 0; ; i++) {
    try { return await send(request); } catch (e) {
      const msg = `${(e as { status?: number })?.status ?? ''} ${(e as Error)?.message ?? e}`;
      if (i >= delays.length || !TRANSIENT.test(msg)) throw e;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
}

async function runTool(tool: Tool | undefined, input: unknown, ctx: { turnsLeft: number; maxTurns: number }): Promise<ToolOutcome> {
  if (!tool) return { text: '알 수 없는 도구', isError: true };
  try {
    return await tool.run(input, ctx);
  } catch (e) {
    return { text: `도구 오류: ${(e as Error).message.split('\n')[0]}`, isError: true };
  }
}
