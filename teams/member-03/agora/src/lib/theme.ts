import { useCallback, useEffect, useState } from "react";

/**
 * 밝은 · 어두운 테마. <html class="dark"> 로 바꾼다.
 * 처음에는 기기 설정(prefers-color-scheme)을 따르고, 한 번 바꾸면 이 브라우저에 기억한다.
 * 첫 화면이 번쩍이지 않도록 index.html 의 작은 스크립트가 같은 규칙으로 먼저 정해 둔다.
 */

export type Theme = "light" | "dark";
const KEY = "agora.theme";
const EVENT = "agora:theme";

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const currentTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  useEffect(() => {
    const sync = () => setThemeState(currentTheme());
    // 직접 고른 적이 없으면 기기 설정이 바뀔 때 따라간다.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (saved()) return;
      document.documentElement.classList.toggle("dark", system() === "dark");
      sync();
    };
    window.addEventListener(EVENT, sync);
    media?.addEventListener("change", onSystem);
    return () => {
      window.removeEventListener(EVENT, sync);
      media?.removeEventListener("change", onSystem);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 저장이 막혀 있으면 이번 방문 동안만 바꾼다.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
