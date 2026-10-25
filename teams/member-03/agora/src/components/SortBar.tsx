import { useSearchParams } from "react-router-dom";
import { Flame, LayoutList, Rows3, Sparkles, TrendingUp } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import type { ViewMode } from "@/lib/viewMode";

const SORTS = [
  { value: "hot", label: "인기@@sort", icon: Flame },
  { value: "new", label: "최신", icon: Sparkles },
  { value: "top", label: "추천순", icon: TrendingUp },
] as const;

const WINDOWS = [
  { value: "hour", label: "1시간" },
  { value: "day", label: "오늘" },
  { value: "week", label: "이번 주" },
  { value: "month", label: "이번 달" },
  { value: "year", label: "올해" },
  { value: "all", label: "전체 기간" },
];

export interface SortDefaults {
  sort: "hot" | "new" | "top";
  t: string;
}

/** 화면마다 기본 정렬이 다르다. 홈은 인기순, 인기는 이번 주 추천순, 전체는 최신순. */
export const FEED_DEFAULTS: Record<"home" | "popular" | "all" | "community", SortDefaults> = {
  home: { sort: "hot", t: "day" },
  popular: { sort: "top", t: "week" },
  all: { sort: "new", t: "day" },
  community: { sort: "hot", t: "day" },
};

/**
 * 정렬은 주소(?sort=&t=)에 남긴다. 새로고침·뒤로 가기·링크 공유에서 그대로 유지된다.
 * 화면의 기본값과 같으면 주소에서 뺀다.
 */
export function SortBar({
  view,
  onViewChange,
  defaults = FEED_DEFAULTS.community,
}: {
  view?: ViewMode;
  onViewChange?: (mode: ViewMode) => void;
  defaults?: SortDefaults;
}) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const sort = params.get("sort") ?? defaults.sort;
  const range = params.get("t") ?? defaults.t;

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };

  return (
    <div className="card mb-3 flex flex-wrap items-center gap-1 p-1.5" role="toolbar" aria-label={t("정렬")}>
      {SORTS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={sort === value}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (value === defaults.sort) next.delete("sort");
            else next.set("sort", value);
            if (value !== "top") next.delete("t");
            setParams(next);
          }}
          className={clsx(
            "btn px-3 py-1.5",
            sort === value ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-bg hover:text-ink",
          )}
        >
          <Icon className="h-4 w-4" /> {t(label)}
        </button>
      ))}
      {sort === "top" && (
        <label className="flex items-center gap-2 pl-2 text-sm text-muted">
          {t("기간")}
          <select
            value={range}
            onChange={(e) => update("t", e.target.value === defaults.t ? null : e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>{t(w.label)}</option>
            ))}
          </select>
        </label>
      )}
      {view && onViewChange && (
        <div className="ml-auto flex gap-0.5" role="group" aria-label={t("보기 방식")}>
          {(
            [
              ["card", "카드로 보기", Rows3],
              ["compact", "목록으로 보기", LayoutList],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-label={t(label)}
              title={t(label)}
              aria-pressed={view === value}
              onClick={() => onViewChange(value)}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full",
                view === value ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-bg hover:text-ink",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
