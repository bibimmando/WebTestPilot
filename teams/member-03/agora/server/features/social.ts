import { currentUser, requireUser } from "../auth";
import { L } from "../i18n";
import { badField, bool, charCount, conflict, forbidden, intParam, invalid, json, notFound, readJson, str, type Req, type Res } from "../http";
import { unreadCounts } from "../notify";
import { GENDERS, INTEREST_IDS, interestLabel, localizedCategories, type Gender } from "../interests";
import { normalizeTarget } from "../otp";
import { db, findUserByContact, findUserByName, hashPassword, membersOf, nextMessageId, nextReportId, setOf, verifyPassword } from "../store";
import type { ReportReason, User } from "../types";
import { canViewPost, communityView, meView, messageView, notificationView, postView, userView } from "../views";
import { ownUpload, uploadUrl } from "./media";

/**
 * 로그인한 사람의 개인 기능.
 *   저장·숨기기      POST /api/posts/:id/save  { saved }   POST /api/posts/:id/hide  { hidden }
 *                    GET  /api/me/saved   GET /api/me/hidden
 *   알림             GET  /api/notifications?filter=unread   POST /api/notifications/read { ids? }
 *   쪽지             GET  /api/messages   GET /api/messages/:name   POST /api/messages { to, body }
 *   설정             GET  /api/me/settings   PATCH /api/me/profile   PATCH /api/me/prefs
 *                    PATCH /api/me/email   POST /api/me/password
 *   신고             POST /api/reports { type, id, reason, rule?, detail? }
 *   가입 뒤 설정     GET  /api/interests   PUT /api/me/gender { gender }   PUT /api/me/interests { interests }
 *   추천 커뮤니티    GET  /api/communities/recommended?limit=5
 *   한꺼번에 가입    POST /api/me/joined { names }   (가입 마지막 단계. 이미 가입한 곳은 그대로 둔다)
 */

export const MESSAGE_MAX = 1000;
const JOIN_MAX = 20;
export const BIO_MAX = 200;
export const REPORT_DETAIL_MIN = 10;
export const REPORT_DETAIL_MAX = 500;
const REASONS: ReportReason[] = ["spam", "harassment", "misinformation", "rule", "other"];

