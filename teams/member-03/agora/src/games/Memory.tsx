import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { makeRng, type Rng } from "./random";
import type { BoardProps } from "./types";

const FACES = ["🐶", "🐱", "🦊", "🐼", "🐸", "🐵", "🐧", "🐙"];

function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 4×4 카드 16장. 두 장을 뒤집을 때마다 1번 이동으로 센다. */
export function Memory({ round, seed, onFinish }: BoardProps) {
  const t = useT();
  // round 가 바뀌면 새로 섞는다.
  const deck = useMemo(() => shuffle([...FACES, ...FACES], makeRng(seed, "memory", round)), [round, seed]);
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);

  // 짝이 안 맞으면 잠깐 보여 주고 다시 덮는다.
  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open;
    if (deck[a] === deck[b]) {
      const next = new Set(matched).add(a).add(b);
      setMatched(next);
      setOpen([]);
      if (next.size === deck.length) onFinish({ score: moves, won: true });
      return;
    }
    const timer = window.setTimeout(() => setOpen([]), 700);
    return () => window.clearTimeout(timer);
  }, [open, deck, matched, moves, onFinish]);

  const flip = (i: number) => {
    if (open.length === 2 || open.includes(i) || matched.has(i)) return;
    if (open.length === 1) setMoves((m) => m + 1);
    setOpen([...open, i]);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-sm text-muted" aria-live="polite">
        {t("{n}번 이동", { n: moves })} · {t("짝 {n}/{total}", { n: matched.size / 2, total: FACES.length })}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {deck.map((face, i) => {
          const shown = open.includes(i) || matched.has(i);
          return (
            <button
              type="button"
              key={i}
              onClick={() => flip(i)}
              aria-label={shown ? face : t("{n}번 카드", { n: i + 1 })}
              aria-pressed={shown}
              className={clsx(
                "flex h-16 w-16 items-center justify-center rounded-xl text-3xl transition-colors sm:h-20 sm:w-20",
                matched.has(i) ? "bg-emerald-100 opacity-70 dark:bg-emerald-400/20" : shown ? "bg-surface ring-2 ring-accent" : "bg-accent hover:bg-accent-strong",
              )}
            >
              {shown ? face : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
