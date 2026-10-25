import { lc, tc } from "./content";
import { unreadCounts } from "./notify";
import { L } from "./i18n";
import { membershipView } from "./membership-state";
import { activeBan, db, myVote, scoreOf } from "./store";
import type { Ban, Comment, Community, Message, Notification, Post, Report, User } from "./types";

/** 원본 데이터를 화면으로 내보내는 모양으로 바꾼다. 비밀번호 같은 내부 값은 여기서 걸러진다. */

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function userName(id: string): string {
  return db.users.get(id)?.name ?? L("[알 수 없음]");
}

export function karmaOf(userId: string) {
  let post = 0;
  let comment = 0;
  for (const p of db.posts.values()) if (p.authorId === userId && !p.deleted && !p.removed) post += scoreOf(p);
  for (const c of db.comments.values()) if (c.authorId === userId && !c.deleted && !c.removed) comment += scoreOf(c);
  return { post, comment };
}

export function meView(user: User) {
  return {
    name: user.name,
    avatar: user.avatar,
    karma: karmaOf(user.id),
    createdAt: iso(user.createdAt),
    moderates: [...db.communities.values()].filter((c) => c.moderatorIds.includes(user.id)).map((c) => c.name),
    joined: [...db.communities.values()].filter((c) => db.members.get(c.name)?.has(user.id)).map((c) => c.name),
    interests: [...user.interests],
    unread: unreadCounts(user.id),
  };
}

export function isModerator(community: Community, viewer: User | null): boolean {
  return !!viewer && community.moderatorIds.includes(viewer.id);
}

/** 비공개 커뮤니티는 회원 · 운영진만 본다. */
export function canViewCommunity(c: Community | undefined, viewer: User | null): boolean {
  if (!c || c.access !== "private") return true;
  return !!viewer && (c.moderatorIds.includes(viewer.id) || !!db.members.get(c.name)?.has(viewer.id));
}

/** 이 글이 속한 커뮤니티를 볼 수 있는지 */
export const canViewPost = (p: { community: string }, viewer: User | null): boolean => canViewCommunity(db.communities.get(p.community), viewer);

export function communityView(c: Community, viewer: User | null) {
  const members = db.members.get(c.name);
  let postCount = 0;
  for (const p of db.posts.values()) if (p.community === c.name && !p.deleted && !p.removed) postCount += 1;
  const isMod = isModerator(c, viewer);
  let openReports = 0;
  if (isMod) for (const r of db.reports.values()) if (r.community === c.name && r.status === "open") openReports += 1;
  const ban = activeBan(c.name, viewer?.id);
  return {
    name: c.name,
    title: lc(c.title),
    description: lc(c.description),
    rules: c.rules.map(lc),
    /** 말머리는 원문이 열쇠다 (?flair=, 저장 값). 화면 이름은 flairLabels */
    flairs: c.flairs,
    flairLabels: Object.fromEntries(c.flairs.map((f) => [f, lc(f)])),
    source: { title: c.title, description: c.description, rules: c.rules },
    requireFlair: c.requireFlair,
    access: c.access,
    /** 운영진만 글을 쓴다 (access 가 restricted) */
    restricted: c.access === "restricted",
    mature: c.mature,
    /** 보는 사람이 글을 볼 수 있는지 (비공개 커뮤니티의 비회원이면 false) */
    canView: canViewCommunity(c, viewer),
    /** 비공개 커뮤니티의 비회원: 내 가입 요청 · 받은 초대. 그 밖에는 null */
    membership: membershipView(c, viewer),
    icon: c.icon,
    banner: c.banner,
    color: c.color,
    topics: c.topics,
    moderators: c.moderatorIds.map(userName),
    members: c.baseMembers + (members?.size ?? 0),
    createdAt: iso(c.createdAt),
    joined: !!viewer && !!members?.has(viewer.id),
    isModerator: isMod,
    postCount,
    /** 운영진에게만 숫자, 나머지는 null */
    openReports: isMod ? openReports : null,
    /** 보는 사람이 이 커뮤니티에서 활동 정지 중이면 그 내용 */
    myBan: ban ? { reason: ban.reason, until: iso(ban.until) } : null,
  };
}

export function commentCount(postId: string): number {
  let n = 0;
  for (const c of db.comments.values()) if (c.postId === postId) n += 1;
  return n;
}

export function postView(p: Post, viewer: User | null) {
  const community = db.communities.get(p.community)!;
  const gone = p.deleted || p.removed;
  const isAuthor = !!viewer && viewer.id === p.authorId;
  const isMod = isModerator(community, viewer);
  return {
    id: p.id,
    community: p.community,
    communityTitle: lc(community.title),
    communityIcon: community.icon,
    author: gone ? null : userName(p.authorId),
    authorAvatar: gone ? null : (db.users.get(p.authorId)?.avatar ?? null),
    title: p.title,
    body: gone ? "" : p.body,
    url: gone ? null : p.url,
    images: gone ? [] : p.images,
    video: gone ? null : p.video,
    spoiler: p.spoiler,
    translated: gone ? null : translatePost(p),
    flair: p.flair,
    flairLabel: p.flair ? lc(p.flair) : null,
    createdAt: iso(p.createdAt),
    editedAt: iso(p.editedAt),
    score: scoreOf(p),
    myVote: myVote(viewer?.id, p.id),
    commentCount: commentCount(p.id),
    pinned: p.pinned,
    deleted: p.deleted,
    removed: p.removed,
    canEdit: isAuthor && !gone,
    canDelete: (isAuthor || isMod) && !gone,
    canPin: isMod && !gone,
    canReport: !!viewer && !isAuthor && !gone,
    saved: !!viewer && !!db.saves.get(viewer.id)?.has(p.id),
    hidden: !!viewer && !!db.hides.get(viewer.id)?.has(p.id),
  };
}

