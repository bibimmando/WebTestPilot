// ② spec 생성 (안 A). plan에서 시나리오마다 spec을 템플릿으로 만든다. 같은 plan이면 항상 같은 코드다.
// spec에는 ID만 들어가고 연산·값·기대는 fixture가 plan.json에서 읽는다. ID는 JSON 문자열로 넣어 코드가 되지 않게 한다.
import type { Plan, Scenario } from './plan.ts';

/** 시나리오의 실행 순서: 시작 → 시작 시점 검사 → (행동 → 그 행동 뒤 검사)… reconcile도 이 순서를 기준으로 쓴다. */
export function sequence(s: Scenario): { call: 'start' | 'act' | 'check'; id: string }[] {
  const after = (point: string) => s.checks.filter(c => c.after === point).map(c => ({ call: 'check' as const, id: c.id }));
  return [
    { call: 'start', id: s.id },
    ...after('start'),
    ...s.steps.flatMap(st => [{ call: 'act' as const, id: st.id }, ...after(st.id)]),
  ];
}

export function specFor(s: Scenario, fixtureImport: string): string {
  const body = sequence(s).map(x => `  await ${x.call}(page, ${JSON.stringify(x.id)});`).join('\n');
  return [
    `import { test, start, act, check } from ${JSON.stringify(fixtureImport)};`,
    '',
    `test(${JSON.stringify(`${s.id} ${s.title}`)}, async ({ page }) => {`,
    body,
    '});',
    '',
  ].join('\n');
}

export function specs(plan: Plan, fixtureImport: string): Record<string, string> {
  return Object.fromEntries(plan.scenarios.map(s => [`${s.id}.spec.ts`, specFor(s, fixtureImport)]));
}
