import { useT } from "@/i18n";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Shield, UserMinus, X } from "lucide-react";
import { clsx } from "clsx";
import { UserAvatar } from "@/components/UserAvatar";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import type { Community, InviteItem, JoinRequestItem, MemberItem } from "@/lib/types";

/**
 * 운영 도구 · 회원 (/c/:name/mod/members)
 *   가입 요청: 대기 중인 요청을 승인 · 거절(이유 선택). 처리한 요청도 볼 수 있다.
 *   초대: 아이디로 초대하고, 대기 중인 초대를 취소한다.
 *   회원: 지금 회원 목록. 운영진이 아닌 회원은 내보낼 수 있다.
 * 가입 요청 · 초대는 비공개 커뮤니티에서만 받는다.
 */
export function ModMembers({ community }: { community: Community }) {
  const t = useT();
  const isPrivate = community.access === "private";
  const members = useAsync(() => api.get<{ items: MemberItem[] }>(`/api/communities/${community.name}/members`), [community.name]);

  return (
    <div className="space-y-6">
      {isPrivate ? (
        <>
          <Requests community={community} onApproved={members.reload} />
          <Invites community={community} />
        </>
      ) : (
        <p className="card p-4 text-sm text-muted">
          {t("가입 요청과 초대는 비공개 커뮤니티에서만 받아요. 지금은 누구나 바로 가입할 수 있어요.")}{" "}
          <Link to={`/c/${community.name}/mod/settings`} className="font-semibold text-accent hover:underline">{t("공개 범위 바꾸기")}</Link>
        </p>
      )}
      <Members community={community} state={members} />
    </div>
  );
}

