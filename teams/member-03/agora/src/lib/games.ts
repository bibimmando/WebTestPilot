import { api } from "./api";
import { useSession } from "./session";
import { useAsync } from "./useAsync";
import type { Game } from "./types";

type T = (text: string, vars?: Record<string, string | number>) => string;

/** 게임 목록. 로그인 상태가 바뀌면 내 기록을 다시 받는다. */
export function useGames() {
  const { user } = useSession();
  return useAsync(() => api.get<{ games: Game[] }>("/api/games").then((r) => r.games), [user?.name]);
}

/** 기록을 단위와 함께 쓴다: "3회 시도" · "12번 이동" */
export function scoreText(t: T, game: Pick<Game, "unit">, n: number): string {
  return game.unit === "tries" ? t("{n}회 시도", { n }) : t("{n}번 이동", { n });
}
