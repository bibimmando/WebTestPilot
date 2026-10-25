import { useCallback, useState } from "react";

export type ViewMode = "card" | "compact";
const KEY = "agora.view";

function load(): ViewMode {
  try {
    return localStorage.getItem(KEY) === "compact" ? "compact" : "card";
  } catch {
    return "card";
  }
}

/** 목록 보기 방식(카드 · 압축). 이 브라우저에만 기억한다. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(load);
  const update = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 저장하지 못해도 지금 화면에는 반영된다.
    }
  }, []);
  return [mode, update];
}
