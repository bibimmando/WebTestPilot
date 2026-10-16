import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let server: Server | undefined;
let origin = '';
before(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(readFileSync(new URL('./fixtures/modal.html', import.meta.url)));
  });
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server?.close(); });

const text = (r: any) => r.content.map((c: any) => c.text).join('\n') as string;

test('MCP 서버: CLI처럼 도구를 불러 계획을 제출하면 plan.json을 쓴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-mcp-'));
  const reqs = join(dir, 'req.json');
  const out = join(dir, 'plan.json');
  writeFileSync(reqs, JSON.stringify([{ id: 'R1', text: '쿠폰 적용 버튼이 보인다' }]));
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp.ts', import.meta.url)), '--url', origin + '/', '--requirements', reqs, '--out', out],
    stderr: 'inherit',
  }));
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(t => t.name).sort(), ['ask_user', 'click', 'fill', 'navigate', 'pin', 'press', 'select', 'snapshot', 'submit_plan']);
    const ops = (tools.find(t => t.name === 'submit_plan')!.inputSchema as any).properties.scenarios.items.properties.checks.items.properties.op.enum;
    assert.ok(ops.includes('sorted_asc') && ops.includes('sorted_desc') && !ops.includes('record'), '도구 스키마는 계약의 연산을 그대로 열고 내부 연산은 숨긴다');
    const prompt = await client.getPrompt({ name: 'explore' });
    assert.match(JSON.stringify(prompt), /R1: 쿠폰 적용 버튼이 보인다/);

    const snap = text(await client.callTool({ name: 'snapshot', arguments: {} }));
    const ref = snap.split('\n').find(l => l.includes('button "쿠폰 적용"'))!.match(/\[ref=(\w+)\]/)![1];
    assert.match(text(await client.callTool({ name: 'pin', arguments: { ref, group: false } })), /^T1 =/);

    const bad = await client.callTool({ name: 'submit_plan', arguments: { scenarios: [], unplanned: [] } });
    assert.equal(bad.isError, true);
    const ok = await client.callTool({ name: 'submit_plan', arguments: {
      scenarios: [{ id: 'S1', title: '버튼', covers: ['R1'], start: { url: origin + '/' }, steps: [],
        checks: [{ id: 'S1.C1', after: 'start', target: 'T1', read: 'visible', op: 'equals', expected: 'true',
          source: { kind: 'requirement', id: 'R1', quote: '쿠폰 적용 버튼이 보인다' } }] }],
      unplanned: [],
    } });
    assert.match(text(ok), /저장/);
    const plan = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(plan.targets.T1.target.role, 'button');
    assert.deepEqual(plan.violations, []);
  } finally {
    await client.close();
  }
});
