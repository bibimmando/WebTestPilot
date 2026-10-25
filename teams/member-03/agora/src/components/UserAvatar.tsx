import { clsx } from "clsx";

const PALETTE = [
  ["#fde68a", "#d97706"],
  ["#bfdbfe", "#2563eb"],
  ["#bbf7d0", "#059669"],
  ["#fbcfe8", "#db2777"],
  ["#ddd6fe", "#7c3aed"],
  ["#fed7aa", "#ea580c"],
  ["#a5f3fc", "#0891b2"],
];

function hash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const SIZES = {
  xs: "h-5 w-5",
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
} as const;

/**
 * 프로필 사진. 사진이 없으면 이름에서 색과 표정을 정해 기본 캐릭터를 그린다.
 * 이름 옆에 붙어 나오므로 대체 텍스트는 비워 둔다.
 */
export function UserAvatar({ name, src, size = "sm", className }: { name: string; src: string | null; size?: keyof typeof SIZES; className?: string }) {
  const classes = clsx("shrink-0 rounded-full bg-bg object-cover", SIZES[size], className);
  if (src) return <img src={src} alt="" className={classes} loading="lazy" decoding="async" />;

  const h = hash(name);
  const [light, dark] = PALETTE[h % PALETTE.length];
  const smile = (h >> 3) % 3;
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={classes}>
      <rect width="40" height="40" fill={light} />
      <ellipse cx="20" cy="40" rx="15" ry="13" fill={dark} />
      <circle cx="20" cy="18" r="10" fill="#fff" />
      <circle cx="16.5" cy="17" r="1.6" fill="#1f2937" />
      <circle cx="23.5" cy="17" r="1.6" fill="#1f2937" />
      {smile === 0 && <path d="M16.5 21.5q3.5 3 7 0" stroke="#1f2937" strokeWidth="1.4" fill="none" strokeLinecap="round" />}
      {smile === 1 && <path d="M17 22h6" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />}
      {smile === 2 && <circle cx="20" cy="22" r="1.5" fill="#1f2937" />}
    </svg>
  );
}
