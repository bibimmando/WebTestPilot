// M5 등록된 초기화(설계 5장 0단계, IN-4). 앱 설정에 등록한 요청 하나를 프로그램만 호출하고, 확인 요청으로 결과를 본다.
// AI는 초기화를 고르거나 호출하지 않는다. 등록하지 않은 앱은 초기화하지 않는다(쓰기 허용 실행이면 재현을 판단 불가로 둔다).
import { request } from 'playwright';
import type { Policy } from './browser.ts';
import type { StorageState } from './login.ts';

/** 초기화 요청과 확인. 확인은 status 또는 응답 본문의 글자(둘 다 주면 둘 다) */
export type ResetSpec = {
  request: { method: 'POST' | 'PUT' | 'DELETE' | 'GET'; url: string; body?: string };
  verify: { url: string; status?: number; text?: string };
};
/** storageState: 초기화가 서버 세션을 지울 수 있어 다시 로그인한 상태(호출자가 채운다). 있으면 그 뒤 실행·재현은 이 상태를 쓴다 */
export type ResetResult = { ok: true; storageState?: StorageState } | { ok: false; reason: string };

export function checkResetSpec(r: unknown): string | undefined {
  const s = r as ResetSpec;
  if (!s?.request || !['POST', 'PUT', 'DELETE', 'GET'].includes(s.request.method) || typeof s.request.url !== 'string') return '앱 설정: reset.request에 method(POST·PUT·DELETE·GET)와 url이 필요함';
  if (!s.verify || typeof s.verify.url !== 'string' || (s.verify.status === undefined && !s.verify.text)) return '앱 설정: reset.verify에 url과 status나 text가 필요함';
  for (const u of [s.request.url, s.verify.url]) { try { new URL(u); } catch { return `앱 설정: reset 주소가 올바른 URL이 아님: ${u}`; } }
  return undefined;
}

/**
 * 등록된 초기화를 호출하고 확인한다. 로그인 상태가 있으면 그 쿠키로 보낸다(계정 단위 초기화).
 * 허용 origin 밖으로는 보내지 않고, 리다이렉트를 따라가지 않는다. 실패 사유에 응답 본문은 넣지 않는다.
 */
export async function resetApp(policy: Policy, spec: ResetSpec, storageState?: StorageState, timeoutMs = 15000): Promise<ResetResult> {
  // 주소 해석·요청 컨텍스트 생성까지 모든 실패는 "초기화 실패"로 돌려준다(예외로 실행 전체를 멈추지 않는다).
  let ctx: Awaited<ReturnType<typeof request.newContext>> | undefined;
  try {
    for (const u of [spec.request.url, spec.verify.url]) if (!policy.origins.includes(new URL(u).origin)) return { ok: false, reason: `초기화 주소가 허용 origin 밖: ${new URL(u).origin}` };
    ctx = await request.newContext({ ...(storageState ? { storageState } : {}), timeout: timeoutMs });
    const r = await ctx.fetch(spec.request.url, { method: spec.request.method, maxRedirects: 0, ...(spec.request.body !== undefined ? { data: spec.request.body } : {}) });
    if (r.status() >= 400) return { ok: false, reason: `초기화 요청이 ${r.status()}로 실패` };
    const v = await ctx.get(spec.verify.url, { maxRedirects: 0 });
    if (spec.verify.status !== undefined && v.status() !== spec.verify.status) return { ok: false, reason: `확인 요청 상태 ${v.status()} (기대 ${spec.verify.status})` };
    if (spec.verify.text && !(await v.text()).includes(spec.verify.text)) return { ok: false, reason: '확인 응답에 기대한 글자가 없음(초기 상태가 아님)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `초기화 중 오류: ${String((e as Error).message).split('\n')[0]}` };
  } finally {
    await ctx?.dispose();
  }
}
