import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Lock, Search } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { compactNumber } from "@/lib/format";
import { useDismiss } from "@/lib/useDismiss";
import type { Community } from "@/lib/types";
import { CommunityAvatar } from "./CommunityAvatar";

/**
 * 글 올릴 커뮤니티 고르기. 알약 모양 단추를 누르면 검색 칸과 목록이 열린다.
 * 검색 칸은 combobox — 위 · 아래 방향키로 옮기고 Enter 로 고르고 Esc 로 닫는다.
 * 운영진만 글을 쓰는 곳은 고를 수 없게 보여 준다. 볼 수 없는 비공개 커뮤니티는 아예 빼 둔다.
 */
export function CommunityPicker({
  list,
  value,
  onChange,
  error,
}: {
  list: Community[];
  value: string;
  onChange: (name: string) => void;
  error?: string;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useDismiss(box, open, () => setOpen(false));

  const selected = list.find((c) => c.name === value);
  // 가입한 곳을 먼저, 그다음 회원 수 순
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((c) => c.canView)
      .filter((c) => !needle || c.name.includes(needle) || c.title.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.joined) - Number(a.joined) || b.members - a.members);
  }, [list, q]);
  const locked = (c: Community) => c.restricted && !c.isModerator;

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);

  const choose = (c: Community | undefined) => {
    if (!c || locked(c)) return;
    onChange(c.name);
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex h-12 items-center gap-2 rounded-full border bg-surface pl-2 pr-4 text-[15px] font-semibold hover:bg-bg",
          error ? "border-down" : "border-ink/70",
        )}
      >
        {selected ? (
          <>
            <CommunityAvatar name={selected.name} title={selected.title} icon={selected.icon} color={selected.color} size="sm" />
            <span>c/{selected.name}</span>
          </>
        ) : (
          <span className="pl-2">{t("커뮤니티 선택")}</span>
        )}
        <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}

      {open && (
        <div className="card absolute left-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="h-4 w-4 text-muted" aria-hidden="true" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={options[active] ? `${id}-opt-${options[active].name}` : undefined}
              aria-label={t("커뮤니티 검색")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder={t("커뮤니티 검색")}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={t("커뮤니티")} className="max-h-80 overflow-y-auto py-1">
            {options.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{t("맞는 커뮤니티가 없어요.")}</li>}
            {options.map((c, i) => (
              <li
                key={c.name}
                id={`${id}-opt-${c.name}`}
                role="option"
                aria-selected={c.name === value}
                aria-disabled={locked(c)}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2",
                  locked(c) ? "opacity-50" : "cursor-pointer",
                  i === active && "bg-bg",
                )}
              >
                <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">c/{c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {locked(c) ? t("운영진만 글을 쓸 수 있어요.") : `${t("회원 {n}", { n: compactNumber(c.members) })}${c.joined ? ` · ${t("가입됨")}` : ""}`}
                  </span>
                </span>
                {locked(c) && <Lock className="h-4 w-4 text-muted" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