function Requests({ community, onApproved }: { community: Community; onApproved: () => void }) {
  const t = useT();
  const [decided, setDecided] = useState(false);
  const { data, error, reload } = useAsync(
    () => api.get<{ items: JoinRequestItem[] }>(`/api/communities/${community.name}/requests${decided ? "?status=decided" : ""}`),
    [community.name, decided],
  );
  const [denying, setDenying] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (r: JoinRequestItem, action: "approve" | "deny") => {
    setBusy(r.id);
    setActionError(null);
    try {
      await api.post(`/api/requests/${r.id}/${action}`, action === "deny" ? { reason } : {});
      setDenying(null);
      setReason("");
      reload();
      if (action === "approve") onApproved();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="requests-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="requests-heading" className="text-lg font-bold">{t("가입 요청")}</h2>
        <div className="flex gap-1.5" role="group" aria-label={t("요청 상태")}>
          {([false, true] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={decided === value}
              onClick={() => setDecided(value)}
              className={clsx("btn px-3 py-1 text-xs", decided === value ? "bg-ink text-surface" : "border border-line bg-surface text-muted hover:text-ink")}
            >
              {t(value ? "처리한 요청" : "대기 중")}
            </button>
          ))}
        </div>
      </div>
      {actionError && <p role="alert" className="mb-2 text-sm font-medium text-down">{actionError}</p>}
      {error ? (
        <p role="alert" className="card p-4 text-sm text-down">{errorMessage(error)}</p>
      ) : !data ? (
        <p className="card p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : data.items.length === 0 ? (
        <p className="card p-6 text-center text-sm text-muted">{t(decided ? "처리한 요청이 없어요." : "기다리는 가입 요청이 없어요.")}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {data.items.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <UserAvatar name={r.user} src={r.avatar} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <Link to={`/u/${r.user}`} className="font-semibold hover:underline">u/{r.user}</Link>
                    <span className="ml-1.5 text-xs text-muted" title={fullDate(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                  </p>
                  {r.message ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{r.message}</p> : <p className="mt-1 text-sm italic text-muted">{t("남긴 말 없음")}</p>}
                  {decided && (
                    <p className={clsx("mt-1 text-xs font-semibold", r.status === "approved" ? "text-up" : "text-down")}>
                      {t(r.status === "approved" ? "승인됨" : "거절됨")}
                      {r.decidedBy && ` · u/${r.decidedBy}`}
                      {r.reason && ` · ${t("이유: {reason}", { reason: r.reason })}`}
                    </p>
                  )}
                </div>
                {!decided && denying !== r.id && (
                  <div className="flex gap-2">
                    <button type="button" className="btn-outline py-1.5" disabled={busy === r.id} onClick={() => { setDenying(r.id); setReason(""); }}>
                      <X className="h-4 w-4" /> {t("거절")}
                    </button>
                    <button type="button" className="btn-primary py-1.5" disabled={busy === r.id} onClick={() => decide(r, "approve")}>
                      <Check className="h-4 w-4" /> {t("승인")}
                    </button>
                  </div>
                )}
              </div>
              {denying === r.id && (
                <form
                  className="mt-3 flex flex-wrap items-end gap-2 pl-12"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void decide(r, "deny");
                  }}
                >
                  <label className="min-w-[12rem] flex-1">
                    <span className="mb-1 block text-xs font-semibold">{t("거절 이유")} <span className="font-normal text-muted">{t("(선택, 요청한 사람에게 보여요)")}</span></span>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="input py-1.5" autoFocus />
                  </label>
                  <button type="button" className="btn-ghost" onClick={() => setDenying(null)}>{t("취소")}</button>
                  <button type="submit" className="btn-danger" disabled={busy === r.id}>{t("거절하기")}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Invites({ community }: { community: Community }) {
  const t = useT();
  const { data, error, reload } = useAsync(() => api.get<{ items: InviteItem[] }>(`/api/communities/${community.name}/invites`), [community.name]);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setSent(null);
    try {
      const r = await api.post<{ invite: InviteItem }>(`/api/communities/${community.name}/invites`, { username, message });
      setSent(r.invite.user);
      setUsername("");
      setMessage("");
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (i: InviteItem) => {
    try {
      await api.del(`/api/invites/${i.id}`);
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <section aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="mb-2 text-lg font-bold">{t("초대")}</h2>
      <form onSubmit={send} className="card space-y-3 p-4" noValidate>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="invite-username" className="mb-1 block text-sm font-semibold">{t("아이디")}</label>
            <input
              id="invite-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="u/username"
              autoComplete="off"
              aria-invalid={!!errors.username}
              aria-describedby={errors.username ? "invite-username-error" : undefined}
            />
            {errors.username && <p id="invite-username-error" className="field-error">{errors.username}</p>}
          </div>
          <div className="min-w-[16rem] flex-[2]">
            <label htmlFor="invite-message" className="mb-1 block text-sm font-semibold">{t("메시지")} <span className="font-normal text-muted">{t("(선택)")}</span></label>
            <input id="invite-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} className="input" />
            {errors.message && <p className="field-error">{errors.message}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          <span role="status" className="text-sm font-medium text-up">{sent ? t("u/{name} 님에게 초대를 보냈어요", { name: sent }) : ""}</span>
          <button type="submit" className="btn-primary" disabled={busy || !username.trim()}>{t("초대 보내기")}</button>
        </div>
        {formError && <p role="alert" className="text-sm font-medium text-down">{formError}</p>}
        <p className="text-xs text-muted">{t("초대는 7일 동안 유효해요. 받은 사람이 수락하면 바로 회원이 돼요.")}</p>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-down">{errorMessage(error)}</p>
      ) : data && data.items.length > 0 ? (
        <ul className="card mt-3 divide-y divide-line">
          {data.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 p-3">
              <UserAvatar name={i.user} src={i.avatar} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-semibold">u/{i.user}</span>
                  <span className="ml-1.5 text-xs text-muted">{t("{time}까지", { time: fullDate(i.expiresAt) })}{i.invitedBy ? ` · ${t("u/{name} 님이 보냄", { name: i.invitedBy })}` : ""}</span>
                </p>
                {i.message && <p className="truncate text-xs text-muted">“{i.message}”</p>}
              </div>
              <button type="button" className="btn-ghost py-1.5 text-sm" onClick={() => cancel(i)} aria-label={t("u/{name} 님 초대 취소", { name: i.user })}>
                {t("초대 취소")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Members({ community, state }: { community: Community; state: ReturnType<typeof useAsync<{ items: MemberItem[] }>> }) {
  const t = useT();
  const { data, error, reload } = state;
  const [confirm, setConfirm] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async (name: string) => {
    setActionError(null);
    try {
      await api.del(`/api/communities/${community.name}/members/${name}`);
      setConfirm(null);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading" className="mb-2 text-lg font-bold">
        {t("회원")} {data && <span className="text-sm font-normal text-muted">{data.items.length}</span>}
      </h2>
      {actionError && <p role="alert" className="mb-2 text-sm font-medium text-down">{actionError}</p>}
      {error ? (
        <p role="alert" className="card p-4 text-sm text-down">{errorMessage(error)}</p>
      ) : !data ? (
        <p className="card p-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {data.items.map((mem) => (
            <li key={mem.name} className="flex items-center gap-3 p-3">
              <UserAvatar name={mem.name} src={mem.avatar} size="sm" />
              <Link to={`/u/${mem.name}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">u/{mem.name}</Link>
              {mem.moderator ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-strong"><Shield className="h-3.5 w-3.5" /> {t("운영진")}</span>
              ) : confirm === mem.name ? (
                <span className="flex items-center gap-2 text-sm">
                  {t("내보낼까요?")}
                  <button type="button" className="btn-ghost py-1" onClick={() => setConfirm(null)}>{t("취소")}</button>
                  <button type="button" className="btn-danger py-1" onClick={() => remove(mem.name)}>{t("내보내기")}</button>
                </span>
              ) : (
                <button type="button" className="btn-ghost py-1 text-sm" onClick={() => setConfirm(mem.name)} aria-label={t("u/{name} 님 내보내기", { name: mem.name })}>
                  <UserMinus className="h-4 w-4" /> {t("내보내기")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {community.access === "private" && <p className="mt-2 text-xs text-muted">{t("내보낸 사람은 다시 가입 요청을 보내거나 초대를 받아야 들어올 수 있어요.")}</p>}
    </section>
  );
}
