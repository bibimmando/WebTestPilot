import { useCallback, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, EyeOff, Eye, Flag, MoreHorizontal } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useAuthModal } from "@/lib/authModal";
import { useCommunities } from "@/lib/communities";
import { useSession } from "@/lib/session";
import { useDismiss } from "@/lib/useDismiss";
import type { Post } from "@/lib/types";
import { ReportDialog } from "./ReportDialog";

export async function setSaved(post: Post, saved: boolean): Promise<Post> {
  return (await api.post<{ post: Post }>(`/api/posts/${post.id}/save`, { saved })).post;
}

export async function setHidden(post: Post, hidden: boolean): Promise<Post> {
  return (await api.post<{ post: Post }>(`/api/posts/${post.id}/hide`, { hidden })).post;
}

/** 글 오른쪽 위 "더 보기(⋯)" 메뉴: 저장 · 숨기기 · 신고 */
export function PostMenu({ post, onChange, className }: { post: Post; onChange: (post: Post) => void; className?: string }) {
  const t = useT();
  const { user } = useSession();
  const { open: openAuth } = useAuthModal();
  const { list } = useCommunities();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const closeReport = useCallback(() => setReporting(false), []);
  useDismiss(ref, open, close);

  const rules = list.find((c) => c.name === post.community)?.rules ?? [];

  const run = async (action: () => Promise<Post>) => {
    setOpen(false);
    if (!user) {
      openAuth("login");
      return;
    }
    setError(null);
    try {
      onChange(await action());
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const itemClass = "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-bg";

  return (
    <div ref={ref} className={clsx("relative", className)}>
      <button
        type="button"
        className="btn-ghost h-8 w-8 p-0"
        aria-label={t("글 메뉴")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 z-20 mt-1 w-44 overflow-hidden py-1 shadow-lg">
          <button role="menuitem" type="button" className={itemClass} onClick={() => run(() => setSaved(post, !post.saved))}>
            {post.saved ? <BookmarkCheck className="h-4 w-4 text-accent" /> : <Bookmark className="h-4 w-4" />}
            {t(post.saved ? "저장 취소" : "저장")}
          </button>
          <button role="menuitem" type="button" className={itemClass} onClick={() => run(() => setHidden(post, !post.hidden))}>
            {post.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {t(post.hidden ? "숨기기 취소" : "숨기기")}
          </button>
          {(post.canReport || !user) && (
            <button
              role="menuitem"
              type="button"
              className={clsx(itemClass, "text-down")}
              onClick={() => {
                setOpen(false);
                if (!user) openAuth("login");
                else setReporting(true);
              }}
            >
              <Flag className="h-4 w-4" /> {t("신고")}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="field-error absolute right-0 top-full w-48 text-right">{error}</p>}
      <ReportDialog open={reporting} onClose={closeReport} target={{ type: "post", id: post.id }} rules={rules} />
    </div>
  );
}
