import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useT } from "@/i18n";
import { GameIcon } from "@/components/GameIcon";
import { errorMessage } from "@/lib/api";
import { compactNumber } from "@/lib/format";
import { scoreText, useGames } from "@/lib/games";

/** /games  Agora 게임 목록 */
export function GamesPage() {
  const t = useT();
  const { data: games, error } = useGames();

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t("Agora 게임")}</h1>
      <p className="mb-4 text-sm text-muted">{t("잠깐 쉬어 가요. 로그인하면 최고 기록이 순위표에 올라가요.")}</p>

      {error ? (
        <p role="alert" className="card p-6 text-sm text-down">{errorMessage(error)}</p>
      ) : !games ? (
        <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {games.map((g) => (
            <li key={g.id} className="card flex flex-col overflow-hidden">
              <div className="flex items-center gap-3 p-4" style={{ backgroundColor: g.color }}>
                <GameIcon id={g.id} color="#ffffffcc" size="lg" />
                <div className="min-w-0 text-gray-900">
                  <h2 className="truncate text-lg font-bold">{g.title}</h2>
                  <p className="truncate text-sm">{g.tagline}</p>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <p className="text-sm text-muted">{g.howTo}</p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <div className="text-xs text-muted">
                    <p>{t("이번 달 {n}명 플레이", { n: compactNumber(g.monthlyPlayers) })}</p>
                    {g.me?.best != null && (
                      <p className="flex items-center gap-1 font-semibold text-accent-strong">
                        <Trophy className="h-3.5 w-3.5" /> {t("내 최고 기록 {score}", { score: scoreText(t, g, g.me.best) })}
                      </p>
                    )}
                  </div>
                  <Link to={`/games/${g.id}`} className="btn-primary px-5">{t("플레이")}</Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
