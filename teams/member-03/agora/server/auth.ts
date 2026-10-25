import { randomBytes } from "crypto";
import { isOn } from "./bugs";
import { L } from "./i18n";
import { db } from "./store";
import { HttpError, parseCookies, type Req, type Res } from "./http";
import type { User } from "./types";

const COOKIE = "agora_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function currentUser(req: Req): User | null {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const userId = db.sessions.get(token);
  return (userId && db.users.get(userId)) || null;
}

export function requireUser(req: Req): User {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, { error: "auth_required", message: L("로그인이 필요해요.") });
  return user;
}

export function startSession(res: Res, userId: string): void {
  const token = randomBytes(24).toString("base64url");
  db.sessions.set(token, userId);
  // 결함 F1: 로그인하는 순간의 가입 목록을 기억해 두고, 홈 피드가 다음 로그인까지 이것만 쓴다
  if (isOn("F1")) db.homeJoined.set(userId, new Set([...db.communities.keys()].filter((name) => db.members.get(name)?.has(userId))));
  else db.homeJoined.delete(userId);
  res.setHeader(
    "set-cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`,
  );
}

export function endSession(req: Req, res: Res): void {
  const token = parseCookies(req)[COOKIE];
  if (token) db.sessions.delete(token);
  res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
