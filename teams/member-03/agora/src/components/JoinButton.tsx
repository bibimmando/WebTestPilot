import { useCallback, useState } from "react";
import { clsx } from "clsx";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n";
import { useAuthModal } from "@/lib/authModal";
import { useCommunities } from "@/lib/communities";
import { fullDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Community } from "@/lib/types";
import { Modal } from "./Modal";

/**
 * 가입 · 탈퇴. 로그인 안 했으면 로그인 모달을 띄운다.
 * 비공개 커뮤니티의 비회원이면 가입 요청 단추가 된다 (PrivateJoinButton).
 */
export function JoinButton({ community, onChange, className }: { community: Community; onChange?: (c: Community) => void; className?: string }) {
  const t = useT();
  const { user, refresh } = useSession();
  const { replace } = useCommunities();
  const { open: openAuth } = useAuthModal();
  const [busy, setBusy] = useState(false);

  if (community.access === "private" && !community.joined && !community.isModerator) {
    return <PrivateJoinButton community={community} onChange={onChange} className={className} />;
  }

  const toggle = async () => {
    if (!user) {
      openAuth("login");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ community: Community }>(`/api/communities/${community.name}/join`);
      replace(r.community);
      onChange?.(r.community);
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={toggle}
      aria-pressed={community.joined}
      className={clsx(community.joined ? "btn-outline" : "btn-primary", className)}
    >
      {t(community.joined ? "가입됨" : "가입하기")}
    </button>
  );
}

/**
 * 비공개 커뮤니티: 초대받았으면 "초대 수락", 요청 중이면 "요청 보냄"(누르면 취소 확인),
 * 거절된 지 24시간이 안 됐거나 활동 정지 중이면 누를 수 없고, 아니면 "가입 요청"(메시지를 붙여 보냄).
 */
function PrivateJoinButton({ community, onChange, className }: { community: Community; onChange?: (c: Community) => void; className?: string }) {
  const t = useT();
  const { user, refresh } = useSession();
  const { replace } = useCommunities();
  const { open: openAuth } = useAuthModal();
  const [dialog, setDialog] = useState<"request" | "cancel" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setDialog(null), []);
  const m = community.membership;

  const run = async (call: () => Promise<{ community: Community }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      replace(r.community);
      onChange?.(r.community);
      setDialog(null);
      setMessage("");
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <button type="button" className={clsx("btn-primary", className)} onClick={() => openAuth("login")}>
        {t("가입 요청")}
      </button>
    );
  }
  if (m?.banned) {
    return <button type="button" disabled className={clsx("btn-outline", className)}>{t("활동 정지 중")}</button>;
  }
  if (m?.invite) {
    const id = m.invite.id;
    return (
      <button type="button" disabled={busy} className={clsx("btn-primary", className)} onClick={() => run(() => api.post(`/api/invites/${id}/accept`))}>
        {t("초대 수락")}
      </button>
    );
  }
  if (m?.retryAt) {
    return (
      <button type="button" disabled className={clsx("btn-outline", className)} title={t("{time}부터 다시 요청할 수 있어요", { time: fullDate(m.retryAt) })}>
        {t("요청 거절됨")}
      </button>
    );
  }

  const pending = !!m?.request;
  return (
    <>
      <button type="button" className={clsx(pending ? "btn-outline" : "btn-primary", className)} aria-haspopup="dialog" onClick={() => setDialog(pending ? "cancel" : "request")}>
        {t(pending ? "요청 보냄" : "가입 요청")}
      </button>

      <Modal open={dialog === "request"} onClose={close} labelledBy="join-request-title" size="lg">
        <h2 id="join-request-title" className="text-xl font-bold">{t("c/{name} 가입 요청", { name: community.name })}</h2>
        <p className="mb-4 mt-1 text-sm text-muted">{t("비공개 커뮤니티예요. 운영진이 승인하면 글을 보고 쓸 수 있어요.")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.post(`/api/communities/${community.name}/requests`, { message }));
          }}
        >
          <label htmlFor="join-message" className="mb-1 block text-sm font-semibold">
            {t("운영진에게 남길 말")} <span className="font-normal text-muted">{t("(선택)")}</span>
          </label>
          <textarea id="join-message" rows={4} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} className="input resize-y" aria-describedby="join-message-count" placeholder={t("어떤 이유로 가입하고 싶은지 적어 주세요.")} />
          <p id="join-message-count" className="mt-1 text-right text-xs text-muted">{[...message].length}/500</p>
          {error && <p role="alert" className="mt-2 text-sm font-medium text-down">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={close}>{t("취소")}</button>
            <button type="submit" className="btn-primary" disabled={busy}>{t("요청 보내기")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={dialog === "cancel"} onClose={close} labelledBy="join-cancel-title">
        <h2 id="join-cancel-title" className="text-xl font-bold">{t("가입 요청을 취소할까요?")}</h2>
        <p className="mt-2 text-sm text-muted">
          {m?.request && t("{time}에 보낸 요청이에요. 운영진이 아직 확인하지 않았어요.", { time: fullDate(m.request.createdAt) })}
        </p>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-down">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={close}>{t("그대로 두기")}</button>
          <button type="button" className="btn-danger" disabled={busy} onClick={() => run(() => api.del(`/api/communities/${community.name}/requests/mine`))}>
            {t("요청 취소")}
          </button>
        </div>
      </Modal>
    </>
  );
}
