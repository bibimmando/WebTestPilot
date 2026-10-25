import { CONTENT_EN } from "./content-en";
import { currentLang } from "./i18n";

/**
 * 사용자 · 커뮤니티 내용 번역. 미리 옮겨 둔 사전(content-en.ts)에 있을 때만 바뀐다.
 *   tc  번역이 있으면 번역, 없으면 null  (글 · 댓글처럼 "원문 보기" 를 붙일 때)
 *   lc  번역이 있으면 번역, 없으면 원문   (커뮤니티 이름 · 말머리처럼 그냥 바꿔 보여 줄 때)
 */
export function tc(text: string): string | null {
  if (!text || currentLang() !== "en") return null;
  return CONTENT_EN[text] ?? null;
}

export const lc = (text: string): string => tc(text) ?? text;
