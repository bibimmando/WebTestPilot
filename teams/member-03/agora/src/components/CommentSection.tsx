import { useCallback, useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Flag, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useT } from "@/i18n";
import { useAuthModal } from "@/lib/authModal";
import { useCommunities } from "@/lib/communities";
import { timeAgo, fullDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Comment, Post, Vote } from "@/lib/types";
import { ReportDialog } from "./ReportDialog";
import { TranslatedNote } from "./TranslatedNote";
import { UserAvatar } from "./UserAvatar";
import { VoteButtons } from "./VoteButtons";

type CommentSort = "best" | "top" | "new" | "old";

const SORT_LABELS: Record<CommentSort, string> = {
  best: "베스트",
  top: "점수순",
  new: "최신순",
  old: "오래된순",
};

function fieldError(err: unknown, field: string): string {
  if (err instanceof ApiError) return err.fields[field] ?? err.message;
  return errorMessage(err);
}

function countAll(list: Comment[]): number {
  return list.reduce((n, c) => n + 1 + countAll(c.children), 0);
}

/** 글 화면 아래의 댓글 영역: 입력란 + 정렬 + 댓글 트리 */
export function CommentSection({ post, onChanged }: { post: Post; onChanged: () => void }) {
  const t = useT();
  const { user } = useSession();
  const { open: openAuth } = useAuthModal();
  const { list } = useCommunities();
  const rules = list.find((c) => c.name === post.community)?.rules ?? [];
  const [sort, setSort] = useState<CommentSort>("best");
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ items: Comment[] }>(`/api/posts/${post.id}/comments?sort=${sort}`),
    [post.id, sort, user?.name],
  );
  const locked = post.deleted || post.removed;
  const changed = () => {
    reload();
    onChanged();
  };

  return (
    <section id="comments" aria-label={t("댓글")} className="card mt-3 scroll-mt-20 p-4">
      {locked ? (
        <p className="rounded-lg bg-bg px-4 py-3 text-sm text-muted">{t("삭제된 글에는 댓글을 달 수 없어요.")}</p>
      ) : user ? (
        <CommentForm postId={post.id} onDone={changed} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg px-4 py-3 text-sm">
          <span>{t("댓글을 쓰려면 로그인하세요.")}</span>
          <button type="button" className="btn-primary py-1.5" onClick={() => openAuth("login")}>{t("로그인")}</button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-b border-line pb-2">
        <h2 className="text-sm font-semibold">{t("댓글 {n}개", { n: post.commentCount })}</h2>
        <label className="flex items-center gap-2 text-sm text-muted">
          {t("정렬")}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as CommentSort)}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
          >
            {(Object.keys(SORT_LABELS) as CommentSort[]).map((s) => (
              <option key={s} value={s}>{t(SORT_LABELS[s])}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p role="alert" className="py-6 text-sm text-down">{t("댓글을 불러오지 못했어요.")} {errorMessage(error)}</p>
      ) : loading && !data ? (
        <p className="py-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : data && data.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{t("아직 댓글이 없어요. 첫 댓글을 남겨 보세요.")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {data?.items.map((c) => (
            <CommentItem key={c.id} comment={c} postId={post.id} rules={rules} locked={locked} onChanged={changed} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CommentForm({
  postId,
  parentId,
  onDone,
  onCancel,
}: {
  postId: string;
  parentId?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/posts/${postId}/comments`, { body: text, parentId: parentId ?? null });
      setText("");
      onDone();
    } catch (err) {
      setError(fieldError(err, "body"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={id} className="sr-only">{t(parentId ? "답글 내용" : "댓글 내용")}</label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={parentId ? 3 : 4}
        autoFocus={!!parentId}
        placeholder={t(parentId ? "답글을 남겨 주세요" : "댓글을 남겨 주세요")}
        className="input resize-y"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} role="alert" className="field-error">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{t("취소")}</button>}
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {t(parentId ? "답글 달기" : "댓글 달기")}
        </button>
      </div>
    </form>
  );
}

function EditForm({ comment, onDone, onCancel }: { comment: Comment; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/comments/${comment.id}`, { body: text });
      onDone();
    } catch (err) {
      setError(fieldError(err, "body"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-1 space-y-2">
      <label htmlFor={id} className="sr-only">{t("댓글 수정")}</label>
      <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={3} className="input resize-y" autoFocus />
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>{t("취소")}</button>
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{t("저장")}</button>
      </div>
    </form>
  );
}

function CommentItem({
  comment,
  postId,
  rules,
  locked,
  onChanged,
}: {
  comment: Comment;
  postId: string;
  rules: string[];
  locked: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const { user } = useSession();
  const { open: openAuth } = useAuthModal();
  const [collapsed, setCollapsed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [original, setOriginal] = useState(false);
  const closeReport = useCallback(() => setReporting(false), []);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vote = async (dir: Vote) => {
    const r = await api.post<{ comment: Comment }>(`/api/comments/${comment.id}/vote`, { dir });
    return { score: r.comment.score, myVote: r.comment.myVote };
  };

  const remove = async () => {
    try {
      await api.del(`/api/comments/${comment.id}`);
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const startReply = () => {
    if (!user) {
      openAuth("login");
      return;
    }
    setReplying(true);
  };

  const hidden = countAll(comment.children);
  const gone = comment.deleted || comment.removed;

  return (
    <li id={`comment-${comment.id}`}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={t(collapsed ? "댓글 펼치기" : "댓글 접기")}
          aria-expanded={!collapsed}
          className="group flex w-7 shrink-0 flex-col items-center"
        >
          {comment.author ? (
            <UserAvatar name={comment.author} src={comment.authorAvatar} size="sm" />
          ) : (
            <span className="h-7 w-7 rounded-full bg-line" />
          )}
          {!collapsed && <span className="mt-1 w-0.5 flex-1 rounded bg-line group-hover:bg-accent" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            {comment.author ? (
              <Link to={`/u/${comment.author}`} className="font-semibold text-ink hover:underline">{comment.author}</Link>
            ) : (
              <span>{t("[삭제됨]")}</span>
            )}
            {comment.isPostAuthor && !gone && <span className="chip px-1.5 py-0 text-[10px]">{t("글쓴이")}</span>}
            <span aria-hidden="true">·</span>
            <time dateTime={comment.createdAt} title={fullDate(comment.createdAt)}>{timeAgo(comment.createdAt)}</time>
            {comment.editedAt && <span>{t("(수정됨)")}</span>}
            {collapsed && hidden > 0 && <span className="text-accent">· {t("답글 {n}개 접힘", { n: hidden })}</span>}
          </div>

          {!collapsed && (
            <>
              {gone ? (
                <p className="mt-1 text-sm italic text-muted">{t(comment.removed ? "[운영진이 삭제한 댓글입니다]" : "[삭제된 댓글입니다]")}</p>
              ) : editing ? (
                <EditForm
                  comment={comment}
                  onCancel={() => setEditing(false)}
                  onDone={() => {
                    setEditing(false);
                    onChanged();
                  }}
                />
              ) : (
                <>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{comment.translated && !original ? comment.translated : comment.body}</p>
                  {comment.translated && <TranslatedNote original={original} onToggle={() => setOriginal((v) => !v)} />}
                </>
              )}

              {!editing && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-muted">
                  <VoteButtons layout="horizontal" score={comment.score} myVote={comment.myVote} onVote={vote} disabled={gone} />
                  {!locked && !gone && (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={startReply}>
                      <MessageCircle className="h-3.5 w-3.5" /> {t("답글")}
                    </button>
                  )}
                  {comment.canEdit && (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)}>
                      <Pencil className="h-3.5 w-3.5" /> {t("수정")}
                    </button>
                  )}
                  {comment.canReport && (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setReporting(true)}>
                      <Flag className="h-3.5 w-3.5" /> {t("신고")}
                    </button>
                  )}
                  {comment.canDelete &&
                    (confirming ? (
                      <span className="flex items-center gap-1 text-xs">
                        {t("정말 삭제할까요?")}
                        <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={remove}>{t("삭제")}</button>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(false)}>{t("취소")}</button>
                      </span>
                    ) : (
                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(true)}>
                        <Trash2 className="h-3.5 w-3.5" /> {t("삭제")}
                      </button>
                    ))}
                </div>
              )}
              {error && <p role="alert" className="field-error">{error}</p>}
              <ReportDialog open={reporting} onClose={closeReport} target={{ type: "comment", id: comment.id }} rules={rules} />

              {replying && (
                <div className="mt-2">
                  <CommentForm
                    postId={postId}
                    parentId={comment.id}
                    onCancel={() => setReplying(false)}
                    onDone={() => {
                      setReplying(false);
                      onChanged();
                    }}
                  />
                </div>
              )}

              {comment.children.length > 0 && (
                <ul className={clsx("mt-3 space-y-3")}>
                  {comment.children.map((child) => (
                    <CommentItem key={child.id} comment={child} postId={postId} rules={rules} locked={locked} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
