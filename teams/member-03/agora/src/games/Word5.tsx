import { useCallback, useEffect, useMemo, useState } from "react";
import { Delete } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { makeRng } from "./random";
import type { BoardProps } from "./types";

const WORDS = [
  "APPLE", "BEACH", "BRAIN", "BREAD", "CANDY", "CHAIR", "CLOUD", "CRANE", "DANCE", "DREAM",
  "EARTH", "FIELD", "FLAME", "FROST", "GHOST", "GRAPE", "HEART", "HONEY", "HOUSE", "JUICE",
  "KNIFE", "LEMON", "LIGHT", "MAPLE", "MONEY", "MUSIC", "NIGHT", "OCEAN", "PAINT", "PIANO",
  "PLANT", "QUEEN", "RADIO", "RIVER", "ROBOT", "SALAD", "SHEEP", "SMILE", "SNAKE", "SPACE",
  "STORM", "SUGAR", "TABLE", "TIGER", "TOAST", "TRAIN", "WATER", "WHALE", "WORLD", "YOUTH",
];
const ROWS = 6;
const KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

type Mark = "hit" | "near" | "miss";

/**
 * 한국 시간 기준 날짜마다 같은 단어. 다시 하기를 누르면 아무 단어나 고른다.
 * 시드가 있으면 날짜와 상관없이 시드 · 판 번호로 정한다.
 */
function pickWord(round: number, seed: number | null): string {
  if (seed !== null) return WORDS[Math.floor(makeRng(seed, "word5", round)() * WORDS.length)];
  if (round === 0) {
    const day = Math.floor((Date.now() + 9 * 3600_000) / 86_400_000);
    return WORDS[day % WORDS.length];
  }
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

/** 맞은 자리를 먼저 지우고, 남은 글자로 "다른 자리" 를 센다 (같은 글자가 두 번 나와도 맞게). */
function grade(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(5).fill("miss");
  const left: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = "hit";
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i] === "hit") continue;
    if (left[guess[i]]) {
      marks[i] = "near";
      left[guess[i]]--;
    }
  }
  return marks;
}

const TILE: Record<Mark, string> = {
  hit: "border-emerald-600 bg-emerald-600 text-white",
  near: "border-amber-500 bg-amber-500 text-white",
  miss: "border-gray-500 bg-gray-500 text-white",
};

export function Word5({ round, seed, onFinish }: BoardProps) {
  const t = useT();
  const answer = useMemo(() => pickWord(round, seed), [round, seed]);
  const [guesses, setGuesses] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [notice, setNotice] = useState("");
  const done = guesses.at(-1) === answer || guesses.length === ROWS;

  const press = useCallback(
    (key: string) => {
      if (done) return;
      setNotice("");
      if (key === "ENTER") {
        if (current.length < 5) {
          setNotice(t("다섯 글자를 채워 주세요."));
          return;
        }
        const next = [...guesses, current];
        setGuesses(next);
        setCurrent("");
        if (current === answer) onFinish({ score: next.length, won: true });
        else if (next.length === ROWS) onFinish({ score: ROWS, won: false, answer });
      } else if (key === "BACK") {
        setCurrent((c) => c.slice(0, -1));
      } else if (/^[A-Z]$/.test(key)) {
        setCurrent((c) => (c.length < 5 ? c + key : c));
      }
    },
    [answer, current, done, guesses, onFinish, t],
  );

  // 실제 자판으로도 칠 수 있다. 검색창 같은 입력 칸에 쓰는 중이면 끼어들지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter") press("ENTER");
      else if (e.key === "Backspace") press("BACK");
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toUpperCase());
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  // 자판 색: 한 번이라도 맞은 자리면 초록, 아니면 노랑, 없는 글자는 회색
  const keyMarks = useMemo(() => {
    const out: Record<string, Mark> = {};
    for (const g of guesses) {
      grade(g, answer).forEach((m, i) => {
        const prev = out[g[i]];
        if (m === "hit" || (m === "near" && prev !== "hit") || (m === "miss" && !prev)) out[g[i]] = m;
      });
    }
    return out;
  }, [guesses, answer]);

  const rows = Array.from({ length: ROWS }, (_, r) => (r < guesses.length ? guesses[r] : r === guesses.length ? current : ""));

  return (
    <div className="flex flex-col items-center gap-5">
      <div role="grid" aria-label={t("단어판")} className="grid gap-1.5">
        {rows.map((word, r) => {
          const marks = r < guesses.length ? grade(word, answer) : null;
          return (
            <div role="row" key={r} className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  role="gridcell"
                  key={i}
                  aria-label={word[i] ? `${word[i]} ${marks ? t(marks[i] === "hit" ? "맞음" : marks[i] === "near" ? "다른 자리" : "없음@@letter") : ""}` : t("빈칸")}
                  className={clsx(
                    "flex h-12 w-12 items-center justify-center rounded-md border-2 text-xl font-bold sm:h-14 sm:w-14",
                    marks ? TILE[marks[i]] : word[i] ? "border-ink/60" : "border-line",
                  )}
                >
                  {word[i] ?? ""}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p role="status" className="h-5 text-sm text-down">{notice}</p>

      <div className="w-full max-w-md space-y-1.5" aria-label={t("자판")}>
        {KEYS.map((row, r) => (
          <div key={row} className="flex justify-center gap-1">
            {r === 2 && (
              <button type="button" onClick={() => press("ENTER")} disabled={done} className="rounded-md bg-surface px-2.5 text-xs font-semibold ring-1 ring-line hover:bg-line disabled:opacity-50">
                {t("입력")}
              </button>
            )}
            {[...row].map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => press(k)}
                disabled={done}
                className={clsx(
                  "h-11 min-w-0 flex-1 rounded-md text-sm font-semibold disabled:opacity-60",
                  keyMarks[k] ? TILE[keyMarks[k]] : "bg-surface ring-1 ring-line hover:bg-line",
                )}
              >
                {k}
              </button>
            ))}
            {r === 2 && (
              <button type="button" onClick={() => press("BACK")} disabled={done} aria-label={t("지우기")} className="rounded-md bg-surface px-2.5 ring-1 ring-line hover:bg-line disabled:opacity-50">
                <Delete className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
