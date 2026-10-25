import { requireUser } from "../auth";
import { L } from "../i18n";
import { HttpError, charCount, conflict, forbidden, invalid, json, notFound, readJson, str, type Req, type Res } from "../http";
import { notify } from "../notify";
import { activeBan, db, findUserByName, membersOf, nextInviteId, nextJoinRequestId } from "../store";
import type { Community, Invite, JoinRequest, User } from "../types";
import { cooldownUntil, expired, isMember, pendingInvite, pendingRequest } from "../membership-state";
import { communityView, isModerator } from "../views";

/**
 * 비공개 커뮤니티 회원 받기. 두 길이 있다.
 *   가입 요청 (회원이 아닌 사람이 먼저)
 *     POST   /api/communities/:name/requests        { message }   보내기
 *     DELETE /api/communities/:name/requests/mine                 대기 중인 내 요청 취소
 *     GET    /api/communities/:name/requests?status=pending|decided   (운영진)
 *     POST   /api/requests/:id/approve | /deny  { reason }        (운영진)
 *   초대 (운영진이 먼저)
 *     GET    /api/communities/:name/invites                       대기 중인 초대 (운영진)
 *     POST   /api/communities/:name/invites         { username, message }  (운영진)
 *     DELETE /api/invites/:id                                      초대 취소 (운영진)
 *     POST   /api/invites/:id/accept | /decline                    (초대받은 사람)
 *   회원
 *     GET    /api/communities/:name/members                       (운영진)
 *     DELETE /api/communities/:name/members/:username             내보내기 (운영진, 운영진은 못 내보냄)
 *
 * 규칙
 *   - 비공개 커뮤니티에서만 요청 · 초대를 받는다.
 *   - 요청은 한 사람당 대기 중 1건. 거절되면 24시간 뒤에 다시 보낼 수 있다. 활동 정지 중이면 보낼 수 없다.
 *   - 초대는 7일 뒤 만료된다. 같은 사람에게 대기 중인 초대는 1건.
 *   - 대기 중인 초대가 있는 사람이 요청을 보내면, 요청 대신 초대를 수락하라고 알려 준다.
 *   - 승인 · 수락하면 바로 회원이 되고, 그 사람의 다른 대기 중인 요청 · 초대는 정리된다.
 */

export const REQUEST_MESSAGE_MAX = 500;
export const INVITE_MESSAGE_MAX = 500;
export const DENY_REASON_MAX = 200;
export const INVITE_TTL = 7 * 24 * 60 * 60_000;

function modCommunity(name: string, user: User): Community {
  const community = db.communities.get(name) ?? notFound();
  if (!isModerator(community, user)) forbidden(L("이 커뮤니티의 운영진만 볼 수 있어요."));
  return community;
}

/** 회원이 되면서 남은 요청 · 초대를 정리한다. */
function admit(community: Community, user: User, now: number): void {
  membersOf(community.name).add(user.id);
  for (const r of db.joinRequests.values()) {
    if (r.community === community.name && r.userId === user.id && r.status === "pending") Object.assign(r, { status: "approved", decidedAt: now });
  }
  for (const i of db.invites.values()) {
    if (i.community === community.name && i.userId === user.id && i.status === "pending") Object.assign(i, { status: "accepted", decidedAt: now });
  }
}

function requestView(r: JoinRequest) {
  const user = db.users.get(r.userId);
  return {
    id: r.id,
    user: user?.name ?? L("[알 수 없음]"),
    avatar: user?.avatar ?? null,
    message: r.message,
    status: r.status,
    reason: r.reason,
    createdAt: new Date(r.createdAt).toISOString(),
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    decidedBy: r.decidedBy ? (db.users.get(r.decidedBy)?.name ?? null) : null,
  };
}

function inviteView(i: Invite) {
  const user = db.users.get(i.userId);
  return {
    id: i.id,
    user: user?.name ?? L("[알 수 없음]"),
    avatar: user?.avatar ?? null,
    invitedBy: db.users.get(i.invitedBy)?.name ?? null,
    message: i.message,
    createdAt: new Date(i.createdAt).toISOString(),
    expiresAt: new Date(i.expiresAt).toISOString(),
  };
}

function requirePrivate(c: Community): void {
  if (c.access !== "private") conflict("not_private", L("비공개 커뮤니티에서만 가입 요청 · 초대를 받아요."));
}

