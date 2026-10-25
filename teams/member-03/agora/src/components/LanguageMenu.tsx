import { useCallback, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { clsx } from "clsx";
import { LANGS, useI18n } from "@/i18n";
import { useDismiss } from "@/lib/useDismiss";

/** 머리글의 언어 버튼. 로그인하지 않아도 쓸 수 있다. */
export function LanguageMenu() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-bg"
        aria-label={t("언어")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Languages className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" aria-label={t("언어")} className="card absolute right-0 z-40 mt-2 w-40 overflow-hidden py-1 shadow-lg">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.code}
              lang={l.code}
              onClick={() => {
                setOpen(false);
                setLang(l.code);
              }}
              className={clsx("flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-bg", lang === l.code && "font-semibold text-accent-strong")}
            >
              {l.label}
              {lang === l.code && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
