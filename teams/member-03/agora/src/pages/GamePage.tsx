import { useCallback, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft, PartyPopper, RotateCcw, Trophy } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { GameIcon } from "@/components/GameIcon";
import { TwoColumn } from "@/components/Layout";
import { UserAvatar } from "@/components/UserAvatar";
import { Lights } from "@/games/Lights";
import { Memory } from "@/games/Memory";
import { UpDown } from "@/games/UpDown";
import { Word5 } from "@/games/Word5";
import { seedFromUrl } from "@/games/random";
import type { BoardProps, GameResult } from "@/games/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuthModal } from "@/lib/authModal";
import { compactNumber } from "@/lib/format";
import { scoreText } from "@/lib/games";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Game, GameDetail } from "@/lib/types";
import { NotFoundPage } from "./NotFoundPage";

const BOARDS: Record<string, (props: BoardProps) => JSX.Element> = { word5: Word5, memory: Memory, lights: Lights, updown: UpDown };

interface Outcome extends GameResult {
  /** 서버에 남긴 결과. 로그인하지 않았으면 null */
  saved: { newBest: boolean; rank: number | null } | null;
  saveError: string;
}

/** /games/:id  게임 한 판 + 내 기록 + 순위표. 다른 게임으로 옮기면 판 · 결과를 새로 시작한다. */
export function GamePage() {
  const { id = "" } = useParams();
  return <GameScreen key={id} id={id} />;
}

function GameScreen({ id }: { id: string }) {
  const t = useT();
  const { search } = useLocation();
  const urlSeed = seedFromUrl(search);
  const { user } = useSession();
  const { open } = useAuthModal();
  const { data, error, reload, setData } = useAsync(() => api.get<GameDetail>(`/api/games/${id}`), [id, user?.name]);
  const [round, setRound] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const finish = useCallback(
    async (result: GameResult) => {
      setOutcome({ ...result, saved: null, saveError: "" });
      if (!user) return;
      try {
        const r = await api.post<{ game: Game; newBest: boolean; rank: number | null }>(`/api/games/${id}/plays`, { score: result.score, won: result.won });
        setOutcome((o) => o && { ...o, saved: { newBest: r.newBest, rank: r.rank } });
        setData((prev) => prev && { ...prev, game: r.game });
        reload();
      } catch (err) {
        setOutcome((o) => o && { ...o, saveError: errorMessage(err) });
      }
    },
    [id, user, reload, setData],
  );

  const again = () => {
    setOutcome(null);
    setRound((r) => r + 1);
  };

  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error) return <p role="alert" className="card p-6 text-sm text-down">{errorMessage(error)}</p>;
  if (!data) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;

  const { game, leaderboard } = data;
  const Board = BOARDS[game.id];
  // 주소의 ?seed= 가 서버 시드보다 먼저
  const seed = urlSeed ?? data.seed;

  return (
    <TwoColumn
      aside={
        <>
          <MyRecord game={game} />
          <Leaderboard game={game} rows={leaderboard} me={user?.name} />
        </>
      }
    >
      <Link to="/games" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" /> {t("모든 게임")}
      </Link>
      <div className="card overflow-hidden">
        <header className="flex items-center gap-3 p-4 text-gray-900" style={{ backgroundColor: game.color }}>
          <GameIcon id={game.id} color="#ffffffcc" size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{game.title}</h1>
            <p className="text-sm">{game.tagline} · {t("이번 달 {n}명 플레이", { n: compactNumber(game.monthlyPlayers) })}</p>
          </div>
        </header>
        <div className="space-y-5 p-4 sm:p-6">
          <p className="text-sm text-muted">{game.howTo}</p>

          {outcome && <OutcomePanel game={game} outcome={outcome} loggedIn={!!user} onAgain={again} onLogin={() => open("login")} />}

          {seed !== null && <p className="text-xs text-muted">{t("시드 {n} 고정 · 같은 판이 나와요", { n: seed })}</p>}
          {Board && <Board key={`${seed}:${round}`} round={round} seed={seed} onFinish={finish} />}
        </div>
      </div>
    </TwoColumn>
  );
}

function OutcomePanel({ game, outcome, loggedIn, onAgain, onLogin }: { game: Game; outcome: Outcome; loggedIn: boolean; onAgain: () => void; onLogin: () => void }) {
  const t = useT();
  return (
    <section role="status" className={clsx("rounded-xl p-4", outcome.won ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:ring-emerald-400/30" : "bg-bg ring-1 ring-line")}>
      <p className="flex items-center gap-2 font-bold">
        {outcome.won ? <PartyPopper className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : null}
        {outcome.won ? t("성공! {score}", { score: scoreText(t, game, outcome.score) }) : t("아쉬워요. 정답은 {answer} 였어요.", { answer: outcome.answer ?? "" })}
      </p>
      <p className="mt-1 text-sm text-muted">
        {!loggedIn
          ? t("로그인하면 기록이 순위표에 남아요.")
          : outcome.saveError
            ? outcome.saveError
            : !outcome.saved
              ? t("기록을 남기는 중…")
              : outcome.saved.newBest
                ? t("새 최고 기록이에요! 지금 {rank}위", { rank: outcome.saved.rank ?? "-" })
                : outcome.won
                  ? t("기록을 남겼어요. 최고 기록은 그대로예요.")
                  : t("판 수만 기록했어요.")}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onAgain} className="btn-primary">
          <RotateCcw className="h-4 w-4" /> {t("다시 하기")}
        </button>
        {!loggedIn && (
          <button type="button" onClick={onLogin} className="btn-outline">{t("로그인")}</button>
        )}
      </div>
    </section>
  );
}

function MyRecord({ game }: { game: Game }) {
  const t = useT();
  if (!game.me) return null;
  return (
    <section className="card p-4" aria-labelledby="my-record-heading">
      <h2 id="my-record-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("내 기록")}</h2>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-muted">{t("최고 기록")}</dt>
          <dd className="font-bold">{game.me.best ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("순위")}</dt>
          <dd className="font-bold">{game.me.rank ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("판 수")}</dt>
          <dd className="font-bold">{game.me.plays}</dd>
        </div>
      </dl>
    </section>
  );
}

function Leaderboard({ game, rows, me }: { game: Game; rows: GameDetail["leaderboard"]; me?: string }) {
  const t = useT();
  return (
    <section className="card p-4" aria-labelledby="leaderboard-heading">
      <h2 id="leaderboard-heading" className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Trophy className="h-3.5 w-3.5" /> {t("순위표")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t("아직 기록이 없어요. 첫 기록을 세워 보세요!")}</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li key={r.name} className={clsx("flex items-center gap-2 rounded-lg px-2 py-1 text-sm", r.name === me && "bg-accent-soft")}>
              <span className="w-5 text-right font-bold tabular-nums text-muted">{r.rank}</span>
              <UserAvatar name={r.name} src={r.avatar} size="xs" />
              <Link to={`/u/${r.name}`} className="min-w-0 flex-1 truncate hover:underline">u/{r.name}</Link>
              <span className="text-xs text-muted">{scoreText(t, game, r.best)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
