import { useEffect, useState } from "react";
import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { useAuthModal } from "@/lib/authModal";
import { useSession } from "@/lib/session";
import { compactNumber } from "@/lib/format";
import type { Vote } from "@/lib/types";

interface Props {
  score: number;
  myVote: Vote;
  /** 서버에 보내고, 서버가 돌려준 점수와 내 표를 돌려준다. */
  onVote: (dir: Vote) => Promise<{ score: number; myVote: Vote }>;
  layout?: "vertical" | "horizontal";
  disabled?: boolean;
}

/**
 * 추천·비추천. 같은 화살표를 다시 누르면 취소된다.
 * 누르는 즉시 숫자를 바꾸고(낙관적 갱신), 서버 응답이 오면 서버 값으로 맞춘다.
 */
export function VoteButtons({ score, myVote, onVote, layout = "vertical", disabled }: Props) {
  const t = useT();
  const { user } = useSession();
  const { open: openAuth } = useAuthModal();
  const [state, setState] = useState({ score, myVote });
  const [busy, setBusy] = useState(false);

  useEffect(() => setState({ score, myVote }), [score, myVote]);

  const vote = async (dir: 1 | -1) => {
    if (!user) {
      openAuth("login");
      return;
    }
    if (busy || disabled) return;
    const next: Vote = state.myVote === dir ? 0 : dir;
    const prev = state;
    setState({ score: state.score - state.myVote + next, myVote: next });
    setBusy(true);
    try {
      setState(await onVote(next));
    } catch {
      setState(prev);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx("flex items-center", layout === "vertical" ? "flex-col gap-0.5" : "gap-1")}>
      <button
        type="button"
        aria-label={t("추천")}
        aria-pressed={state.myVote === 1}
        disabled={disabled}
        onClick={() => vote(1)}
        className={clsx(
          "rounded-md p-1 transition-colors hover:bg-up/10 disabled:opacity-40",
          state.myVote === 1 ? "text-up" : "text-muted hover:text-up",
        )}
      >
        <ArrowBigUp className="h-5 w-5" fill={state.myVote === 1 ? "currentColor" : "none"} />
      </button>
      <span
        className={clsx(
          "min-w-[2ch] text-center text-sm font-bold tabular-nums",
          state.myVote === 1 && "text-up",
          state.myVote === -1 && "text-down",
        )}
        aria-label={t("점수 {n}", { n: state.score })}
      >
        {compactNumber(state.score)}
      </span>
      <button
        type="button"
        aria-label={t("비추천")}
        aria-pressed={state.myVote === -1}
        disabled={disabled}
        onClick={() => vote(-1)}
        className={clsx(
          "rounded-md p-1 transition-colors hover:bg-down/10 disabled:opacity-40",
          state.myVote === -1 ? "text-down" : "text-muted hover:text-down",
        )}
      >
        <ArrowBigDown className="h-5 w-5" fill={state.myVote === -1 ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