export async function handleSocial(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  // ── 저장 · 숨기기 ──────────────────────────────────────
  if ((m = path.match(/^\/api\/posts\/([a-z0-9]+)\/(save|hide)$/)) && method === "POST") {
    const user = requireUser(req);
    const post = db.posts.get(m[1]) ?? notFound();
    if (!canViewPost(post, user)) notFound();
    const key = m[2] === "save" ? "saved" : "hidden";
    const value = bool((await readJson(req))[key]) ?? badField(key, L("true 또는 false 여야 해요."));
    const set = setOf(m[2] === "save" ? db.saves : db.hides, user.id);
    // 저장 순서를 "최근에 저장한 순" 으로 보여 주려고 지웠다가 다시 넣는다.
    set.delete(post.id);
    if (value) set.add(post.id);
    json(res, 200, { post: postView(post, user) });
    return true;
  }

  if ((m = path.match(/^\/api\/me\/(saved|hidden)$/)) && method === "GET") {
    const user = requireUser(req);
    const ids = [...(db[m[1] === "saved" ? "saves" : "hides"].get(user.id) ?? [])].reverse();
    const items = ids
      .map((id) => db.posts.get(id))
      .filter((p) => p && !p.deleted && !p.removed && canViewPost(p, user))
      .map((p) => postView(p!, user));
    json(res, 200, { items });
    return true;
  }

  // ── 알림 ──────────────────────────────────────────────
  if (path === "/api/notifications" && method === "GET") {
    const user = requireUser(req);
    const unreadOnly = url.searchParams.get("filter") === "unread";
    const items = [...db.notifications.values()]
      .filter((n) => n.userId === user.id && (!unreadOnly || n.readAt === null))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map(notificationView);
    json(res, 200, { items, unread: unreadCounts(user.id) });
    return true;
  }

  if (path === "/api/notifications/read" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? new Set(body.ids.filter((x): x is string => typeof x === "string")) : null;
    const now = Date.now();
    for (const n of db.notifications.values()) {
      if (n.userId === user.id && n.readAt === null && (!ids || ids.has(n.id))) n.readAt = now;
    }
    json(res, 200, { unread: unreadCounts(user.id) });
    return true;
  }

  // ── 쪽지 ──────────────────────────────────────────────
  if (path === "/api/messages" && method === "GET") {
    const user = requireUser(req);
    const byPeer = new Map<string, { lastAt: number; last: ReturnType<typeof messageView>; unread: number }>();
    const mine = [...db.messages.values()].filter((x) => x.fromId === user.id || x.toId === user.id);
    mine.sort((a, b) => a.createdAt - b.createdAt);
    for (const msg of mine) {
      const peer = msg.fromId === user.id ? msg.toId : msg.fromId;
      const prev = byPeer.get(peer);
      const unread = (prev?.unread ?? 0) + (msg.toId === user.id && msg.readAt === null ? 1 : 0);
      byPeer.set(peer, { lastAt: msg.createdAt, last: messageView(msg, user), unread });
    }
    const conversations = [...byPeer.entries()]
      .sort((a, b) => b[1].lastAt - a[1].lastAt)
      .map(([peerId, c]) => {
        const peer = db.users.get(peerId)!;
        return { with: peer.name, avatar: peer.avatar, last: c.last, unread: c.unread };
      });
    json(res, 200, { conversations, unread: unreadCounts(user.id) });
    return true;
  }

  if ((m = path.match(/^\/api\/messages\/([A-Za-z0-9_]+)$/)) && method === "GET") {
    const user = requireUser(req);
    const peer = findUserByName(m[1]) ?? notFound();
    const now = Date.now();
    const items = [...db.messages.values()]
      .filter((x) => (x.fromId === user.id && x.toId === peer.id) || (x.fromId === peer.id && x.toId === user.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    // 열어 보면 받은 쪽지는 읽음으로 바뀐다. 응답에는 열기 전 상태를 담아 "새 쪽지" 표시를 한 번 보여 준다.
    const view = items.map((x) => messageView(x, user));
    for (const x of items) if (x.toId === user.id && x.readAt === null) x.readAt = now;
    json(res, 200, { with: userView(peer, user), items: view, unread: unreadCounts(user.id) });
    return true;
  }

  if (path === "/api/messages" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const toName = str(body.to).trim().replace(/^u\//, "");
    const text = str(body.body).trim();
    const fields: Record<string, string> = {};
    const peer = toName ? findUserByName(toName) : undefined;
    if (!toName) fields.to = L("받는 사람을 입력해 주세요.");
    else if (!peer) fields.to = L("없는 사용자예요.");
    else if (peer.id === user.id) fields.to = L("나에게는 쪽지를 보낼 수 없어요.");
    else if (!peer.prefs.allowMessages) fields.to = L("쪽지를 받지 않는 사용자예요.");
    if (!text) fields.body = L("내용을 입력해 주세요.");
    else if (charCount(text) > MESSAGE_MAX) fields.body = L("쪽지는 {n}자까지 쓸 수 있어요.", { n: MESSAGE_MAX.toLocaleString() });
    invalid(fields);
    const id = nextMessageId();
    const msg = { id, fromId: user.id, toId: peer!.id, body: text, createdAt: Date.now(), readAt: null };
    db.messages.set(id, msg);
    json(res, 201, { message: messageView(msg, user) });
    return true;
  }

  // ── 설정 ──────────────────────────────────────────────
  if (path === "/api/me/settings" && method === "GET") {
    const user = requireUser(req);
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/profile" && method === "PATCH") {
    const user = requireUser(req);
    const body = await readJson(req);
    const bio = str(body.bio).trim();
    const fields: Record<string, string> = {};
    if (charCount(bio) > BIO_MAX) fields.bio = L("자기소개는 {n}자까지 쓸 수 있어요.", { n: BIO_MAX });
    // avatar: 올린 파일 ID 면 바꾸고, null 이면 기본 그림으로, 없으면 그대로 둔다.
    let avatar = user.avatar;
    if (body.avatar === null) avatar = null;
    else if (typeof body.avatar === "string") {
      const upload = ownUpload(body.avatar, user);
      if (!upload) fields.avatar = L("올린 이미지를 찾을 수 없어요. 다시 올려 주세요.");
      else avatar = uploadUrl(upload.id);
    }
    invalid(fields);
    user.bio = bio;
    user.avatar = avatar;
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/prefs" && method === "PATCH") {
    const user = requireUser(req);
    const body = await readJson(req);
    for (const key of ["replyNotifications", "modNotifications", "allowMessages"] as const) {
      if (key in body) user.prefs[key] = bool(body[key]) ?? badField(key, L("true 또는 false 여야 해요."));
    }
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/email" && method === "PATCH") {
    const user = requireUser(req);
    const raw = str((await readJson(req)).email);
    if (!raw.trim()) badField("email", L("이메일을 입력해 주세요."));
    const email = normalizeTarget("email", raw) ?? badField("email", L("이메일 형식이 아니에요."));
    const owner = findUserByContact("email", email);
    if (owner && owner.id !== user.id) badField("email", L("이미 다른 계정에서 쓰는 이메일이에요."));
    user.email = email;
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/password" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const current = str(body.current);
    const next = str(body.password);
    const confirm = str(body.passwordConfirm);
    const fields: Record<string, string> = {};
    const hasPassword = !!user.passwordHash;
    if (hasPassword && !current) fields.current = L("현재 비밀번호를 입력해 주세요.");
    else if (hasPassword && !verifyPassword(user, current)) fields.current = L("현재 비밀번호가 맞지 않아요.");
    if (charCount(next) < 8) fields.password = L("비밀번호는 8자 이상이어야 해요.");
    else if (charCount(next) > 64) fields.password = L("비밀번호는 64자까지 쓸 수 있어요.");
    else if (hasPassword && next === current) fields.password = L("지금 비밀번호와 다른 비밀번호를 써 주세요.");
    if (next !== confirm) fields.passwordConfirm = L("비밀번호가 서로 달라요.");
    invalid(fields);
    Object.assign(user, hashPassword(next));
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  // ── 성별 · 관심 항목 ──────────────────────────────────────
  if (path === "/api/interests" && method === "GET") {
    json(res, 200, { categories: localizedCategories() });
    return true;
  }

  if (path === "/api/me/gender" && method === "PUT") {
    const user = requireUser(req);
    const value = (await readJson(req)).gender;
    // null 은 "밝히지 않음" 으로 되돌리기
    if (value !== null && !(GENDERS as readonly unknown[]).includes(value)) badField("gender", L("남성, 여성, 논바이너리 중에서 골라 주세요."));
    user.gender = value as Gender | null;
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/interests" && method === "PUT") {
    const user = requireUser(req);
    const raw = (await readJson(req)).interests;
    if (!Array.isArray(raw)) badField("interests", L("관심 항목 목록을 보내 주세요."));
    const ids = [...new Set((raw as unknown[]).map((x) => (typeof x === "string" ? x : "")))];
    const unknown = ids.filter((x) => !INTEREST_IDS.has(x));
    if (unknown.length > 0) badField("interests", L("없는 관심 항목이 들어 있어요."));
    if (ids.length === 0) badField("interests", L("관심 항목을 1개 이상 골라 주세요."));
    user.interests = ids;
    json(res, 200, { settings: settingsView(user) });
    return true;
  }

  if (path === "/api/me/joined" && method === "POST") {
    const user = requireUser(req);
    const raw = (await readJson(req)).names;
    if (!Array.isArray(raw)) badField("names", L("커뮤니티 목록을 보내 주세요."));
    const names = [...new Set((raw as unknown[]).map((x) => (typeof x === "string" ? x : "")))];
    if (names.length > JOIN_MAX) badField("names", L("한 번에 {n}곳까지 가입할 수 있어요.", { n: JOIN_MAX }));
    if (names.some((n) => !db.communities.has(n))) badField("names", L("없는 커뮤니티가 들어 있어요."));
    for (const n of names) membersOf(n).add(user.id);
    json(res, 200, { user: meView(user) });
    return true;
  }

  if (path === "/api/communities/recommended" && method === "GET") {
    const limit = intParam(url.searchParams.get("limit"), 5, 1, 20);
    json(res, 200, recommendCommunities(currentUser(req), limit));
    return true;
  }

  // ── 신고 ──────────────────────────────────────────────
  if (path === "/api/reports" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const type = str(body.type);
    if (type !== "post" && type !== "comment") badField("type", L("post 또는 comment 여야 해요."));
    const targetId = str(body.id);
    const comment = type === "comment" ? (db.comments.get(targetId) ?? notFound()) : null;
    const post = db.posts.get(comment ? comment.postId : targetId) ?? notFound();
    if (!canViewPost(post, user)) notFound();
    const authorId = comment ? comment.authorId : post.authorId;
    const gone = comment ? comment.deleted || comment.removed : post.deleted || post.removed;
    if (gone) conflict("gone", L("이미 삭제된 글이에요."));
    if (authorId === user.id) forbidden(L("내가 쓴 글은 신고할 수 없어요."));

    const community = db.communities.get(post.community)!;
    const reason = str(body.reason) as ReportReason;
    const detail = str(body.detail).trim();
    const fields: Record<string, string> = {};
    let ruleIndex: number | null = null;
    if (!REASONS.includes(reason)) fields.reason = L("신고 이유를 골라 주세요.");
    if (reason === "rule") {
      const n = typeof body.rule === "number" ? body.rule : Number.NaN;
      if (!Number.isInteger(n) || n < 0 || n >= community.rules.length) fields.rule = L("어긴 규칙을 골라 주세요.");
      else ruleIndex = n;
    }
    if (reason === "other" && charCount(detail) < REPORT_DETAIL_MIN) {
      fields.detail = L("무엇이 문제인지 {n}자 이상 적어 주세요.", { n: REPORT_DETAIL_MIN });
    } else if (charCount(detail) > REPORT_DETAIL_MAX) {
      fields.detail = L("{n}자까지 쓸 수 있어요.", { n: REPORT_DETAIL_MAX });
    }
    invalid(fields);

    const targetType = comment ? "comment" : "post";
    for (const r of db.reports.values()) {
      if (r.reporterId === user.id && r.targetId === targetId && r.targetType === targetType && r.status === "open") {
        conflict("already_reported", L("이미 신고한 글이에요. 운영진이 확인하고 있어요."));
      }
    }
    const id = nextReportId();
    db.reports.set(id, {
      id,
      targetType,
      targetId,
      community: community.name,
      reporterId: user.id,
      reason,
      ruleIndex,
      detail,
      createdAt: Date.now(),
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
    json(res, 201, { ok: true });
    return true;
  }

  return false;
}

function settingsView(user: User) {
  return {
    name: user.name,
    avatar: user.avatar,
    bio: user.bio,
    email: user.email,
    phone: user.phone,
    hasPassword: !!user.passwordHash,
    prefs: { ...user.prefs },
    gender: user.gender,
    interests: [...user.interests],
  };
}



/**
 * 아직 가입하지 않은 커뮤니티 중에서 추천한다.
 *   관심 항목과 겹치는 개수가 많은 순 → 회원 수 순.
 *   겹치는 곳이 모자라면(관심 항목이 없거나 로그인 안 함) 회원 수가 많은 곳으로 채운다.
 *   운영진만 글을 쓰는 커뮤니티(공지) · 비공개 · 성인용 커뮤니티는 추천하지 않는다.
 */
function recommendCommunities(viewer: User | null, limit: number) {
  const mine = new Set(viewer?.interests ?? []);
  const scored = [...db.communities.values()]
    .filter((c) => c.access === "public" && !c.mature && !(viewer && db.members.get(c.name)?.has(viewer.id)))
    .map((c) => ({ view: communityView(c, viewer), matched: c.topics.filter((t) => mine.has(t)) }));
  const byInterest = scored.filter((x) => x.matched.length > 0).sort((a, b) => b.matched.length - a.matched.length || b.view.members - a.view.members);
  const popular = scored.filter((x) => x.matched.length === 0).sort((a, b) => b.view.members - a.view.members);
  return {
    basedOnInterests: mine.size > 0,
    items: [...byInterest, ...popular].slice(0, limit).map((x) => ({
      community: x.view,
      reason: x.matched.length > 0 ? ("interest" as const) : ("popular" as const),
      matched: x.matched.map((id) => ({ id, label: interestLabel(id) })),
    })),
  };
}
