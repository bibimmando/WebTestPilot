import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, EyeOff, ExternalLink, FileText, Link2, MessageSquare, Pin, Play, Share2 } from "lucide-react";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { compactNumber, hostOf, postPath, timeAgo } from "@/lib/format";
import { plainText } from "@/lib/markdown";
import type { Post, Vote } from "@/lib/types";
import type { ViewMode } from "@/lib/viewMode";
import { CommunityAvatar } from "./CommunityAvatar";
import { CardMedia, SpoilerGate, Thumbnail, VideoPlayer, durationText } from "./PostMedia";
import { PostMenu, setHidden } from "./PostMenu";
import { UserAvatar } from "./UserAvatar";
import { VoteButtons } from "./VoteButtons";

/** 스포일러 표시 */
export function SpoilerChip() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-surface">
      <EyeOff className="h-3 w-3" aria-hidden="true" /> {t("스포일러")}
    </span>
  );
}

/** 말머리. flair 는 원문(주소에 쓰는 값), label 은 화면 이름(번역) */
export function FlairChip({ flair, label, community }: { flair: string; label?: string | null; community?: string }) {
  if (!community) return <span className="chip">{label ?? flair}</span>;
  return (
    <Link to={`/c/${community}?flair=${encodeURIComponent(flair)}`} className="chip hover:bg-accent/15">
      {label ?? flair}
    </Link>
  );
}

export async function votePost(id: string, dir: Vote) {
  const r = await api.post<{ post: Post }>(`/api/posts/${id}/vote`, { dir });
  return { score: r.post.score, myVote: r.post.myVote };
}

export function ShareButton({ path }: { path: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost py-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.origin + path);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {t(copied ? "링크 복사됨" : "공유")}
    </button>
  );
}

/** 글 위쪽 한 줄: 커뮤니티(또는 작성자) · 시각 · 고정 */
function PostMeta({ post, showCommunity }: { post: Post; showCommunity: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
      {showCommunity ? (
        <>
          <CommunityAvatar name={post.community} title={post.communityTitle} icon={post.communityIcon} size="xs" />
          <Link to={`/c/${post.community}`} className="font-semibold text-ink hover:underline">c/{post.community}</Link>
        </>
      ) : post.author ? (
        <UserAvatar name={post.author} src={post.authorAvatar} size="xs" />
      ) : null}
      {showCommunity && <span aria-hidden="true">·</span>}
      <span>
        {post.author ? <Link to={`/u/${post.author}`} className="hover:underline">u/{post.author}</Link> : t("[삭제됨]")}
      </span>
      <span aria-hidden="true">·</span>
      <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
      {post.pinned && (
        <span className="ml-1 inline-flex items-center gap-0.5 font-semibold text-up">
          <Pin className="h-3 w-3" /> {t("고정됨")}
        </span>
      )}
    </div>
  );
}