export async function handleMembership(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;
  const now = Date.now();

  // ── 가입 요청: 보내기 · 취소 ─────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/requests$/)) && method === "POST") {
    const user = requireUser(req);
    const community = db.communities.get(m[1]) ?? notFound();
    requirePrivate(community);
    if (isMember(community, user) || isModerator(community, user)) conflict("already_member", L("이미 이 커뮤니티 회원이에요."));
    if (activeBan(community.name, user.id)) forbidden(L("이 커뮤니티에서 활동이 정지돼 가입 요청을 보낼 수 없어요."));
    if (pendingInvite(community.name, user.id, now)) conflict("invited", L("이미 초대를 받았어요. 초대를 수락해 주세요."));
    if (pendingRequest(community.name, user.id)) conflict("pending", L("이미 보낸 가입 요청이 있어요. 운영진이 확인할 때까지 기다려 주세요."));
    const cooldown = cooldownUntil(community.name, user.id, now);
    if (cooldown) {
      throw new HttpError(429, { error: "cooldown", retryAt: new Date(cooldown.until).toISOString(), message: L("거절된 뒤 24시간이 지나야 다시 요청할 수 있어요.") });
    }
    const message = str((await readJson(req)).message).trim();
    invalid(charCount(message) > REQUEST_MESSAGE_MAX ? { message: L("메시지는 {n}자까지 쓸 수 있어요.", { n: REQUEST_MESSAGE_MAX }) } : {});
    const request: JoinRequest = { id: nextJoinRequestId(), community: community.name, userId: user.id, message, status: "pending", reason: "", createdAt: now, decidedAt: null, decidedBy: null };
    db.joinRequests.set(request.id, request);
    for (const modId of community.moderatorIds) {
      notify({ userId: modId, type: "join_request", actorId: user.id, community: community.name, postId: null, commentId: null, text: message });
    }
    json(res, 201, { community: communityView(community, user) });
    return true;
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/requests\/mine$/)) && method === "DELETE") {
    const user = requireUser(req);
    const community = db.communities.get(m[1]) ?? notFound();
    const request = pendingRequest(community.name, user.id) ?? notFound();
    Object.assign(request, { status: "cancelled", decidedAt: now });
    // 운영진에게 간 "가입을 요청했어요" 알림도 거둬들인다 (취소된 요청을 처리하러 오지 않게).
    for (const [id, n] of db.notifications) {
      if (n.type === "join_request" && n.community === community.name && n.actorId === user.id) db.notifications.delete(id);
    }
    json(res, 200, { community: communityView(community, user) });
    return true;
  }

  // ── 가입 요청: 운영진 ────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/requests$/)) && method === "GET") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const decided = url.searchParams.get("status") === "decided";
    const items = [...db.joinRequests.values()]
      .filter((r) => r.community === community.name && (decided ? r.status === "approved" || r.status === "denied" : r.status === "pending"))
      .sort((a, b) => (decided ? (b.decidedAt ?? 0) - (a.decidedAt ?? 0) : a.createdAt - b.createdAt))
      .map(requestView);
    json(res, 200, { items });
    return true;
  }

  if ((m = path.match(/^\/api\/requests\/([a-z0-9]+)\/(approve|deny)$/)) && method === "POST") {
    const user = requireUser(req);
    const request = db.joinRequests.get(m[1]) ?? notFound();
    const community = modCommunity(request.community, user);
    if (request.status !== "pending") conflict("already_decided", L("이미 처리됐거나 취소된 요청이에요."));
    const requester = db.users.get(request.userId) ?? notFound();
    if (m[2] === "approve") {
      admit(community, requester, now);
      request.decidedBy = user.id;
      notify({ userId: requester.id, type: "join_approved", actorId: null, community: community.name, postId: null, commentId: null, text: "" });
    } else {
      const reason = str((await readJson(req)).reason).trim();
      invalid(charCount(reason) > DENY_REASON_MAX ? { reason: L("거절 이유는 {n}자까지 쓸 수 있어요.", { n: DENY_REASON_MAX }) } : {});
      Object.assign(request, { status: "denied", reason, decidedAt: now, decidedBy: user.id });
      notify({ userId: requester.id, type: "join_denied", actorId: null, community: community.name, postId: null, commentId: null, text: reason });
    }
    json(res, 200, { request: requestView(request), community: communityView(community, user) });
    return true;
  }

  // ── 초대 ────────────────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/invites$/)) && method === "GET") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const items = [...db.invites.values()]
      .filter((i) => i.community === community.name && i.status === "pending" && !expired(i, now))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(inviteView);
    json(res, 200, { items });
    return true;
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/invites$/)) && method === "POST") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    requirePrivate(community);
    const body = await readJson(req);
    const name = str(body.username).trim().replace(/^u\//i, "");
    const message = str(body.message).trim();
    const fields: Record<string, string> = {};
    const target = name ? findUserByName(name) : undefined;
    if (!name) fields.username = L("초대할 사람의 아이디를 입력해 주세요.");
    else if (!target) fields.username = L("u/{name} 사용자를 찾을 수 없어요.", { name });
    else if (isMember(community, target) || isModerator(community, target)) fields.username = L("u/{name} 님은 이미 회원이에요.", { name: target.name });
    else if (activeBan(community.name, target.id)) fields.username = L("u/{name} 님은 활동 정지 중이라 초대할 수 없어요.", { name: target.name });
    else if (pendingInvite(community.name, target.id, now)) fields.username = L("u/{name} 님에게 보낸 초대가 아직 남아 있어요.", { name: target.name });
    if (charCount(message) > INVITE_MESSAGE_MAX) fields.message = L("메시지는 {n}자까지 쓸 수 있어요.", { n: INVITE_MESSAGE_MAX });
    invalid(fields);
    const invite: Invite = { id: nextInviteId(), community: community.name, userId: target!.id, invitedBy: user.id, message, status: "pending", createdAt: now, expiresAt: now + INVITE_TTL, decidedAt: null };
    db.invites.set(invite.id, invite);
    notify({ userId: target!.id, type: "invited", actorId: user.id, community: community.name, postId: null, commentId: null, text: message });
    json(res, 201, { invite: inviteView(invite) });
    return true;
  }

  if ((m = path.match(/^\/api\/invites\/([a-z0-9]+)$/)) && method === "DELETE") {
    const user = requireUser(req);
    const invite = db.invites.get(m[1]) ?? notFound();
    modCommunity(invite.community, user);
    if (invite.status !== "pending" || expired(invite, now)) conflict("not_pending", L("이미 끝난 초대예요."));
    Object.assign(invite, { status: "cancelled", decidedAt: now });
    json(res, 200, { ok: true });
    return true;
  }

  if ((m = path.match(/^\/api\/invites\/([a-z0-9]+)\/(accept|decline)$/)) && method === "POST") {
    const user = requireUser(req);
    const invite = db.invites.get(m[1]) ?? notFound();
    if (invite.userId !== user.id) forbidden(L("나에게 온 초대만 수락하거나 거절할 수 있어요."));
    if (expired(invite, now)) conflict("expired", L("기간이 지난 초대예요. 운영진에게 다시 초대해 달라고 해 주세요."));
    if (invite.status !== "pending") conflict("not_pending", L("이미 끝난 초대예요."));
    const community = db.communities.get(invite.community) ?? notFound();
    if (m[2] === "accept") admit(community, user, now);
    else Object.assign(invite, { status: "declined", decidedAt: now });
    json(res, 200, { community: communityView(community, user) });
    return true;
  }

  // ── 회원 ────────────────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/members$/)) && method === "GET") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const ids = new Set([...community.moderatorIds, ...(db.members.get(community.name) ?? [])]);
    const items = [...ids]
      .map((id) => db.users.get(id))
      .filter((u): u is User => !!u)
      .map((u) => ({ name: u.name, avatar: u.avatar, moderator: community.moderatorIds.includes(u.id) }))
      .sort((a, b) => Number(b.moderator) - Number(a.moderator) || a.name.localeCompare(b.name));
    json(res, 200, { items });
    return true;
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/members\/([A-Za-z0-9_]+)$/)) && method === "DELETE") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const target = findUserByName(m[2]) ?? notFound();
    if (community.moderatorIds.includes(target.id)) forbidden(L("운영진은 내보낼 수 없어요."));
    if (!isMember(community, target)) notFound();
    db.members.get(community.name)!.delete(target.id);
    notify({ userId: target.id, type: "member_removed", actorId: null, community: community.name, postId: null, commentId: null, text: "" });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * 공개 범위를 비공개에서 다른 것으로 바꾸면, 누구나 가입할 수 있게 되므로
 * 대기 중인 요청은 모두 승인하고(알림도 보냄) 대기 중인 초대는 정리한다.
 */
export function openUp(community: Community, by: User): number {
  const now = Date.now();
  let approved = 0;
  for (const r of db.joinRequests.values()) {
    if (r.community !== community.name || r.status !== "pending") continue;
    const u = db.users.get(r.userId);
    if (!u) continue;
    membersOf(community.name).add(u.id);
    Object.assign(r, { status: "approved", decidedAt: now, decidedBy: by.id });
    notify({ userId: u.id, type: "join_approved", actorId: null, community: community.name, postId: null, commentId: null, text: "" });
    approved += 1;
  }
  for (const i of db.invites.values()) {
    if (i.community === community.name && i.status === "pending") Object.assign(i, { status: "cancelled", decidedAt: now });
  }
  return approved;
}
