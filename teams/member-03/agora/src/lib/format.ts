import { currentLang, tr } from "@/i18n";

/** 날짜 · 숫자 표기는 화면 언어를 따른다. */
const locale = () => (currentLang() === "en" ? "en-US" : "ko-KR");

export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return tr("방금 전");
  if (seconds < 3600) return tr("{n}분 전", { n: Math.floor(seconds / 60) });
  if (seconds < 86_400) return tr("{n}시간 전", { n: Math.floor(seconds / 3600) });
  if (seconds < 86_400 * 30) return tr("{n}일 전", { n: Math.floor(seconds / 86_400) });
  if (seconds < 86_400 * 365) return tr("{n}개월 전", { n: Math.floor(seconds / (86_400 * 30)) });
  return tr("{n}년 전", { n: Math.floor(seconds / (86_400 * 365)) });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });
}

const compactFormats = new Map<string, Intl.NumberFormat>();

export function compactNumber(n: number): string {
  if (Math.abs(n) < 1000) return String(n);
  const loc = locale();
  let fmt = compactFormats.get(loc);
  if (!fmt) {
    fmt = new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 });
    compactFormats.set(loc, fmt);
  }
  return fmt.format(n);
}

export function slugify(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return slug || "post";
}

export function postPath(post: { community: string; id: string; title: string }): string {
  return `/c/${post.community}/comments/${post.id}/${encodeURIComponent(slugify(post.title))}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 로그인 뒤 돌아갈 주소. 다른 사이트로 보내는 주소는 받지 않는다. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
