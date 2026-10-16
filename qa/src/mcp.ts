// 개발용: 탐색 도구를 stdio MCP 서버로 노출해 Claude Code·Codex CLI 구독으로 탐색 루프를 돌린다.
// 루프·모델·비용 한도는 CLI 쪽에 있으므로 이 경로의 결과는 성능 수치로 쓰지 않는다 (docs/design/V2_ARCHITECTURE.md 3장).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openContext } from './browser.ts';
import { assertStartAllowed, exploreTools, SYSTEM, taskMessage, type Part, type Scope } from './explore.ts';
import type { Requirement } from './plan.ts';

const { values: a } = parseArgs({ options: {
  url: { type: 'string' }, origins: { type: 'string' }, requirements: { type: 'string' },
  out: { type: 'string', default: 'plan.json' }, 'allow-writes': { type: 'boolean', default: false },
  headed: { type: 'boolean', default: false }, 'print-prompt': { type: 'boolean', default: false },
  scope: { type: 'string' },
} });
if (!a.url) {
  console.error('사용법: node src/mcp.ts --url <시작 URL> [--requirements <요구사항.json>] [--origins a,b] [--out plan.json] [--allow-writes] [--headed] [--print-prompt]');
  process.exit(2);
}
const startUrl = a.url;
// Windows PowerShell 5.1의 utf8 저장은 BOM을 붙이므로 제거한다.
const requirements: Requirement[] = a.requirements ? JSON.parse(readFileSync(a.requirements, 'utf8').replace(/^﻿/, '')) : [];  // 요구사항은 선택 입력(설계 3.3)
const policy = { origins: a.origins ? a.origins.split(',') : [new URL(startUrl).origin], allowWrites: a['allow-writes'] };
const task = { policy, startUrl, requirements };
// 템플릿별 대화 하나(개발용): 확인 스크립트가 사이트 지도·이번 템플릿·이어 쓸 번호를 파일로 준다.
const scope = a.scope ? JSON.parse(readFileSync(a.scope, 'utf8')) as Scope & { taken: string[]; nextT: number; nextQ: number } : undefined;
const part: Part | undefined = scope ? { taken: new Set(scope.taken), next: { T: scope.nextT, Q: scope.nextQ }, questions: [], urls: new Set() } : undefined;
assertStartAllowed(task);
if (a['print-prompt']) {
  console.log(`${SYSTEM}\n\n${taskMessage(task, scope)}`);
  process.exit(0);
}

const browser = await chromium.launch({ headless: !a.headed });
const { context, blocked, violations } = await openContext(browser, policy);
const page = await context.newPage();
await page.goto(startUrl);
const tools = new Map(exploreTools(page, task, violations, part).map(t => [t.def.name, t]));

const server = new Server({ name: 'webtestpilot-qa', version: '0.1.0' }, { capabilities: { tools: {}, prompts: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...tools.values()].map(t => ({ name: t.def.name, description: t.def.description, inputSchema: t.def.input_schema as any })),
}));
server.setRequestHandler(CallToolRequestSchema, async req => {
  const tool = tools.get(req.params.name);
  if (!tool) return { content: [{ type: 'text', text: '알 수 없는 도구' }], isError: true };
  try {
    const r = await tool.run(req.params.arguments ?? {});
    if (r.done !== undefined) {
      writeFileSync(a.out!, JSON.stringify({ ...(r.done as object), blocked, violations }, null, 2));
      return { content: [{ type: 'text', text: `${r.text} 저장: ${a.out}` }] };
    }
    return { content: [{ type: 'text', text: r.text }], isError: r.isError ?? false };
  } catch (e) {
    return { content: [{ type: 'text', text: `도구 오류: ${(e as Error).message.split('\n')[0]}` }], isError: true };
  }
});
// CLI가 시스템 프롬프트를 따로 받지 않아도 되도록, 탐색 지침과 과제를 하나의 프롬프트로 제공한다.
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: 'explore', description: '탐색·계획 과제' }] }));
server.setRequestHandler(GetPromptRequestSchema, async () => ({
  messages: [{ role: 'user', content: { type: 'text', text: `${SYSTEM}\n\n${taskMessage(task, scope)}` } }],
}));

const close = async () => { await browser.close(); process.exit(0); };
process.stdin.on('close', close);
process.on('SIGTERM', close);
process.on('SIGINT', close);
await server.connect(new StdioServerTransport());
