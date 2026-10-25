import { useT } from "@/i18n";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Mail, Settings, Shield } from "lucide-react";
import { clsx } from "clsx";
import { PostCard } from "@/components/PostCard";
import { UserAvatar } from "@/components/UserAvatar";
import { ApiError, api, errorMessage } from "@/lib/api";
import { compactNumber, postPath, shortDate, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Post, UserProfile } from "@/lib/types";
import { NotFoundCard } from "./NotFoundPage";

type Tab = "posts" | "comments" | "saved" | "hidden";

export function UserPage() {
  const t = useT();
  const { name = "" } = useParams();
  const { user: viewer } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error } = useAsync(() => api.get<UserProfile>(`/api/users/${name}`), [name, viewer?.name]);

  if (error instanceof ApiError && error.status === 404) return <NotFoundCard title={t("u/{name} 사용자를 찾을 수 없어요", { name })} />;
  if (!data) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;

  const { user, posts, comments } = data;
  const raw = params.get("tab");
  // 저장·숨김 탭은 본인에게만 있다.
  const tab: Tab = raw === "comments" ? "comments" : (raw === "saved" || raw === "hidden") && user.isMe ? raw : "posts";
  const tabs: [Tab, string][] = [
    ["posts", t("글 {n}", { n: posts.length })],
    ["comments", t("댓글 {n}", { n: comments.length })],
  ];
  if (user.isMe) tabs.push(["saved", t("저장됨")], ["hidden", t("숨김")]);

  return (
    <div>
      <section className="card mb-3 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar name={user.name} src={user.avatar} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">u/{user.name}</h1>
            <p className="text-sm text-muted">{t("{date} 가입", { date: shortDate(user.createdAt) })}</p>
            {user.moderates.length > 0 && (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                <Shield className="h-3.5 w-3.5" /> {t("운영 중:")}
                {user.moderates.map((c) => (
                  <Link key={c} to={`/c/${c}`} className="font-semibold text-accent hover:underline">c/{c}</Link>
                ))}
              </p>
            )}
          </div>
          <dl className="flex gap-6 text-center">
            <div>
              <dt className="text-xs text-muted">{t("글 카르마")}</dt>
              <dd className="text-lg font-bold">{compactNumber(user.karma.post)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t("댓글 카르마")}</dt>
              <dd className="text-lg font-bold">{compactNumber(user.karma.comment)}</dd>
            </div>
          </dl>
        </div>
        {user.bio && <p className="mt-4 whitespace-pre-wrap text-sm">{user.bio}</p>}
        <div className="mt-4 flex gap-2">
          {user.isMe ? (
            <Link to="/settings" className="btn-outline py-1.5"><Settings className="h-4 w-4" /> {t("프로필 편집")}</Link>
          ) : user.canMessage ? (
            <Link to={`/messages/new?to=${user.name}`} className="btn-outline py-1.5"><Mail className="h-4 w-4" /> {t("쪽지 보내기")}</Link>
          ) : null}
        </div>
      </section>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setParams(value === "posts" ? {} : { tab: value })}
            className={clsx(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold",
              tab === value ? "border-accent text-accent-strong" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "posts" &&
        (posts.length === 0 ? (
          <p className="card p-8 text-center text-sm text-muted">{t("아직 쓴 글이 없어요.")}</p>
        ) : (
          <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
        ))}

      {tab === "comments" &&
        (comments.length === 0 ? (
          <p className="card p-8 text-center text-sm text-muted">{t("아직 쓴 댓글이 없어요.")}</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((c) => (
              <li key={c.id} className="card p-4">
                <p className="text-xs text-muted">
                  <Link to={`/c/${c.community}`} className="font-semibold text-ink hover:underline">c/{c.community}</Link>
                  {" · "}
                  <Link to={`${postPath({ community: c.community, id: c.postId, title: c.postTitle })}#comment-${c.id}`} className="hover:underline">
                    {c.postTitle}
                  </Link>
                  {" · "}
                  {timeAgo(c.createdAt)} · {t("점수 {n}", { n: c.score })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.translated ?? c.body}</p>
              </li>
            ))}
          </ul>
        ))}

      {(tab === "saved" || tab === "hidden") && <MyList kind={tab} />}
    </div>
  );
}

/** 저장한 글 · 숨긴 글 (본인만) */
function MyList({ kind }: { kind: "saved" | "hidden" }) {
  const t = useT();
  const { data, error } = useAsync(() => api.get<{ items: Post[] }>(`/api/me/${kind}`), [kind]);
  if (error) return <p role="alert" className="card p-6 text-sm text-down">{errorMessage(error)}</p>;
  if (!data) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;
  if (data.items.length === 0) {
    return (
      <p className="card p-8 text-center text-sm text-muted">
        {t(kind === "saved" ? "저장한 글이 없어요. 글의 ⋯ 메뉴에서 저장할 수 있어요." : "숨긴 글이 없어요.")}
      </p>
    );
  }
  return <div className="space-y-3">{data.items.map((p) => <PostCard key={p.id} post={p} collapseHidden={false} />)}</div>;
}
