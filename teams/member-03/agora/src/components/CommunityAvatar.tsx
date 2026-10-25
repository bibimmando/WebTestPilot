import { clsx } from "clsx";
import { Eye, Lock } from "lucide-react";
import { useT } from "@/i18n";
import type { Community } from "@/lib/types";

const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#0f766e", "#b45309"];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const SIZES = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-7 w-7 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-2xl ring-4 ring-surface",
  xl: "h-20 w-20 text-3xl ring-4 ring-surface",
} as const;

/** 커뮤니티 아이콘. 올린 아이콘이 없으면 이름 첫 글자와 대표 색으로 만든다. */
export function CommunityAvatar({
  name,
  title,
  icon,
  color,
  size = "sm",
}: {
  name: string;
  title: string;
  icon?: string | null;
  color?: string;
  size?: keyof typeof SIZES;
}) {
  const classes = clsx("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", SIZES[size]);
  if (icon) return <img src={icon} alt="" aria-hidden="true" className={clsx(classes, "bg-bg object-cover")} loading="lazy" decoding="async" />;
  return (
    <span aria-hidden="true" className={classes} style={{ backgroundColor: color ?? colorFor(name) }}>
      {title.slice(0, 1)}
    </span>
  );
}

/** 커뮤니티 배너. 올린 배너가 없으면 대표 색으로 칠한다. */
export function CommunityBanner({ banner, color, className }: { banner: string | null; color: string; className?: string }) {
  if (banner) return <img src={banner} alt="" aria-hidden="true" className={clsx("w-full bg-bg object-cover", className)} decoding="async" />;
  return <div aria-hidden="true" className={clsx("w-full", className)} style={{ background: `linear-gradient(120deg, ${color}, ${color}cc)` }} />;
}

/** 공개 범위 · 성인용 표시. 일반 공개 커뮤니티면 아무것도 그리지 않는다. */
export function AccessBadges({ community, className }: { community: Pick<Community, "access" | "mature">; className?: string }) {
  const t = useT();
  if (community.access === "public" && !community.mature) return null;
  return (
    <div className={clsx("flex flex-wrap gap-1.5", className)}>
      {community.access === "restricted" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line">
          <Eye className="h-3 w-3" aria-hidden="true" /> {t("제한 · 운영진만 글쓰기")}
        </span>
      )}
      {community.access === "private" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line">
          <Lock className="h-3 w-3" aria-hidden="true" /> {t("비공개")}
        </span>
      )}
      {community.mature && (
        <span className="inline-flex items-center rounded-full bg-down/10 px-2 py-0.5 text-xs font-bold text-down ring-1 ring-down/30">{t("18+ 성인용")}</span>
      )}
    </div>
  );
}
