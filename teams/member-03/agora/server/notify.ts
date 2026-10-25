import { isOn } from "./bugs";
import { db, nextNotificationId } from "./store";
import type { Notification } from "./types";

type NewNotification = Omit<Notification, "id" | "readAt" | "createdAt"> & { createdAt?: number; readAt?: number | null };

/**
 * 알림을 하나 남긴다. 받는 사람이 꺼 둔 종류이거나, 자기가 한 일이면 남기지 않는다.
 * 미리보기 문구는 100자로 자른다.
 */
export function notify(n: NewNotification): void {
  const user = db.users.get(n.userId);
  if (!user || n.actorId === n.userId) return;
  const isReply = n.type === "post_reply" || n.type === "comment_reply";
  // 결함 F3: '답글 알림' 을 꺼도 '내 글에 달린 댓글' 만 멈추고 '내 댓글에 달린 답글' 은 계속 보낸다
  const muted = isOn("F3") ? n.type === "post_reply" : isReply;
  if (muted && !user.prefs.replyNotifications) return;
  if (!isReply && !user.prefs.modNotifications) return;
  const id = nextNotificationId();
  const chars = [...n.text];
  db.notifications.set(id, {
    ...n,
    id,
    text: chars.length > 100 ? `${chars.slice(0, 100).join("")}…` : n.text,
    createdAt: n.createdAt ?? Date.now(),
    readAt: n.readAt ?? null,
  });
}

export function unreadCounts(userId: string) {
  let notifications = 0;
  let messages = 0;
  for (const n of db.notifications.values()) if (n.userId === userId && n.readAt === null) notifications += 1;
  for (const m of db.messages.values()) if (m.toId === userId && m.readAt === null) messages += 1;
  return { notifications, messages };
}
