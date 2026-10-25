import { Link } from "react-router-dom";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { compactNumber, postPath, timeAgo } from "@/lib/format";
import { clearRecent, useRecentIds } from "@/lib/recent";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Post } from "@/lib/types";
import { CommunityAvatar } from "./CommunityAvatar";
import { displayPost } from "./PostCard";

const SHOWN = 5;

/**
 * 최근 본 글 (홈 오른쪽). 로그인하지 않아도 이 브라우저에서 본 글이 남는다.
 * 본 글이 없거나 모두 지워진 글이면 칸 자체를 그리지 않는다.
 */
export function RecentPosts() {
  const t = useT();
  const { user } = useSession();
  const owner = user?.name ?? null;
  const ids = useRecentIds(owner).slice(0, SHOWN);
  const key = ids.join(",");
  const { data } = useAsync(
    () => (key ? api.get<{ items: Post[] }>(`/api/posts/batch?ids=${key}`).then((r) => r.items) : Promise.resolve([])),
    [key, owner],
  );

  if (!key || !data || data.length === 0) return null;

  return (
    <section className="card p-4" aria-labelledby="recent-posts-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="recent-posts-heading" className="text-xs font-semibold uppercase tracking-wide text-muted">{t("최근 본 글")}</h2>
        <button type="button" onClick={() => clearRecent(owner)} className="text-sm font-semibold text-accent hover:underline">
          {t("지우기@@recent")}
        </button>
      </div>
      <ul className="divide-y divide-line">
        {data.map((p) => {
          const thumb = p.images[0];
          return (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0">
              <Link to={postPath(p)} className="group flex gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <CommunityAvatar name={p.community} title={p.communityTitle} icon={p.communityIcon} size="xs" />
                    <span className="truncate font-semibold text-ink">c/{p.community}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0">{timeAgo(p.createdAt)}</span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{displayPost(p).title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {t("추천 {n}", { n: compactNumber(p.score) })} · {t("댓글 {n}개", { n: compactNumber(p.commentCount) })}
                  </p>
                </div>
                {thumb && <img src={thumb.src} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" decoding="async" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
