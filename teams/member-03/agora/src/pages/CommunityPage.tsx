import { useT } from "@/i18n";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Ban, Lock, MailPlus, PenSquare, Shield } from "lucide-react";
import { clsx } from "clsx";
import { Feed } from "@/components/Feed";
import { TwoColumn } from "@/components/Layout";
import { SortBar } from "@/components/SortBar";
import { AccessBadges, CommunityAvatar, CommunityBanner } from "@/components/CommunityAvatar";
import { CommunitySidebar } from "@/components/CommunitySidebar";
import { JoinButton } from "@/components/JoinButton";
import { ApiError, api, errorMessage } from "@/lib/api";
import { compactNumber, fullDate, shortDate } from "@/lib/format";
import { useCommunities } from "@/lib/communities";
import { useViewMode } from "@/lib/viewMode";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Community } from "@/lib/types";
import { NotFoundCard } from "./NotFoundPage";

export function CommunityPage() {
  const t = useT();
  const { name = "" } = useParams();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const flair = params.get("flair");
  const [view, setView] = useViewMode();

  const { data: community, error, setData } = useAsync(
    () => api.get<{ community: Community }>(`/api/communities/${name}`).then((r) => r.community),
    [name, user?.name],
  );

  if (error instanceof ApiError && error.status === 404) {
    return <NotFoundCard title={t("c/{name} 커뮤니티를 찾을 수 없어요", { name })} detail={t("이름을 다시 확인해 주세요.")} />;
  }
  if (!community) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;

  const canPost = community.canView && (!community.restricted || community.isModerator) && !community.myBan;
  const setFlair = (value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set("flair", value);
    else next.delete("flair");
    setParams(next);
  };

  return (
    <TwoColumn aside={<CommunitySidebar community={community} onChange={(c) => setData(() => c)} />}>
      {community.membership?.invite && <InviteBanner community={community} onChange={(c) => setData(() => c)} />}
      <section className="card mb-3 overflow-hidden">
        <CommunityBanner banner={community.banner} color={community.color} className="h-28 sm:h-36" />
        <div className="flex flex-wrap items-end gap-4 px-4 pb-4">
          <div className="-mt-10">
            <CommunityAvatar name={community.name} title={community.title} icon={community.icon} color={community.color} size="xl" />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="text-2xl font-bold">{community.title}</h1>
            <AccessBadges community={community} className="mt-1" />
            <p className="text-sm text-muted">c/{community.name} · {t("회원 {n}", { n: compactNumber(community.members) })}</p>
          </div>
          <div className="flex flex-wrap gap-2 pb-1">
            {community.isModerator && (
              <Link to={`/c/${community.name}/mod`} className="btn-outline">
                <Shield className="h-4 w-4" /> {t("운영 도구")}
                {!!community.openReports && (
                  <span className="rounded-full bg-down px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={t("처리할 신고 {n}건", { n: community.openReports })}>
                    {community.openReports}
                  </span>
                )}
              </Link>
            )}
            {canPost && (
              <Link to={`/c/${community.name}/submit`} className="btn-outline">
                <PenSquare className="h-4 w-4" /> {t("글쓰기")}
              </Link>
            )}
            <JoinButton community={community} onChange={(c) => setData(() => c)} />
          </div>
        </div>
      </section>

      {community.myBan && (
        <div role="status" className="card mb-3 flex gap-3 border-down/30 bg-down/5 p-4 text-sm">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-down" />
          <div>
            <p className="font-semibold text-down">
              {t("이 커뮤니티에서 활동이 정지됐어요")} ({community.myBan.until ? t("{date}까지", { date: shortDate(community.myBan.until) }) : t("영구")})
            </p>
            <p className="mt-0.5 text-muted">{t("글과 댓글을 쓸 수 없어요. 이유: {reason}", { reason: community.myBan.reason })}</p>
          </div>
        </div>
      )}

      {community.flairs.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("말머리로 거르기")}>
          <button
            type="button"
            aria-pressed={!flair}
            onClick={() => setFlair(null)}
            className={clsx("btn px-3 py-1 text-xs", !flair ? "bg-ink text-surface" : "border border-line bg-surface text-muted hover:text-ink")}
          >
            {t("전체")}
          </button>
          {community.flairs.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={flair === f}
              onClick={() => setFlair(flair === f ? null : f)}
              className={clsx("btn px-3 py-1 text-xs", flair === f ? "bg-ink text-surface" : "border border-line bg-surface text-muted hover:text-ink")}
            >
              {community.flairLabels[f] ?? f}
            </button>
          ))}
        </div>
      )}

      {community.canView ? (
        <>
          <SortBar view={view} onViewChange={setView} />
          <Feed
            community={community.name}
            view={view}
            emptyAction={canPost ? { to: `/c/${community.name}/submit`, label: "첫 글 쓰기" } : undefined}
          />
        </>
      ) : (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Lock className="h-8 w-8 text-muted" aria-hidden="true" />
          <p className="font-semibold">{t("비공개 커뮤니티예요")}</p>
          <PrivateStatus community={community} />
          <JoinButton community={community} onChange={(c) => setData(() => c)} className="mt-2" />
        </div>
      )}
    </TwoColumn>
  );
}

