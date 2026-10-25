import { Moon, Sun } from "lucide-react";
import { useT } from "@/i18n";
import { useTheme } from "@/lib/theme";

/** 머리글의 다크 모드 단추. 누를 때마다 밝은 · 어두운 테마를 오간다. */
export function ThemeToggle() {
  const t = useT();
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("다크 모드")}
      title={t("다크 모드")}
      onClick={toggle}
      className="flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-bg"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
