import { useT } from "@/i18n";
import { Link } from "react-router-dom";
import { Ban, DoorOpen, MailPlus, MessageCircle, ShieldAlert, ShieldCheck, UserCheck, UserMinus, UserX } from "lucide-react";
import { clsx } from "clsx";
import { tr } from "@/i18n";
import { postPath, timeAgo } from "@/lib/format";
import type { AppNotification } from "@/lib/types";
import { UserAvatar } from "./UserAvatar";

export function notificationLink(n: AppNotification): string {
  if (n.post) return postPath(n.post) + (n.commentId ? `#comment-${n.commentId}` : "");
  // 가입 요청은 운영진이 처리할 곳으로
  if (n.type === "join_request") return `/c/${n.community}/mod/members`;
  return `/c/${n.community}`;
}

function headline(n: AppNotification): string {
  switch (n.type) {
    case "post_reply":
      return tr("{actor} 님이 내 글에 댓글을 남겼어요", { actor: n.actor ?? "" });
    case "comment_reply":
      return tr("{actor} 님이 내 댓글에 답글을 남겼어요", { actor: n.actor ?? "" });
    case "mod_removed":
      return tr(n.commentId ? "c/{c} 운영진이 내 댓글을 삭제했어요" : "c/{c} 운영진이 내 글을 삭제했어요", { c: n.community });
    case "banned":
      return tr("c/{c} 에서 활동이 정지됐어요", { c: n.community });
    case "unbanned":
      return tr("c/{c} 활동 정지가 풀렸어요", { c: n.community });
    case "join_request":
      return tr("{actor} 님이 c/{c} 에 가입을 요청했어요", { actor: n.actor ?? "", c: n.community });
    case "join_approved":
      return tr("c/{c} 가입 요청이 승인됐어요", { c: n.community });
    case "join_denied":
      return tr("c/{c} 가입 요청이 거절됐어요", { c: n.community });
    case "invited":
      return tr("{actor} 님이 c/{c} 에 초대했어요", { actor: n.actor ?? "", c: n.community });
    case "member_removed":
      return tr("c/{c} 회원에서 빠졌어요", { c: n.community });
  }
}

function Icon({ n }: { n: AppNotification }) {
  if (n.actor) return <UserAvatar name={n.actor} src={n.actorAvatar} size="md" />;
  const map = {
    mod_removed: ShieldAlert, banned: Ban, unbanned: ShieldCheck,
    join_request: DoorOpen, join_approved: UserCheck, join_denied: UserX, invited: MailPlus, member_removed: UserMinus,
  } as const;
  const Glyph = map[n.type as keyof typeof map] ?? MessageCircle;
  const good = n.type === "unbanned" || n.type === "join_approved" || n.type === "invited";
  return (
    <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", good ? "bg-up/10 text-up" : "bg-down/10 text-down")}>
      <Glyph className="h-5 w-5" />
    </span>
  );
}

/** 알림 한 건. 누르면 해당 글·댓글로 간다. */
export function NotificationItem({ n, onOpen, compact = false }: { n: AppNotification; onOpen: (n: AppNotification) => void; compact?: boolean }) {
  const t = useT();
  return (
    <Link
      to={notificationLink(n)}
      onClick={() => onOpen(n)}
      className={clsx("flex gap-3 px-4 py-3 transition-colors hover:bg-bg", !n.read && "bg-accent-soft/60")}
    >
      <Icon n={n} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={clsx(!n.read && "font-semibold")}>{headline(n)}</span>
          <span className="ml-1.5 text-xs text-muted">{timeAgo(n.createdAt)}</span>
        </p>
        {n.post && n.type !== "banned" && <p className="truncate text-xs text-muted">{n.post.title}</p>}
        {n.text && (
          <p className={clsx("mt-0.5 text-sm text-muted", compact ? "line-clamp-1" : "line-clamp-2")}>
            {n.type === "banned" || n.type === "join_denied" ? tr("이유: {reason}", { reason: n.text }) : n.text}
          </p>
        )}
      </div>
      {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t("읽지 않음")} />}
    </Link>
  );
}