export function commentView(c: Comment, viewer: User | null) {
  const post = db.posts.get(c.postId)!;
  const community = db.communities.get(post.community)!;
  const isAuthor = !!viewer && viewer.id === c.authorId;
  const gone = c.deleted || c.removed;
  return {
    id: c.id,
    postId: c.postId,
    parentId: c.parentId,
    author: gone ? null : userName(c.authorId),
    authorAvatar: gone ? null : (db.users.get(c.authorId)?.avatar ?? null),
    body: gone ? "" : c.body,
    translated: gone ? null : tc(c.body),
    createdAt: iso(c.createdAt),
    editedAt: iso(c.editedAt),
    score: scoreOf(c),
    myVote: myVote(viewer?.id, c.id),
    deleted: c.deleted,
    removed: c.removed,
    isPostAuthor: c.authorId === post.authorId,
    canEdit: isAuthor && !gone,
    canDelete: (isAuthor || isModerator(community, viewer)) && !gone,
    canReport: !!viewer && !isAuthor && !gone,
  };
}

export function userView(u: User, viewer: User | null) {
  return {
    name: u.name,
    avatar: u.avatar,
    bio: lc(u.bio),
    karma: karmaOf(u.id),
    createdAt: iso(u.createdAt),
    isMe: !!viewer && viewer.id === u.id,
    canMessage: !!viewer && viewer.id !== u.id && u.prefs.allowMessages,
    moderates: [...db.communities.values()].filter((c) => c.moderatorIds.includes(u.id)).map((c) => c.name),
  };
}

export function notificationView(n: Notification) {
  const post = n.postId ? db.posts.get(n.postId) : undefined;
  const actor = n.actorId ? db.users.get(n.actorId) : undefined;
  return {
    id: n.id,
    type: n.type,
    actor: actor?.name ?? null,
    actorAvatar: actor?.avatar ?? null,
    community: n.community,
    post: post ? { id: post.id, title: lc(post.title), community: post.community } : null,
    commentId: n.commentId,
    text: lc(n.text),
    createdAt: iso(n.createdAt),
    read: n.readAt !== null,
  };
}

export function messageView(m: Message, viewer: User) {
  return {
    id: m.id,
    from: userName(m.fromId),
    to: userName(m.toId),
    mine: m.fromId === viewer.id,
    body: m.body,
    createdAt: iso(m.createdAt),
    read: m.readAt !== null,
  };
}

export function reportView(r: Report, viewer: User | null) {
  const comment = r.targetType === "comment" ? db.comments.get(r.targetId)! : null;
  const post = db.posts.get(comment ? comment.postId : r.targetId)!;
  return {
    id: r.id,
    type: r.targetType,
    post: postView(post, viewer),
    comment: comment ? commentView(comment, viewer) : null,
    /** 신고된 글·댓글의 작성자. 삭제된 뒤에도 운영진은 누구였는지 알아야 한다. */
    targetAuthor: userName(comment ? comment.authorId : post.authorId),
    /** 삭제된 뒤에도 운영진이 무엇이 신고됐는지 볼 수 있게 원문을 같이 준다. */
    original: comment ? comment.body : `${post.title}\n\n${post.body}`.trim(),
    reporter: userName(r.reporterId),
    reason: r.reason,
    rule: r.ruleIndex === null ? null : (db.communities.get(r.community)?.rules[r.ruleIndex] ?? null),
    detail: r.detail,
    createdAt: iso(r.createdAt),
    status: r.status,
    resolvedBy: r.resolvedBy ? userName(r.resolvedBy) : null,
    resolvedAt: iso(r.resolvedAt),
  };
}

export function banView(b: Ban) {
  return {
    user: userName(b.userId),
    avatar: db.users.get(b.userId)?.avatar ?? null,
    reason: b.reason,
    until: iso(b.until),
    by: userName(b.byId),
    createdAt: iso(b.createdAt),
  };
}

/** 제목 · 본문 · 이미지 설명 중 하나라도 번역이 있으면 번역판, 없으면 null */
function translatePost(p: Post) {
  const title = tc(p.title);
  const body = tc(p.body);
  const images = p.images.map((i) => ({ alt: tc(i.alt), caption: tc(i.caption) }));
  if (!title && !body && !images.some((i) => i.alt || i.caption)) return null;
  return {
    title: title ?? p.title,
    body: body ?? p.body,
    images: images.map((i, n) => ({ alt: i.alt ?? p.images[n].alt, caption: i.caption ?? p.images[n].caption })),
  };
}
