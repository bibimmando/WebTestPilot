import { useCallback, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Compass, Flame, Gamepad2, Home, Plus } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { useAuthModal } from "@/lib/authModal";
import { compactNumber } from "@/lib/format";
import { useGames } from "@/lib/games";
import { useSession } from "@/lib/session";
import { CreateCommunityModal } from "./CreateCommunity";
import { GameIcon } from "./GameIcon";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    isActive ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink hover:bg-surface",
  );

const GAMES_OPEN_KEY = "agora.nav.games";

function loadOpen(): boolean {
  try {
    return localStorage.getItem(GAMES_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function SideNav() {
  const t = useT();
  const { pathname } = useLocation();
  const { user } = useSession();
  const { open: openAuth } = useAuthModal();
  const [creating, setCreating] = useState(false);
  const closeCreate = useCallback(() => setCreating(false), []);
  // 지금 보고 있는 메뉴를 다시 누르면 맨 위로 올라간다.
  const toTopIfHere = (to: string) => () => {
    if (pathname === to) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <nav aria-label={t("둘러보기")} className="space-y-4">
      <div className="space-y-1">
        <NavLink to="/" end className={linkClass} onClick={toTopIfHere("/")}>
          <Home className="h-4 w-4" /> {t("홈")}
        </NavLink>
        <NavLink to="/popular" className={linkClass} onClick={toTopIfHere("/popular")}>
          <Flame className="h-4 w-4" /> {t("인기")}
        </NavLink>
        <NavLink to="/explore" className={linkClass} onClick={toTopIfHere("/explore")}>
          <Compass className="h-4 w-4" /> {t("탐색")}
        </NavLink>
        <button
          type="button"
          onClick={() => (user ? setCreating(true) : openAuth("login"))}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-surface"
        >
          <Plus className="h-4 w-4" /> {t("커뮤니티 만들기")}
        </button>
      </div>

      <GamesSection />
      <CreateCommunityModal open={creating} onClose={closeCreate} />
    </nav>
  );
}

/** Agora 게임. 첫 게임은 큰 카드로, 나머지는 한 줄씩 보여 준다. 접은 상태는 이 브라우저에 기억한다. */
function GamesSection() {
  const t = useT();
  const { data: games } = useGames();
  const [open, setOpen] = useState(loadOpen);

  const toggle = () => {
    setOpen((prev) => {
      try {
        localStorage.setItem(GAMES_OPEN_KEY, prev ? "0" : "1");
      } catch {
        // 저장이 막혀 있으면 이번 화면에서만 접는다.
      }
      return !prev;
    });
  };

  const [featured, ...rest] = games ?? [];
  return (
    <section className="border-t border-line pt-4" aria-labelledby="nav-games-heading">
      <h2 id="nav-games-heading">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="nav-games-list"
          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface"
        >
          {t("Agora 게임")}
          <ChevronDown className={clsx("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </h2>
      {open && (
        <div id="nav-games-list" className="mt-2 space-y-0.5">
          {featured && (
            <NavLink
              to={`/games/${featured.id}`}
              className={({ isActive }) =>
                clsx("mb-2 flex items-center gap-3 rounded-xl p-3 text-gray-900 transition-[filter] hover:brightness-95", isActive && "ring-2 ring-accent")
              }
              style={{ backgroundColor: featured.color }}
            >
              <span className="shrink-0 rounded-full ring-2 ring-gray-900">
                <GameIcon id={featured.id} color={featured.color} size="md" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-bold">{featured.title}</span>
                <span className="block truncate text-xs">{featured.tagline}</span>
                <span className="block text-[11px] opacity-75">{t("이번 달 {n}명 플레이", { n: compactNumber(featured.monthlyPlayers) })}</span>
              </span>
            </NavLink>
          )}
          {rest.map((g) => (
            <NavLink key={g.id} to={`/games/${g.id}`} className={linkClass}>
              <GameIcon id={g.id} color={g.color} size="sm" />
              <span className="truncate">{g.title}</span>
            </NavLink>
          ))}
          <NavLink to="/games" end className={linkClass}>
            <Gamepad2 className="h-4 w-4" /> {t("게임 더 보기")}
          </NavLink>
        </div>
      )}
    </section>
  );
}
