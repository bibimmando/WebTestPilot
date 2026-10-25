import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { useT } from "@/i18n";
import { makeRng } from "./random";
import type { BoardProps } from "./types";

export function UpDown({ round, seed, onFinish }: BoardProps) {
  const t = useT();
  const target = useMemo(() => 1 + Math.floor(makeRng(seed, "updown", round)() * 100), [round, seed]);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const done = history.at(-1) === target;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setError(t("1부터 100 사이의 정수를 넣어 주세요."));
      return;
    }
    setError("");
    const next = [...history, n];
    setHistory(next);
    setValue("");
    if (n === target) onFinish({ score: next.length, won: true });
    else input.current?.focus();
  };

  // 지금까지 좁혀진 범위
  const low = Math.max(1, ...history.filter((n) => n < target).map((n) => n + 1));
  const high = Math.min(100, ...history.filter((n) => n > target).map((n) => n - 1));

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
      <p className="text-4xl font-bold tabular-nums" aria-live="polite">
        {done ? target : `${low} – ${high}`}
      </p>
      <form onSubmit={submit} className="flex w-full gap-2" noValidate>
        <label htmlFor="updown-input" className="sr-only">{t("숫자")}</label>
        <input
          id="updown-input"
          ref={input}
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={done}
          aria-invalid={!!error}
          aria-describedby={error ? "updown-error" : undefined}
          className="input flex-1"
          placeholder={t("1~100")}
          autoFocus
        />
        <button type="submit" className="btn-primary px-5" disabled={done || value === ""}>{t("확인")}</button>
      </form>
      {error && <p id="updown-error" role="alert" className="text-sm text-down">{error}</p>}
      <ol className="w-full space-y-1" aria-label={t("지금까지 넣은 숫자")}>
        {history.map((n, i) => (
          <li key={i} className="flex items-center justify-between rounded-lg bg-surface px-3 py-1.5 text-sm ring-1 ring-line">
            <span className="tabular-nums">{i + 1}. {n}</span>
            {n === target ? (
              <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400"><Check className="h-4 w-4" /> {t("정답")}</span>
            ) : n < target ? (
              <span className="flex items-center gap-1 font-semibold text-accent-strong"><ArrowUp className="h-4 w-4" /> {t("업")}</span>
            ) : (
              <span className="flex items-center gap-1 font-semibold text-down"><ArrowDown className="h-4 w-4" /> {t("다운")}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
