// M5 계정 로그인(설계 5장 0단계, IN-3). 로그인 절차는 엔진 코드가 아니라 앱 설정(데이터)이다.
// 프로그램이 로그인해 브라우저 상태(쿠키·로컬 저장소)를 만들고, 탐색·실행·재현은 그 상태로 시작한다.
// 비밀값은 환경 변수에서만 읽고 모델 입력·기록·보고서에 넣지 않는다.
import { readFileSync } from 'node:fs';
import type { Browser, BrowserContext } from 'playwright';
import { settle, toLocator, type Policy, type Target } from './browser.ts';

/** 앱 설정 파일(--app). 이 앱에서만 필요한 준비 정보를 둔다. 공통 엔진에는 앱별 분기를 넣지 않는다. */
export type AppConfig = {
  login?: LoginSpec;
  /** 요청하지 않을 주소(부분 문자열). 로그아웃처럼 서버 세션을 끊어 뒤 검사 전체를 로그인 없는 상태로 만드는 주소 */
  deny?: string[];
};
export type LoginSpec = {
  /** 로그인 화면 주소(허용 origin 안) */
  url: string;
  /** 아이디·비밀번호 칸과 제출 버튼. 계획의 대상과 같은 데이터 모양(역할·이름 등) */
  username: Target; password: Target; submit: Target;
  /** 성공 확인: 로그인 뒤 이 글자가 보이거나 주소에 이 문자열이 들어 있어야 한다(둘 다 주면 둘 다) */
  success: { text?: string; urlIncludes?: string };
  /** 비밀값을 읽을 환경 변수 이름. 값 자체는 설정 파일에 쓰지 않는다 */
  env: { username: string; password: string };
};
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
export type LoginResult = { ok: true; state: StorageState } | { ok: false; reason: string };

/** 앱 설정을 읽고 모양을 검사한다. 비밀값이 설정 파일에 들어 있으면 거부한다. */
export function readAppConfig(path: string): AppConfig {
  // Windows PowerShell 5.1의 utf8 저장은 BOM을 붙이므로 제거한다.
  const c = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')) as AppConfig & { login?: Record<string, unknown> };
  if (c.deny !== undefined && !(Array.isArray(c.deny) && c.deny.every(d => typeof d === 'string' && d.trim()))) throw new Error('앱 설정: deny는 비어 있지 않은 문자열 목록이어야 함');
  const l = c.login;
  if (l) {
    if ('password' in l && typeof l.password === 'string') throw new Error('앱 설정: 비밀번호 값을 파일에 쓰지 말고 env.password에 환경 변수 이름을 적으세요');
    const target = (t: unknown) => !!t && typeof t === 'object' && ('role' in t || 'text' in t);
    if (typeof l.url !== 'string' || !target(l.username) || !target(l.password) || !target(l.submit)) throw new Error('앱 설정: login에는 url과 username·password·submit 대상이 필요함');
    const s = l.success as LoginSpec['success'] | undefined;
    if (!s || (!s.text && !s.urlIncludes)) throw new Error('앱 설정: login.success에 text나 urlIncludes가 필요함');
    const env = l.env as LoginSpec['env'] | undefined;
    if (!env || typeof env.username !== 'string' || typeof env.password !== 'string') throw new Error('앱 설정: login.env에 username·password 환경 변수 이름이 필요함');
  }
  return c;
}

/**
 * 로그인해 브라우저 상태를 돌려준다. 로그인 제출은 쓰기 요청이라, 이 절차만 허용 origin 안의 쓰기를 허용한 별도 컨텍스트에서 한다.
 * 실패 사유에는 비밀값을 넣지 않는다. 실패하면 호출자는 로그인 없이 계속하고 "로그인 이후 기능 미검사"로 남긴다.
 */
export async function login(browser: Browser, policy: Policy, spec: LoginSpec, env: NodeJS.ProcessEnv = process.env, timeoutMs = 10000): Promise<LoginResult> {
  const username = env[spec.env.username], password = env[spec.env.password];
  if (!username || !password) return { ok: false, reason: `환경 변수 ${!username ? spec.env.username : spec.env.password}가 비어 있음` };
  if (!policy.origins.includes(new URL(spec.url).origin)) return { ok: false, reason: `로그인 주소가 허용 origin 밖: ${spec.url}` };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    // 허용 origin 밖으로는 로그인 중에도 나가지 않는다(외부 인증은 지원하지 않음).
    await context.route('**/*', r => policy.origins.includes(new URL(r.request().url()).origin) || /^(data|blob|about):/.test(r.request().url()) ? r.continue() : r.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.goto(spec.url, { timeout: timeoutMs });
    await settle(page, timeoutMs);
    for (const [name, t] of [['아이디 칸', spec.username], ['비밀번호 칸', spec.password], ['제출 버튼', spec.submit]] as const) {
      const n = await toLocator(page, t).count();
      if (n !== 1) return { ok: false, reason: `${name}를 하나로 찾지 못함(${n}개)` };
    }
    await toLocator(page, spec.username).fill(username, { timeout: timeoutMs });
    await toLocator(page, spec.password).fill(password, { timeout: timeoutMs });
    await toLocator(page, spec.submit).click({ timeout: timeoutMs });
    await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
    await settle(page, timeoutMs);
    const deadline = Date.now() + timeoutMs;
    const ok = async () => (!spec.success.urlIncludes || page.url().includes(spec.success.urlIncludes))
      && (!spec.success.text || (await page.getByText(spec.success.text).count()) > 0);
    while (!(await ok())) {
      if (Date.now() > deadline) return { ok: false, reason: `성공 확인 조건을 만족하지 않음(현재 주소 ${new URL(page.url()).pathname})` };
      await page.waitForTimeout(200);
    }
    const landing = page.url();
    if (!policy.origins.includes(new URL(landing).origin)) return { ok: false, reason: `로그인 뒤 허용 origin 밖으로 이동함: ${new URL(landing).origin}` };
    const state = await context.storageState({ indexedDB: true });
    // 쿠키·저장소에 담기지 않는 로그인(메모리 토큰 등)은 새 컨텍스트에서 풀린다. 그러면 로그인 상태로 검사했다고 쓸 수 없다.
    const check = await browser.newContext({ serviceWorkers: 'block', storageState: state });
    try {
      const p = await check.newPage();
      await p.goto(landing, { timeout: timeoutMs });
      await settle(p, timeoutMs);
      const kept = (!spec.success.urlIncludes || p.url().includes(spec.success.urlIncludes)) && (!spec.success.text || (await p.getByText(spec.success.text).count()) > 0);
      if (!kept) return { ok: false, reason: '저장한 로그인 상태로 다시 열면 로그인 상태가 아님(쿠키·저장소에 남지 않는 로그인)' };
    } finally { await check.close(); }
    return { ok: true, state };
  } catch (e) {
    // 오류 문구에 입력값이 섞일 수 있어 첫 줄만, 비밀값은 지운다.
    return { ok: false, reason: `로그인 중 오류: ${String((e as Error).message).split('\n')[0].split(password).join('***')}` };
  } finally {
    await context.close();
  }
}
