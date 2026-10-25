import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bookmark, ChevronDown, LogOut, Mail, Menu, Plus, Settings, Shield, User } from "lucide-react";
import { useT } from "@/i18n";
import { useAuthModal } from "@/lib/authModal";
import { useSession } from "@/lib/session";
import { compactNumber } from "@/lib/format";
import { LanguageMenu } from "./LanguageMenu";
import { Badge, NotificationMenu } from "./NotificationMenu";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";
import { UserAvatar } from "./UserAvatar";

export function Logo() {
  const t = useT();
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={t("Agora 홈")}>
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      <span className="hidden text-xl font-extrabold tracking-tight text-ink sm:inline">agora</span>
    </Link>
  );
}

/** onOpenMenu: 좁은 화면(왼쪽 메뉴가 숨는 곳)에서 메뉴 서랍을 연다. */
export function Header({ onOpenMenu, menuOpen: drawerOpen = false }: { onOpenMenu?: () => void; menuOpen?: boolean }) {
  const t = useT();
  const { user, logout, refresh } = useSession();
  const { open: openAuth } = useAuthModal();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 화면을 옮길 때마다 읽지 않은 알림·쪽지 수를 새로 받는다.
  const loggedIn = !!user;
  useEffect(() => {
    if (loggedIn) void refresh();
  }, [location.pathname, loggedIn, refresh]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const karma = user ? user.karma.post + user.karma.comment : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        {onOpenMenu && (
          <button type="button" onClick={onOpenMenu} aria-label={t("메뉴 열기")} aria-expanded={drawerOpen} className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-bg lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
        )}
        <Logo />

        <SearchBox />

        {user ? (
          <div className="flex shrink-0 items-center gap-1">
            <Link to="/submit" className="btn-ghost hidden sm:inline-flex">
              <Plus className="h-4 w-4" /> {t("글쓰기")}
            </Link>
            {/* 좁은 화면에서는 자리가 모자라 숨긴다. 쪽지함은 사용자 메뉴에도 있다. */}
            <Link to="/messages" className="relative hidden h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-bg sm:flex" aria-label={t("쪽지")}>
              <Mail className="h-5 w-5" />
              <Badge count={user.unread.messages} label={t("읽지 않은 쪽지")} />
            </Link>
            <NotificationMenu />
            <ThemeToggle />
            <LanguageMenu />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-bg"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <UserAvatar name={user.name} src={user.avatar} size="md" className="h-8 w-8" />
                <span className="hidden text-left leading-tight md:block">
                  <span className="block text-sm font-semibold">{user.name}</span>
                  <span className="block text-xs text-muted">{t("카르마 {n}", { n: compactNumber(karma) })}</span>
                </span>
                <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
              </button>
              {menuOpen && (
                <div role="menu" className="card absolute right-0 mt-2 w-52 overflow-hidden py-1 shadow-lg">
                  <Link role="menuitem" to={`/u/${user.name}`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg" onClick={() => setMenuOpen(false)}>
                    <User className="h-4 w-4" /> {t("내 프로필")}
                  </Link>
                  <Link role="menuitem" to={`/u/${user.name}?tab=saved`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg" onClick={() => setMenuOpen(false)}>
                    <Bookmark className="h-4 w-4" /> {t("저장한 글")}
                  </Link>
                  <Link role="menuitem" to="/messages" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg" onClick={() => setMenuOpen(false)}>
                    <Mail className="h-4 w-4" /> {t("쪽지함")}
                  </Link>
                  <Link role="menuitem" to="/settings" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg" onClick={() => setMenuOpen(false)}>
                    <Settings className="h-4 w-4" /> {t("설정")}
                  </Link>
                  {user.moderates.length > 0 && (
                    <div className="my-1 border-t border-line pt-1">
                      <p className="px-4 py-1 text-xs font-semibold text-muted">{t("운영 중인 커뮤니티")}</p>
                      {user.moderates.map((c) => (
                        <Link key={c} role="menuitem" to={`/c/${c}/mod`} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-bg" onClick={() => setMenuOpen(false)}>
                          <Shield className="h-4 w-4" /> {t("c/{name} 운영 도구", { name: c })}
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="my-1 border-t border-line" />
                  <button
                    role="menuitem"
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-bg"
                    onClick={async () => {
                      setMenuOpen(false);
                      await logout();
                      navigate("/");
                    }}
                  >
                    <LogOut className="h-4 w-4" /> {t("로그아웃")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <LanguageMenu />
            <button type="button" className="btn-outline" onClick={() => openAuth("login")}>{t("로그인")}</button>
            <button type="button" className="btn-primary hidden sm:inline-flex" onClick={() => openAuth("signup")}>{t("회원가입")}</button>
          </div>
        )}
      </div>
    </header>
  );
}
