import { useEffect, useState } from "react";
import { BUGS_EVENT, afterBugs, bugOn, loadEnabled } from "./bugs";

/**
 * 최근 본 글. 로그인하지 않아도 쓸 수 있게 이 브라우저에 글 ID 만 남긴다.
 * 계정마다(손님은 guest) 따로 남겨, 같은 브라우저를 쓰는 다른 사람에게 섞여 보이지 않게 한다.
 * 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이번 방문 동안만 메모리에 둔다.
 */

const MAX = 10;
const EVENT = "agora:recent";
const memory = new Map<string, string[]>();

// 결함 F2: 기록 이름을 아이디가 아니라 회원/손님 구분으로만 만든다 (로그인한 계정끼리 기록이 섞임, 손님은 따로)
const keyOf = (owner: string | null | undefined) =>
  bugOn("F2") ? `agora.recent.${owner ? "member" : "guest"}` : `agora.recent.${owner ?? "guest"}`;

export function readRecent(owner: string | null | undefined): string[] {
  const key = keyOf(owner);
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return memory.get(key) ?? [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, MAX) : [];
  } catch {
    return memory.get(key) ?? [];
  }
}

function write(owner: string | null | undefined, ids: string[]): void {
  const key = keyOf(owner);
  memory.set(key, ids);
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // 저장이 막혀 있으면 메모리에 둔 것만 쓴다.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** 방금 본 글을 맨 앞에 둔다. 이미 있으면 앞으로 옮긴다. */
export function pushRecent(owner: string | null | undefined, id: string): void {
  // 결함 토글을 받은 뒤에 쓴다 (받기 전과 후의 기록 위치가 다를 수 있다)
  afterBugs(() => write(owner, [id, ...readRecent(owner).filter((x) => x !== id)].slice(0, MAX)));
}

export function clearRecent(owner: string | null | undefined): void {
  afterBugs(() => write(owner, []));
}

/** 최근 본 글 ID. 이 탭이나 다른 탭에서 바뀌면 다시 읽는다. */
export function useRecentIds(owner: string | null | undefined): string[] {
  const [ids, setIds] = useState(() => readRecent(owner));
  useEffect(() => {
    const sync = () => setIds(readRecent(owner));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    // 결함 토글을 받아 오면 기록 위치가 바뀔 수 있어 다시 읽는다
    window.addEventListener(BUGS_EVENT, sync);
    void loadEnabled();
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(BUGS_EVENT, sync);
    };
  }, [owner]);
  return ids;
}