/** 비공개 커뮤니티의 비회원에게 지금 상태를 알려 준다. */
function PrivateStatus({ community }: { community: Community }) {
  const t = useT();
  const { user } = useSession();
  const m = community.membership;
  let text = t("회원만 글을 볼 수 있어요. 가입 요청을 보내거나 운영진의 초대를 받으면 들어갈 수 있어요.");
  if (!user) text = t("회원만 글을 볼 수 있어요. 로그인한 뒤 가입 요청을 보낼 수 있어요.");
  else if (m?.banned) text = t("이 커뮤니티에서 활동이 정지돼 가입 요청을 보낼 수 없어요.");
  else if (m?.invite) text = t("초대를 받았어요. 수락하면 바로 회원이 돼요.");
  else if (m?.request) text = t("가입 요청을 보냈어요. 운영진이 승인하면 글을 볼 수 있어요.");
  else if (m?.retryAt) {
    text = m.denyReason
      ? t("가입 요청이 거절됐어요. 이유: {reason}. {time}부터 다시 요청할 수 있어요.", { reason: m.denyReason, time: fullDate(m.retryAt) })
      : t("가입 요청이 거절됐어요. {time}부터 다시 요청할 수 있어요.", { time: fullDate(m.retryAt) });
  }
  return <p role="status" className="max-w-md text-sm text-muted">{text}</p>;
}

/** 받은 초대. 수락하면 바로 회원이 되고, 거절하면 초대가 사라진다. */
function InviteBanner({ community, onChange }: { community: Community; onChange: (c: Community) => void }) {
  const t = useT();
  const { refresh } = useSession();
  const { replace } = useCommunities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = community.membership!.invite!;

  const answer = async (action: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ community: Community }>(`/api/invites/${invite.id}/${action}`);
      replace(r.community);
      onChange(r.community);
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="invite-heading" className="card mb-3 flex flex-wrap items-center gap-3 border-accent/40 bg-accent-soft/60 p-4">
      <MailPlus className="h-6 w-6 shrink-0 text-accent-strong" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="invite-heading" className="font-semibold">
          {invite.invitedBy ? t("u/{name} 님이 c/{c} 에 초대했어요", { name: invite.invitedBy, c: community.name }) : t("c/{c} 에 초대받았어요", { c: community.name })}
        </h2>
        {invite.message && <p className="mt-0.5 text-sm">“{invite.message}”</p>}
        <p className="mt-0.5 text-xs text-muted">{t("{time}까지 수락할 수 있어요", { time: fullDate(invite.expiresAt) })}</p>
        {error && <p role="alert" className="mt-1 text-sm font-medium text-down">{error}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-outline" disabled={busy} onClick={() => answer("decline")}>{t("거절")}</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => answer("accept")}>{t("수락")}</button>
      </div>
    </section>
  );
}
