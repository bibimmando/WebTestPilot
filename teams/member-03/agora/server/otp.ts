import { randomBytes, randomInt } from "crypto";
import { isOn } from "./bugs";
import { L } from "./i18n";
import { HttpError } from "./http";
import { DEFAULT_PREFS, db, findUserByContact, findUserByName, nextUserId } from "./store";
import type { OtpChallenge, User } from "./types";

/**
 * 전화번호·이메일 인증번호.
 *
 * 테스트용 사이트라 문자·메일을 실제로 보내지 않는다. 대신 인증번호를 응답(devCode)에
 * 실어 화면에 "테스트 환경" 안내와 함께 보여 준다.
 *
 *   유효 시간 3분 · 다시 받기 30초 뒤부터 · 5번 틀리면 잠김
 *   이미 가입된 번호·이메일이면 확인 즉시 로그인, 처음이면 아이디를 정해 가입한다.
 */

export const OTP_TTL_MS = 3 * 60_000;
export const OTP_RESEND_MS = 30_000;
export const OTP_MAX_ATTEMPTS = 5;
const COMPLETE_WINDOW_MS = 10 * 60_000;

export type Channel = "phone" | "email";

export const USERNAME = /^[A-Za-z0-9_]{3,20}$/;

export function usernameError(name: string): string | null {
  if (!USERNAME.test(name)) return L("아이디는 영문·숫자·밑줄로 3~20자여야 해요.");
  if (findUserByName(name)) return L("이미 쓰고 있는 아이디예요.");
  return null;
}

/** 휴대전화는 숫자만(01012345678), 이메일은 소문자로 맞춘다. 형식이 틀리면 null. */
export function normalizeTarget(channel: Channel, raw: string): string | null {
  if (channel === "phone") {
    // 결함 V1: 하이픈을 떼지 않고 검사해 010-1234-5678 형식을 거부한다
    const digits = isOn("V1") ? raw.trim() : raw.replace(/[\s-]/g, "");
    return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
  }
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function maskTarget(channel: Channel, target: string): string {
  if (channel === "phone") return `${target.slice(0, 3)}-****-${target.slice(-4)}`;
  const [local, domain] = target.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

const expired = (message = L("인증번호가 만료됐어요. 다시 받아 주세요.")): never => {
  throw new HttpError(410, { error: "expired", message });
};

export function startOtp(channel: Channel, rawTarget: string): OtpChallenge {
  const target = normalizeTarget(channel, rawTarget);
  if (!target) {
    throw new HttpError(400, {
      error: "validation",
      fields: {
        target: channel === "phone" ? L("휴대전화 번호를 확인해 주세요. 예: 010-1234-5678") : L("이메일 주소를 확인해 주세요."),
      },
    });
  }

  const now = Date.now();
  for (const c of db.otps.values()) {
    if (c.channel === channel && c.target === target && !c.used && c.resendAfter > now) {
      const seconds = Math.ceil((c.resendAfter - now) / 1000);
      throw new HttpError(429, { error: "too_soon", message: L("{seconds}초 뒤에 다시 받을 수 있어요.", { seconds }), retryAfter: seconds });
    }
  }
  // 새 인증번호를 보내면 같은 대상의 이전 인증번호는 쓸 수 없다.
  for (const c of db.otps.values()) if (c.channel === channel && c.target === target) c.used = true;

  const challenge: OtpChallenge = {
    id: randomBytes(12).toString("base64url"),
    channel,
    target,
    code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    resendAfter: now + OTP_RESEND_MS,
    attempts: 0,
    verifiedAt: null,
    used: false,
  };
  db.otps.set(challenge.id, challenge);
  return challenge;
}

export function challengeView(c: OtpChallenge) {
  return {
    challengeId: c.id,
    channel: c.channel,
    maskedTarget: maskTarget(c.channel, c.target),
    expiresAt: new Date(c.expiresAt).toISOString(),
    resendAfter: new Date(c.resendAfter).toISOString(),
    // 테스트용 사이트라 실제로 보내지 않고 인증번호를 그대로 싣는다.
    devCode: c.code,
  };
}

/** 맞으면 기존 계정(있으면)을 돌려준다. 틀리면 남은 횟수와 함께 400. */
export function verifyOtp(challengeId: string, code: string): { challenge: OtpChallenge; user: User | undefined } {
  const c = db.otps.get(challengeId);
  if (!c || c.used) return expired();
  const now = Date.now();

  if (!c.verifiedAt) {
    if (now > c.expiresAt) expired();
    if (c.attempts >= OTP_MAX_ATTEMPTS) {
      throw new HttpError(429, { error: "locked", message: L("인증번호를 5번 틀렸어요. 인증번호를 다시 받아 주세요.") });
    }
    if (!/^\d{6}$/.test(code)) {
      throw new HttpError(400, { error: "validation", fields: { code: L("인증번호 6자리를 입력해 주세요.") } });
    }
    if (code !== c.code) {
      c.attempts += 1;
      const remaining = OTP_MAX_ATTEMPTS - c.attempts;
      throw new HttpError(400, {
        error: "invalid_code",
        message: remaining > 0 ? L("인증번호가 맞지 않아요. {remaining}번 더 시도할 수 있어요.", { remaining }) : L("인증번호를 5번 틀렸어요. 인증번호를 다시 받아 주세요."),
        remaining,
      });
    }
    c.verifiedAt = now;
  }

  const user = findUserByContact(c.channel, c.target);
  if (user) c.used = true;
  return { challenge: c, user };
}

/** 인증을 마친 새 번호·이메일로 계정을 만든다. 비밀번호 없는 계정이다. */
export function completeOtpSignup(challengeId: string, rawName: string): User {
  const c = db.otps.get(challengeId);
  const now = Date.now();
  if (!c || c.used || !c.verifiedAt || now - c.verifiedAt > COMPLETE_WINDOW_MS) {
    return expired(L("인증이 만료됐어요. 처음부터 다시 진행해 주세요."));
  }
  if (findUserByContact(c.channel, c.target)) {
    throw new HttpError(409, { error: "exists", message: L("이미 가입된 정보예요. 로그인해 주세요.") });
  }
  const name = rawName.trim();
  const error = usernameError(name);
  if (error) throw new HttpError(400, { error: "validation", fields: { username: error } });

  const id = nextUserId();
  const user: User = {
    id,
    name,
    salt: null,
    passwordHash: null,
    phone: c.channel === "phone" ? c.target : null,
    email: c.channel === "email" ? c.target : null,
    createdAt: now,
    bio: "",
    avatar: null,
    prefs: { ...DEFAULT_PREFS },
    gender: null,
    interests: [],
  };
  db.users.set(id, user);
  c.used = true;
  return user;
}
