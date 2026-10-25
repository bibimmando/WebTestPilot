import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { makeRng, type Rng } from "./random";
import type { BoardProps } from "./types";

const N = 5;
const MAX_MOVES = 999;

/** 그 칸과 위아래 · 양옆을 뒤집는다. */
function toggle(board: boolean[], i: number): boolean[] {
  const next = [...board];
  const r = Math.floor(i / N);
  const c = i % N;
  for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < N && cc >= 0 && cc < N) next[rr * N + cc] = !next[rr * N + cc];
  }
  return next;
}

/** 모두 꺼진 판에서 무작위로 눌러 만든다 — 그래서 항상 풀 수 있다. */
function makePuzzle(rng: Rng): boolean[] {
  let board: boolean[] = Array(N * N).fill(false);
  while (!board.some(Boolean)) {
    for (let k = 0; k < 6; k++) board = toggle(board, Math.floor(rng() * N * N));
  }
  return board;
}

export function Lights({ round, seed, onFinish }: BoardProps) {
  const t = useT();
  const start = useMemo(() => makePuzzle(makeRng(seed, "lights", round)), [round, seed]);
  const [board, setBoard] = useState(start);
  const [moves, setMoves] = useState(0);
  const lit = board.filter(Boolean).length;
  const done = lit === 0;

  const press = (i: number) => {
    if (done) return;
    const next = toggle(board, i);
    const m = Math.min(moves + 1, MAX_MOVES);
    setBoard(next);
    setMoves(m);
    if (!next.some(Boolean)) onFinish({ score: m, won: true });
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted" aria-live="polite">
        {t("{n}번 이동", { n: moves })} · {t("켜진 불 {n}개", { n: lit })}
      </p>
      <div role="grid" aria-label={t("불 끄기 판")} className="grid grid-cols-5 gap-2">
        {board.map((on, i) => (
          <button
            type="button"
            key={i}
            onClick={() => press(i)}
            disabled={done}
            aria-label={t("{r}행 {c}열", { r: Math.floor(i / N) + 1, c: (i % N) + 1 })}
            aria-pressed={on}
            className={clsx(
              "h-14 w-14 rounded-xl transition-colors sm:h-16 sm:w-16",
              on ? "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.8)]" : "bg-gray-700 hover:bg-gray-600",
            )}
          />
        ))}
      </div>
    </div>
  );
}
