import { Link } from "react-router-dom";
import { CalendarDays, Lock, PenSquare, Shield, Users } from "lucide-react";
import { useT } from "@/i18n";
import { compactNumber, shortDate } from "@/lib/format";
import type { Community } from "@/lib/types";
import { CommunityAvatar, CommunityBanner } from "./CommunityAvatar";
import { JoinButton } from "./JoinButton";

/** 커뮤니티 화면과 글 화면 오른쪽에 붙는 소개 카드 */
export function CommunitySidebar({ community, onChange }: { community: Community; onChange?: (c: Community) => void }) {
  const t = useT();
  const canPost = community.canView && (!community.restricted || community.isModerator) && !community.myBan;
  return (
    <>
      <section className="card overflow-hidden">
        <CommunityBanner banner={community.banner} color={community.color} className="h-16" />
        <div className="space-y-3 p-4 pt-0">
          <div className="-mt-6 flex items-end gap-3">
            <CommunityAvatar name={community.name} title={community.title} icon={community.icon} color={community.color} size="lg" />
            <div className="pb-1">
              <Link to={`/c/${community.name}`} className="font-bold hover:underline">{community.title}</Link>
              <p className="text-xs text-muted">c/{community.name}</p>
            </div>
          </div>
          <p className="text-sm">{community.description}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="flex items-center gap-1 text-xs text-muted"><Users className="h-3.5 w-3.5" /> {t("회원")}</dt>
              <dd className="font-semibold">{compactNumber(community.members)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-xs text-muted"><CalendarDays className="h-3.5 w-3.5" /> {t("개설일")}</dt>
              <dd className="font-semibold">{shortDate(community.createdAt)}</dd>
            </div>
          </dl>
          {community.restricted && (
            <p className="flex items-center gap-1.5 rounded-lg bg-bg px-3 py-2 text-xs text-muted">
              <Lock className="h-3.5 w-3.5" /> {t("운영진만 글을 쓸 수 있어요.")}
            </p>
          )}
          <div className="flex gap-2">
            <JoinButton community={community} onChange={onChange} className="flex-1" />
            {canPost && (
              <Link to={`/c/${community.name}/submit`} className="btn-outline flex-1">
                <PenSquare className="h-4 w-4" /> {t("글쓰기")}
              </Link>
            )}
          </div>
        </div>
      </section>

      {community.flairs.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("말머리")}</h2>
          <div className="flex flex-wrap gap-1.5">
            {community.flairs.map((f) => (
              <Link key={f} to={`/c/${community.name}?flair=${encodeURIComponent(f)}`} className="chip hover:bg-accent/15">{community.flairLabels[f] ?? f}</Link>
            ))}
          </div>
        </section>
      )}

      {community.rules.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("규칙")}</h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {community.rules.map((r) => <li key={r}>{r}</li>)}
          </ol>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted">
          <Shield className="h-3.5 w-3.5" /> {t("운영진")}
        </h2>
        <ul className="space-y-1 text-sm">
          {community.moderators.map((m) => (
            <li key={m}><Link to={`/u/${m}`} className="text-accent hover:underline">u/{m}</Link></li>
          ))}
        </ul>
      </section>
    </>
  );
}
