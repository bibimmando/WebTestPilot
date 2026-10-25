import { useEffect, useState } from "react";

/**
 * 화면에서 결함 토글을 읽는다. Maison 의 useBugs 와 같은 역할이다.
 * 토글은 서버의 환경변수로 정해지므로 /api/bugs 로 한 번 받아온다.
 * 아직 못 받았으면 빈 목록 — 즉 기본은 정상 동작이다.
 */

let cache: Promise<string[]> | null = null;
/** 받아 온 뒤의 켜진 목록. 훅을 쓸 수 없는 곳(src/lib/*.ts)에서 bugOn() 으로 읽는다. */
const loaded = new Set<string>();
export const BUGS_EVENT = "agora:bugs";
/** 한 번 받아 온 목록. 나중에 그려지는 화면은 첫 렌더부터 이 값을 쓴다. */
let resolved: string[] | null = null;

export function loadEnabled(): Promise<string[]> {
  cache ??= fetch("/api/bugs")
    .then((r) => r.json())
    .then((d: { enabled?: string[] }) => d.enabled ?? [])
    .catch(() => [] as string[])
    .then((list) => {
      resolved = list;
      list.forEach((id) => loaded.add(id));
      window.dispatchEvent(new Event(BUGS_EVENT));
      return list;
    });
  return cache;
}

/** 훅 밖에서 쓰는 토글. 아직 못 받았으면 false (정상 동작) */
export const bugOn = (id: string): boolean => loaded.has(id);

let ready = false;
void Promise.resolve().then(() => loadEnabled().then(() => (ready = true)));
/** 토글을 받았으면 바로, 아직이면 받은 뒤에 fn 을 부른다. */
export function afterBugs(fn: () => void): void {
  if (ready) fn();
  else void loadEnabled().then(fn);
}

export function useEnabledBugs(): string[] {
  const [list, setList] = useState<string[]>(() => resolved ?? []);
  useEffect(() => {
    let alive = true;
    loadEnabled().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** const bugF1 = useBug("F1"); */
export function useBug(id: string): boolean {
  return useEnabledBugs().includes(id);
}

/** 켜진 목록을 <body data-bugs="U1 U2"> 로 찍는다. CSS 결함이 이 속성에 걸린다. */
export function useBugBodyAttribute(): void {
  const enabled = useEnabledBugs();
  useEffect(() => {
    if (enabled.length === 0) document.body.removeAttribute("data-bugs");
    else document.body.setAttribute("data-bugs", enabled.join(" "));
  }, [enabled]);
}
