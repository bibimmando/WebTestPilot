import { useT } from "@/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { ExternalLink, MessageSquare, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { CommentSection } from "@/components/CommentSection";
import { CommunityAvatar } from "@/components/CommunityAvatar";
import { CommunitySidebar } from "@/components/CommunitySidebar";
import { TwoColumn } from "@/components/Layout";
import { FlairChip, ShareButton, SpoilerChip, displayPost, votePost } from "@/components/PostCard";
import { TranslatedNote } from "@/components/TranslatedNote";
import { Gallery, SpoilerGate, VideoPlayer } from "@/components/PostMedia";
import { PostMenu } from "@/components/PostMenu";
import { VoteButtons } from "@/components/VoteButtons";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fullDate, hostOf, postPath, timeAgo } from "@/lib/format";
import { Markdown } from "@/lib/markdown";
import { pushRecent } from "@/lib/recent";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Community, Post } from "@/lib/types";
import { NotFoundCard } from "./NotFoundPage";

export function PostPage() {
  const t = useT();
  const { name = "", id = "" } = useParams();
  const { user } = useSession();
  const location = useLocation();

  const post = useAsync(() => api.get<{ post: Post }>(`/api/posts/${id}`).then((r) => r.post), [id, user?.name]);
  const communityName = post.data?.community;
  const community = useAsync(
    () =>
      communityName
        ? api.get<{ community: Community }>(`/api/communities/${communityName}`).then((r) => r.community)
        : Promise.resolve(undefined),
    [communityName, user?.name],
  );

  // 연 글을 최근 본 글에 남긴다 (볼 수 없는 글은 불러오지 못하니 남지 않는다).
  useEffect(() => {
    if (post.data) pushRecent(user?.name, post.data.id);
  }, [post.data?.id, user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 목록에서 "댓글 N개" 를 눌러 #comments 로 들어오면 댓글 영역으로 내린다.
  useEffect(() => {
    if (post.data && location.hash === "#comments") {
      document.getElementById("comments")?.scrollIntoView();
    }
  }, [post.data?.id, location.hash]);

  if (post.error instanceof ApiError && post.error.status === 404) {
    return <NotFoundCard title={t("글을 찾을 수 없어요")} detail="주소가 잘못됐거나 없어진 글이에요." />;
  }
  if (!post.data) return <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>;

  // 주소의 커뮤니티 이름이 실제 글의 커뮤니티와 다르면 올바른 주소로 바꾼다.
  if (post.data.community !== name) return <Navigate replace to={postPath(post.data) + location.hash} />;

  return (
    <TwoColumn
      aside={community.data && <CommunitySidebar community={community.data} onChange={(c) => community.setData(() => c)} />}
    >
      <PostDetail post={post.data} setPost={(p) => post.setData(() => p)} />
      <CommentSection post={post.data} onChanged={post.reload} />
    </TwoColumn>
  );
}

function PostDetail({ post, setPost }: { post: Post; setPost: (p: Post) => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.body);
  const [original, setOriginal] = useState(false);
  const shown = displayPost(post, original);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = postPath(post);
  const gone = post.deleted || post.removed;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.patch<{ post: Post }>(`/api/posts/${post.id}`, { body: text });
      setPost(r.post);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.body ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      const r = await api.del<{ post: Post }>(`/api/posts/${post.id}`);
      setPost(r.post);
      setConfirming(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const togglePin = async () => {
    setError(null);
    try {
      const r = await api.post<{ post: Post }>(`/api/posts/${post.id}/pin`);
      setPost(r.post);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <article className="card flex">
      <div className="flex w-12 shrink-0 justify-center rounded-l-xl bg-bg/60 py-4">
        <VoteButtons score={post.score} myVote={post.myVote} onVote={(dir) => votePost(post.id, dir)} disabled={gone} />
      </div>

      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
            <CommunityAvatar name={post.community} title={post.communityTitle} icon={post.communityIcon} size="xs" />
            <Link to={`/c/${post.community}`} className="font-semibold text-ink hover:underline">c/{post.community}</Link>
            <span aria-hidden="true">·</span>
            {post.author ? <Link to={`/u/${post.author}`} className="hover:underline">u/{post.author}</Link> : <span>{t("[삭제됨]")}</span>}
            <span aria-hidden="true">·</span>
            <time dateTime={post.createdAt} title={fullDate(post.createdAt)}>{timeAgo(post.createdAt)}</time>
            {post.editedAt && <span>({t("수정됨 {when}", { when: timeAgo(post.editedAt) })})</span>}
            {post.pinned && (
              <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-up"><Pin className="h-3 w-3" /> {t("고정됨")}</span>
            )}
          </div>
          {!gone && <PostMenu post={post} onChange={setPost} className="-mr-1 -mt-1" />}
        </div>

        <h1 className="mt-2 text-2xl font-bold leading-snug">
          {post.spoiler && <span className="mr-2 align-middle"><SpoilerChip /></span>}
          {post.flair && <span className="mr-2 align-middle"><FlairChip flair={post.flair} label={post.flairLabel} community={post.community} /></span>}
          {shown.title}
        </h1>

        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            {hostOf(post.url)} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        {gone ? (
          <p className="mt-3 rounded-lg bg-bg px-4 py-3 text-sm italic text-muted">
            {t(post.removed ? "운영진이 삭제한 글이에요." : "작성자가 삭제한 글이에요.")}
          </p>
        ) : editing ? (
          <form onSubmit={save} className="mt-3 space-y-2">
            <label htmlFor="post-edit" className="sr-only">{t("본문 수정")}</label>
            <textarea id="post-edit" value={text} onChange={(e) => setText(e.target.value)} rows={8} className="input resize-y" />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => { setEditing(false); setText(post.body); }}>{t("취소")}</button>
              <button type="submit" className="btn-primary" disabled={busy}>{t("저장")}</button>
            </div>
          </form>
        ) : (
          <>
            {post.translated && <TranslatedNote original={original} onToggle={() => setOriginal((v) => !v)} className="mt-1" />}
            {(() => {
              const content = (
                <>
                  {post.video && <VideoPlayer video={post.video} label={shown.title} className="mt-3 max-h-[36rem]" />}
                  <Gallery key={post.id} images={shown.images} />
                  {shown.body && <Markdown text={shown.body} className="mt-3 text-[15px] leading-relaxed" />}
                </>
              );
              return post.spoiler ? <SpoilerGate key={post.id} preview={post.images[0]?.src} className="mt-3">{content}</SpoilerGate> : content;
            })()}
          </>
        )}

        {error && <p role="alert" className="field-error mt-2">{error}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1 text-muted">
          <a href="#comments" className="btn-ghost py-1.5"><MessageSquare className="h-4 w-4" /> {t("댓글 {n}개", { n: post.commentCount })}</a>
          <ShareButton path={path} />
          {post.canEdit && !editing && (
            <button type="button" className="btn-ghost py-1.5" onClick={() => { setText(post.body); setEditing(true); }}>
              <Pencil className="h-4 w-4" /> {t("수정")}
            </button>
          )}
          {post.canPin && (
            <button type="button" className="btn-ghost py-1.5" onClick={togglePin}>
              {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} {t(post.pinned ? "고정 해제" : "고정")}
            </button>
          )}
          {post.canDelete &&
            (confirming ? (
              <span className="flex items-center gap-1 text-sm">
                {t("정말 삭제할까요?")}
                <button type="button" className="btn-danger px-3 py-1" onClick={remove}>{t("삭제")}</button>
                <button type="button" className="btn-ghost px-3 py-1" onClick={() => setConfirming(false)}>{t("취소")}</button>
              </span>
            ) : (
              <button type="button" className="btn-ghost py-1.5" onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" /> {t("삭제")}
              </button>
            ))}
        </div>
      </div>
    </article>
  );
}
