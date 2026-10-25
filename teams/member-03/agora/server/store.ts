import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { Ban, Comment, Community, Draft, GameRecord, Invite, JoinRequest, Message, Notification, OtpChallenge, Post, Report, Upload, User, VoteDir } from "./types";

/**
 * 메모리 저장소. 서버를 다시 띄우거나 POST /_reset 을 부르면 시드 상태로 돌아간다.
 * 벤치마크는 매 실행 전에 /_reset 을 불러 같은 데이터에서 시작한다.
 */
export const db = {
  users: new Map<string, User>(),
  /** 세션 토큰 → 사용자 ID */
  sessions: new Map<string, string>(),
  communities: new Map<string, Community>(),
  /** 커뮤니티 이름 → 가입한 사용자 ID */
  members: new Map<string, Set<string>>(),
  posts: new Map<string, Post>(),
  comments: new Map<string, Comment>(),
  /** `${userId}|${targetId}` → 1 또는 -1 */
  votes: new Map<string, VoteDir>(),
  /** 대상 ID → 실제 투표 합계 */
  voteTotals: new Map<string, number>(),
  /** 전화번호·이메일 인증번호 */
  otps: new Map<string, OtpChallenge>(),
  uploads: new Map<string, Upload>(),
  notifications: new Map<string, Notification>(),
  messages: new Map<string, Message>(),
  /** 사용자 ID → 저장한 글 ID (넣은 순서 = 저장한 순서) */
  saves: new Map<string, Set<string>>(),
  /** 사용자 ID → 숨긴 글 ID */
  hides: new Map<string, Set<string>>(),
  reports: new Map<string, Report>(),
  /** `${community}|${userId}` → 활동 정지 */
  bans: new Map<string, Ban>(),
  /** 게임 ID → 사용자 ID → 기록 */
  games: new Map<string, Map<string, GameRecord>>(),
  drafts: new Map<string, Draft>(),
  joinRequests: new Map<string, JoinRequest>(),
  invites: new Map<string, Invite>(),
  /** 결함 F1: 사용자 ID → 로그인할 때의 가입 목록 */
  homeJoined: new Map<string, Set<string>>(),
  seq: { user: 0, post: 0, comment: 0, upload: 0, notification: 0, message: 0, report: 0, draft: 0, joinRequest: 0, invite: 0 },
};

export function clearAll(): void {
  db.users.clear();
  db.sessions.clear();
  db.communities.clear();
  db.members.clear();
  db.posts.clear();
  db.comments.clear();
  db.votes.clear();
  db.voteTotals.clear();
  db.otps.clear();
  db.uploads.clear();
  db.notifications.clear();
  db.messages.clear();
  db.saves.clear();
  db.hides.clear();
  db.reports.clear();
  db.bans.clear();
  db.games.clear();
  db.drafts.clear();
  db.joinRequests.clear();
  db.invites.clear();
  db.homeJoined.clear();
  db.seq = { user: 0, post: 0, comment: 0, upload: 0, notification: 0, message: 0, report: 0, draft: 0, joinRequest: 0, invite: 0 };
}

export const nextUserId = (): string => `u${++db.seq.user}`;
// 글 ID 는 짧은 36진수로 만든다 (1000, 1001, ...).
export const nextPostId = (): string => (++db.seq.post + 46655).toString(36);
export const nextCommentId = (): string => `c${(++db.seq.comment + 1295).toString(36)}`;
export const nextUploadId = (): string => `m${(++db.seq.upload + 1295).toString(36)}`;
export const nextNotificationId = (): string => `n${++db.seq.notification}`;
export const nextMessageId = (): string => `dm${++db.seq.message}`;
export const nextReportId = (): string => `r${++db.seq.report}`;
export const nextDraftId = (): string => `d${++db.seq.draft}`;
export const nextJoinRequestId = (): string => `jr${++db.seq.joinRequest}`;
export const nextInviteId = (): string => `inv${++db.seq.invite}`;

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, passwordHash: scryptSync(password, salt, 32).toString("hex") };
}

export function verifyPassword(user: User, password: string): boolean {
  if (!user.passwordHash || !user.salt) return false; // 인증번호로만 가입한 계정
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = scryptSync(password, user.salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function findUserByName(name: string): User | undefined {
  const lower = name.toLowerCase();
  for (const user of db.users.values()) if (user.name.toLowerCase() === lower) return user;
  return undefined;
}

export function findUserByContact(channel: "phone" | "email", target: string): User | undefined {
  for (const user of db.users.values()) if (user[channel] === target) return user;
  return undefined;
}

export function myVote(userId: string | null | undefined, targetId: string): 1 | 0 | -1 {
  if (!userId) return 0;
  return db.votes.get(`${userId}|${targetId}`) ?? 0;
}

/** dir 0 은 투표 취소다. 같은 사람이 같은 대상에 다시 투표하면 이전 표를 대체한다. */
export function castVote(userId: string, targetId: string, dir: 1 | 0 | -1): void {
  const key = `${userId}|${targetId}`;
  const prev = db.votes.get(key) ?? 0;
  if (dir === 0) db.votes.delete(key);
  else db.votes.set(key, dir);
  db.voteTotals.set(targetId, (db.voteTotals.get(targetId) ?? 0) + dir - prev);
}

export function scoreOf(item: Post | Comment): number {
  return item.baseScore + (db.voteTotals.get(item.id) ?? 0);
}

export function membersOf(community: string): Set<string> {
  let set = db.members.get(community);
  if (!set) {
    set = new Set();
    db.members.set(community, set);
  }
  return set;
}

/** 사용자별 집합 (저장·숨김) */
export function setOf(map: Map<string, Set<string>>, userId: string): Set<string> {
  let set = map.get(userId);
  if (!set) {
    set = new Set();
    map.set(userId, set);
  }
  return set;
}

/** 지금 유효한 활동 정지. 기간이 지났으면 지우고 null */
export function activeBan(community: string, userId: string | null | undefined, now = Date.now()) {
  if (!userId) return null;
  const key = `${community}|${userId}`;
  const ban = db.bans.get(key);
  if (!ban) return null;
  if (ban.until !== null && ban.until <= now) {
    db.bans.delete(key);
    return null;
  }
  return ban;
}

export const DEFAULT_PREFS = { replyNotifications: true, modNotifications: true, allowMessages: true } as const;
