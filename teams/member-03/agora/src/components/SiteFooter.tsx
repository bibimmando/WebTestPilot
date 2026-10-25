import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { useT } from "@/i18n";

export const POLICY_LINKS = [
  { id: "rules", label: "Agora 규칙" },
  { id: "privacy", label: "개인정보처리방침" },
  { id: "terms", label: "이용약관" },
  { id: "accessibility", label: "접근성" },
] as const;

/** 사이트 정책 링크와 저작권 표시. 홈 오른쪽 칸 맨 아래에 둔다. */
export function SiteFooter({ className }: { className?: string }) {
  const t = useT();
  return (
    <footer className={clsx("px-1 text-xs text-muted", className)}>
      <nav aria-label={t("사이트 정책")} className="flex flex-wrap gap-x-3 gap-y-1.5">
        {POLICY_LINKS.map((l) => (
          <Link key={l.id} to={`/policies/${l.id}`} className="hover:text-ink hover:underline">
            {t(l.label)}
          </Link>
        ))}
      </nav>
      <p className="mt-3">{t("© {year} Agora. 모든 권리 보유.", { year: 2026 })}</p>
    </footer>
  );
}
