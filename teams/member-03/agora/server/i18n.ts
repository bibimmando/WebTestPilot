import { AsyncLocalStorage } from "async_hooks";
import { EN } from "./i18n-en";

/**
 * 서버가 돌려주는 문구(오류 · 검증 메시지)의 언어.
 * 화면이 요청마다 x-agora-lang 머리글로 언어를 보내고, 요청이 끝날 때까지 그 언어로 L() 을 번역한다.
 * 한국어 원문을 그대로 키로 쓴다: L("제목을 입력해 주세요."), L("{n}자까지 쓸 수 있어요.", { n: 300 })
 */

export type Lang = "ko" | "en";
const store = new AsyncLocalStorage<Lang>();

export function langOf(header: string | string[] | undefined): Lang {
  return header === "en" ? "en" : "ko";
}

export function withLang<T>(lang: Lang, fn: () => T): T {
  return store.run(lang, fn);
}

export const currentLang = (): Lang => store.getStore() ?? "ko";

export function L(text: string, vars?: Record<string, string | number>): string {
  let out = (currentLang() === "en" && EN[text]) || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
