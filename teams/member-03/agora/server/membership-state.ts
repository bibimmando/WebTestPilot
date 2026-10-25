import { activeBan, db } from "./store";
import type { Community, Invite, JoinRequest, User } from "./types";

/**
 * 비공개 커뮤니티의 가입 요청 · 초대 상태 읽기 (features/membership.ts 와 views.ts 가 같이 쓴다).
 * 바꾸는 쪽은 features/membership.ts 에 있다.
 */

export const REQUEST_COOLDOWN = 24 * 60 * 60_000;

export const isMember = (c: Community, user: User) => !!db.members.get(c.name)?.has(user.id);
const isMod = (c: Community, user: User) => c.moderatorIds.includes(user.id);

export const expired = (i: Invite, now = Date.now()) => i.status === "pending" && i.expiresAt <= now;

/** 이 사람의 대기 중인 요청 · 초대 */
export function pendingRequest(community: string, userId: string): JoinRequest | undefined {
  for (const r of db.joinRequests.values()) if (r.community === community && r.userId === userId && r.status === "pending") return r;
  return undefined;
}
export function pendingInvite(community: string, userId: string, now = Date.now()): Invite | undefined {
  for (const i of db.invites.values()) if (i.community === community && i.userId === userId && i.status === "pending" && !expired(i, now)) return i;
  return undefined;
}
/**
 * 거절 뒤 다시 요청할 수 있는 시각. 막혀 있지 않으면 null.
 * 거절 이후에 한 번이라도 회원이 됐다면(초대 수락 · 승인) 그 거절은 더 이상 막지 않는다.
 */
export function cooldownUntil(community: string, userId: string, now = Date.now()): { until: number; reason: string } | null {
  const denied = lastDenied(community, userId);
  if (!denied || denied.decidedAt === null) return null;
  let admitted = 0;
  for (const r of db.joinRequests.values()) if (r.community === community && r.userId === userId && r.status === "approved") admitted = Math.max(admitted, r.decidedAt ?? 0);
  for (const i of db.invites.values()) if (i.community === community && i.userId === userId && i.status === "accepted") admitted = Math.max(admitted, i.decidedAt ?? 0);
  if (admitted >= denied.decidedAt) return null;
  const until = denied.decidedAt + REQUEST_COOLDOWN;
  return until > now ? { until, reason: denied.reason } : null;
}

/** 마지막으로 거절된 요청 (다시 보낼 수 있는 시각 계산용) */
export function lastDenied(community: string, userId: string): JoinRequest | undefined {
  let last: JoinRequest | undefined;
  for (const r of db.joinRequests.values()) {
    if (r.community === community && r.userId === userId && r.status === "denied" && (!last || (r.decidedAt ?? 0) > (last.decidedAt ?? 0))) last = r;
  }
  return last;
}

/** communityView 에 붙는, 보는 사람 자신의 요청 · 초대 상태. 비공개 커뮤니티의 비회원에게만 의미가 있다. */
export function membershipView(c: Community, viewer: User | null) {
  if (!viewer || c.access !== "private" || isMember(c, viewer) || isMod(c, viewer)) return null;
  const now = Date.now();
  const req = pendingRequest(c.name, viewer.id);
  const cooldown = cooldownUntil(c.name, viewer.id, now);
  const inv = pendingInvite(c.name, viewer.id, now);
  return {
    request: req ? { status: "pending" as const, createdAt: new Date(req.createdAt).toISOString() } : null,
    retryAt: cooldown ? new Date(cooldown.until).toISOString() : null,
    denyReason: cooldown?.reason ?? "",
    invite: inv
      ? { id: inv.id, invitedBy: db.users.get(inv.invitedBy)?.name ?? null, message: inv.message, expiresAt: new Date(inv.expiresAt).toISOString() }
      : null,
    banned: !!activeBan(c.name, viewer.id),
  };
}