/** 목록에 보이는 글 한 건. 숨기면 그 자리에 "되돌리기" 줄이 남는다. */
export function PostCard({
  post: initial,
  showCommunity = true,
  view = "card",
  collapseHidden = true,
}: {
  post: Post;
  showCommunity?: boolean;
  view?: ViewMode;
  /** false 면 숨긴 글도 그대로 보여 준다 (숨김 목록) */
  collapseHidden?: boolean;
}) {
  const t = useT();
  const [post, setPost] = useState(initial);
  useEffect(() => {
    setPost(initial);
  }, [initial]);
  const path = postPath(post);
  const shown = displayPost(post);

  if (post.hidden && collapseHidden) {
    return (
      <div className="card flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
        <span>{t("글을 숨겼어요. 숨긴 글은 내 프로필의 '숨김' 탭에서 볼 수 있어요.")}</span>
        <button type="button" className="btn-outline py-1" onClick={async () => setPost(await setHidden(post, false))}>
          {t("되돌리기")}
        </button>
      </div>
    );
  }

  if (view === "compact") {
    const thumb = post.images[0];
    return (
      <article className="card flex items-center gap-3 px-3 py-2 transition-colors hover:border-muted/40">
        {/* 점수 자릿수가 달라도 썸네일 줄이 맞도록 폭을 고정한다. */}
        <div className="flex w-11 shrink-0 justify-center">
          <VoteButtons score={post.score} myVote={post.myVote} onVote={(dir) => votePost(post.id, dir)} />
        </div>
        <Link to={path} tabIndex={-1} aria-hidden="true" className="relative shrink-0 overflow-hidden rounded-lg">
          {post.spoiler && (thumb || post.video) ? (
            <span className="flex h-14 w-20 items-center justify-center rounded-lg bg-ink text-surface">
              <EyeOff className="h-5 w-5" />
            </span>
          ) : post.video ? (
            <span className="flex h-14 w-20 items-center justify-center rounded-lg bg-black text-white">
              <Play className="h-5 w-5" />
              <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-semibold">{durationText(post.video.duration)}</span>
            </span>
          ) : thumb ? (
            <Thumbnail img={thumb} className="h-14 w-20" />
          ) : (
            <span className="flex h-14 w-20 items-center justify-center rounded-lg bg-bg text-muted">
              {post.url ? <Link2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold">
            {post.spoiler && <span className="mr-1.5 align-middle"><SpoilerChip /></span>}
            {post.flair && <span className="mr-1.5 align-middle"><FlairChip flair={post.flair} label={post.flairLabel} community={post.community} /></span>}
            <Link to={path} className="hover:underline">{shown.title}</Link>
            {post.images.length > 1 && <span className="ml-1.5 text-xs font-normal text-muted">{t("사진 {n}장", { n: post.images.length })}</span>}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3">
            <PostMeta post={post} showCommunity={showCommunity} />
            <Link to={`${path}#comments`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
              <MessageSquare className="h-3.5 w-3.5" /> {t("댓글 {n}개", { n: compactNumber(post.commentCount) })}
            </Link>
          </div>
        </div>
        <PostMenu post={post} onChange={setPost} />
      </article>
    );
  }

  return (
    <article className="card flex transition-colors hover:border-muted/40">
      <div className="flex w-12 shrink-0 justify-center rounded-l-xl bg-bg/60 py-3">
        <VoteButtons score={post.score} myVote={post.myVote} onVote={(dir) => votePost(post.id, dir)} />
      </div>

      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <PostMeta post={post} showCommunity={showCommunity} />
          <PostMenu post={post} onChange={setPost} className="-mr-1 -mt-1" />
        </div>

        <h3 className="mt-1 text-[17px] font-semibold leading-snug">
          {post.spoiler && <span className="mr-1.5 align-middle"><SpoilerChip /></span>}
          {post.flair && <span className="mr-1.5 align-middle"><FlairChip flair={post.flair} label={post.flairLabel} community={post.community} /></span>}
          <Link to={path} className="hover:underline">{shown.title}</Link>
        </h3>

        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            {hostOf(post.url)} <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {(() => {
          const media = post.video ? (
            <VideoPlayer video={post.video} label={shown.title} className="mt-2 max-h-[30rem]" />
          ) : post.images.length > 0 ? (
            <CardMedia images={shown.images} to={path} />
          ) : post.body ? (
            <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm text-muted">{plainText(shown.body, t("스포일러"))}</p>
          ) : null;
          if (!media) return null;
          return post.spoiler ? <SpoilerGate key={post.id} preview={post.images[0]?.src}>{media}</SpoilerGate> : media;
        })()}

        <div className="mt-2 flex items-center gap-1 text-muted">
          <Link to={`${path}#comments`} className="btn-ghost py-1.5">
            <MessageSquare className="h-4 w-4" /> {t("댓글 {n}개", { n: compactNumber(post.commentCount) })}
          </Link>
          <ShareButton path={path} />
        </div>
      </div>
    </article>
  );
}

/** 보여 줄 제목 · 본문 · 이미지. 번역이 있고 원문 보기를 고르지 않았으면 번역 쪽 */
export function displayPost(post: Post, original = false) {
  const tr = !original ? post.translated : null;
  return {
    title: tr?.title ?? post.title,
    body: tr?.body ?? post.body,
    images: tr ? post.images.map((img, i) => ({ ...img, ...tr.images[i] })) : post.images,
  };
}
