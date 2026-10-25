import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { EN } from "./en";

/**
 * 화면 언어. 문구는 한국어 원문을 그대로 키로 쓴다 (t("글쓰기")).
 *   한국어는 원문 그대로, 다른 언어는 사전(en.ts)에서 찾고 없으면 원문을 보여 준다.
 *   {name} 자리는 vars 로 채운다: t("댓글 {n}개", { n: 3 })
 *   한국어로는 같은데 뜻이 다른 말은 @@ 뒤에 쓰임새를 붙여 나눈다: t("가입하기@@signup") → 한국어 "가입하기", 영어 "Sign up"
 * 기본 언어는 항상 한국어다. 브라우저 언어를 따르지 않아야 벤치마크가 어디서 돌든 같은 화면이 나온다.
 * 사용자가 바꾼 언어는 이 브라우저에만 기억한다.
 */

export type Lang = "ko" | "en";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
];

const DICTS: Record<Lang, Record<string, string> | null> = { ko: null, en: EN };
const KEY = "agora.lang";

/** 화면 밖(api.ts, format.ts)에서도 지금 언어를 알 수 있게 모듈에 들고 있는다. */
let current: Lang = "ko";
export const currentLang = (): Lang => current;

export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang];
  let out = (dict && dict[text]) || text.split("@@")[0];
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** 컴포넌트 밖에서 쓰는 번역 (지금 언어 기준) */
export const tr = (text: string, vars?: Record<string, string | number>) => translate(current, text, vars);

function load(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "en" || saved === "ko" ? saved : "ko";
  } catch {
    return "ko";
  }
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (current = load()));

  const setLang = useCallback((next: Lang) => {
    current = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 기억하지 못해도 지금 화면에는 반영된다.
    }
    setLangState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (text, vars) => translate(lang, text, vars) }), [lang, setLang]);

  // 언어가 바뀌면 화면 전체를 새로 그린다. 서버가 돌려주는 문구(오류, 관심 항목 이름)도 새 언어로 다시 받는다.
  return (
    <I18nContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider 안에서만 쓸 수 있어요.");
  return value;
}

export const useT = () => useI18n().t;

/**
 * 문장 가운데에 굵은 글씨 같은 요소가 들어갈 때. 언어마다 어순이 달라서 문장째 번역하고 {자리}에 요소를 끼운다.
 *   <Trans text="{target} (으)로 보낸 6자리 인증번호를 입력하세요." values={{ target: <strong>…</strong> }} />
 */
export function Trans({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const { t } = useI18n();
  return (
    <>
      {t(text)
        .split(/(\{\w+\})/)
        .map((part, i) => {
          const key = part.match(/^\{(\w+)\}$/)?.[1];
          return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
        })}
    </>
  );
}
