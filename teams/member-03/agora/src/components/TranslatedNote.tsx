import { Languages } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";

/** "번역됨 · 원문 보기" 줄. 번역이 있는 글 · 댓글 밑에 붙는다. */
export function TranslatedNote({ original, onToggle, className }: { original: boolean; onToggle: () => void; className?: string }) {
  const t = useT();
  return (
    <p className={clsx("flex items-center gap-1 text-xs text-muted", className)}>
      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
      {original ? t("원문") : t("번역됨")}
      <span aria-hidden="true">·</span>
      <button type="button" className="font-semibold text-accent hover:underline" onClick={onToggle} aria-pressed={original}>
        {original ? t("번역 보기") : t("원문 보기")}
      </button>
    </p>
  );
}
