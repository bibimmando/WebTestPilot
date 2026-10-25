import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { useBugBodyAttribute } from "@/lib/bugs";
import { Header } from "./Header";
import { ScrollToTop } from "./ScrollToTop";
import { SideNav } from "./SideNav";

const COLLAPSED_KEY = "agora.nav.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Layout() {
  useBugBodyAttribute();
  const t = useT();
  const { pathname } = useLocation();
  // 넓은 화면: 왼쪽 메뉴 접기 (이 브라우저에 기억). 좁은 화면: 머리글 단추로 여는 서랍.
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1");
      } catch {
        // 저장이 막혀 있으면 이번 방문 동안만 접는다.
      }
      return !prev;
    });
  };

  // 서랍에서 메뉴를 골라 화면이 바뀌면 닫는다.
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <div className="min-h-screen">
      <ScrollToTop />
      <Header onOpenMenu={() => setDrawer(true)} menuOpen={drawer} />
      {/* 화면 너비를 다 쓴다: 왼쪽 메뉴는 화면 끝에 붙고, 본문이 나머지를 채운다. */}
      <div className="flex">
        <aside className={clsx("relative hidden shrink-0 border-r border-line transition-[width] duration-200 lg:block", collapsed ? "w-6" : "w-64")}>
          <div className="sticky top-14 h-[calc(100vh-3.5rem)]">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-controls="side-nav"
              aria-label={t(collapsed ? "메뉴 펼치기" : "메뉴 접기")}
              title={t(collapsed ? "메뉴 펼치기" : "메뉴 접기")}
              className="absolute -right-5 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-sm hover:bg-bg"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div id="side-nav" hidden={collapsed} className="h-full overflow-y-auto px-4 py-4 pr-6">
              <SideNav />
            </div>
          </div>
        </aside>
        <main className={clsx("min-w-0 flex-1 px-4 pb-16 pt-5", collapsed ? "lg:pl-10 lg:pr-6" : "lg:px-6 lg:pl-8")}>
          {/* 아주 넓은 화면에서 글줄이 너무 길어지지 않게만 막는다. */}
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
      <NavDrawer open={drawer} onClose={closeDrawer} />
    </div>
  );
}

/** 좁은 화면의 메뉴 서랍. ESC · 바깥 누르기 · 닫기 단추로 닫히고, 열려 있는 동안 Tab 은 서랍 안에서만 돈다. */
function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")].filter((el) => el.offsetParent !== null);
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ background: "rgb(0 0 0 / 0.5)" }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={t("둘러보기")} className="h-full w-72 max-w-[85vw] overflow-y-auto bg-surface px-4 pb-6 pt-3 shadow-2xl">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={onClose} aria-label={t("메뉴 닫기")} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-bg">
            <X className="h-5 w-5" />
          </button>
        </div>
        <SideNav />
      </div>
    </div>
  );
}

/** 본문 + 오른쪽 보조 영역 두 칸 배치 */
export function TwoColumn({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">{children}</div>
      {aside && <aside className="hidden w-80 shrink-0 space-y-4 xl:block">{aside}</aside>}
    </div>
  );
}
