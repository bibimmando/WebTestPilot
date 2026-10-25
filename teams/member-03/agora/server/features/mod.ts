import { requireUser } from "../auth";
import { L } from "../i18n";
import { badField, charCount, conflict, forbidden, invalid, json, notFound, readJson, str, type Req, type Res } from "../http";
import { notify } from "../notify";
import { activeBan, db, findUserByName } from "../store";
import { COMMUNITY_ACCESS, type Community, type CommunityAccess, type User } from "../types";
import { banView, communityView, isModerator, reportView } from "../views";
import { ownUpload, uploadUrl } from "./media";
import { openUp } from "./membership";

/**
 * 운영 도구. 그 커뮤니티의 운영진만 쓸 수 있다.
 *   신고함       GET  /api/communities/:name/reports?status=open|resolved
 *                POST /api/reports/:id/resolve  { action: "approve" | "remove" }
 *   활동 정지     GET  /api/communities/:name/bans
 *                POST /api/communities/:name/bans  { username, days, reason }
 *                DELETE /api/communities/:name/bans/:username
 *   커뮤니티 설정  PATCH /api/communities/:name  { description, rules, requireFlair, color, icon, banner, access, mature }
 *                비공개를 풀면 대기 중인 가입 요청은 모두 승인하고 초대는 정리한다 (membership.ts openUp).
 */

export const BAN_DAYS = [1, 3, 7, 30, 0] as const; // 0 은 영구
export const BAN_REASON_MAX = 100;
export const DESCRIPTION_MAX = 500;
export const RULES_MAX = 10;
export const RULE_MAX = 100;
const DAY = 24 * 60 * 60_000;

function modCommunity(name: string, user: User): Community {
  const community = db.communities.get(name) ?? notFound();
  if (!isModerator(community, user)) forbidden(L("이 커뮤니티의 운영진만 볼 수 있어요."));
  return community;
}

export async function handleMod(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  // ── 신고함 ────────────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/reports$/)) && method === "GET") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const resolved = url.searchParams.get("status") === "resolved";
    const items = [...db.reports.values()]
      .filter((r) => r.community === community.name && (resolved ? r.status !== "open" : r.status === "open"))
      .sort((a, b) => (resolved ? (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0) : a.createdAt - b.createdAt))
      .map((r) => reportView(r, user));
    json(res, 200, { items });
    return true;
  }

  if ((m = path.match(/^\/api\/reports\/([a-z0-9]+)\/resolve$/)) && method === "POST") {
    const user = requireUser(req);
    const report = db.reports.get(m[1]) ?? notFound();
    const community = modCommunity(report.community, user);
    const action = str((await readJson(req)).action);
    if (action !== "approve" && action !== "remove") badField("action", L("approve 또는 remove 여야 해요."));
    if (report.status !== "open") conflict("already_resolved", L("이미 처리된 신고예요."));

    const now = Date.now();
    if (action === "remove") {
      if (report.targetType === "post") {
        const post = db.posts.get(report.targetId)!;
        if (!post.deleted && !post.removed) {
          post.removed = true;
          post.pinned = false;
          notify({
            userId: post.authorId, type: "mod_removed", actorId: null, community: community.name,
            postId: post.id, commentId: null, text: post.title,
          });
        }
      } else {
        const comment = db.comments.get(report.targetId)!;
        if (!comment.deleted && !comment.removed) {
          comment.removed = true;
          notify({
            userId: comment.authorId, type: "mod_removed", actorId: null, community: community.name,
            postId: comment.postId, commentId: comment.id, text: comment.body,
          });
        }
      }
    }
    // 같은 대상에 들어온 다른 신고도 함께 처리한다.
    for (const r of db.reports.values()) {
      if (r.status === "open" && r.targetType === report.targetType && r.targetId === report.targetId) {
        r.status = action === "remove" ? "removed" : "approved";
        r.resolvedBy = user.id;
        r.resolvedAt = now;
      }
    }
    json(res, 200, { report: reportView(report, user), community: communityView(community, user) });
    return true;
  }

  // ── 활동 정지 ──────────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/bans$/))) {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);

    if (method === "GET") {
      const now = Date.now();
      const items = [...db.bans.values()]
        .filter((b) => b.community === community.name && activeBan(community.name, b.userId, now))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(banView);
      json(res, 200, { items });
      return true;
    }

    if (method === "POST") {
      const body = await readJson(req);
      const name = str(body.username).trim().replace(/^u\//, "");
      const days = body.days;
      const reason = str(body.reason).trim();
      const fields: Record<string, string> = {};
      const target = name ? findUserByName(name) : undefined;
      if (!name) fields.username = L("아이디를 입력해 주세요.");
      else if (!target) fields.username = L("없는 사용자예요.");
      else if (target.id === user.id) fields.username = L("나 자신은 정지할 수 없어요.");
      else if (community.moderatorIds.includes(target.id)) fields.username = L("운영진은 정지할 수 없어요.");
      else if (activeBan(community.name, target.id)) fields.username = L("이미 활동 정지된 사용자예요.");
      if (typeof days !== "number" || !(BAN_DAYS as readonly number[]).includes(days)) fields.days = L("정지 기간을 골라 주세요.");
      if (!reason) fields.reason = L("정지 이유를 적어 주세요.");
      else if (charCount(reason) > BAN_REASON_MAX) fields.reason = L("이유는 {n}자까지 쓸 수 있어요.", { n: BAN_REASON_MAX });
      invalid(fields);

      const now = Date.now();
      const ban = {
        community: community.name,
        userId: target!.id,
        reason,
        until: days === 0 ? null : now + (days as number) * DAY,
        byId: user.id,
        createdAt: now,
      };
      db.bans.set(`${community.name}|${target!.id}`, ban);
      notify({
        userId: target!.id, type: "banned", actorId: null, community: community.name, postId: null, commentId: null,
        text: reason,
      });
      json(res, 201, { ban: banView(ban) });
      return true;
    }
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/bans\/([A-Za-z0-9_]+)$/)) && method === "DELETE") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const target = findUserByName(m[2]) ?? notFound();
    if (!activeBan(community.name, target.id)) notFound();
    db.bans.delete(`${community.name}|${target.id}`);
    notify({
      userId: target.id, type: "unbanned", actorId: null, community: community.name, postId: null, commentId: null,
      text: "",
    });
    json(res, 200, { ok: true });
    return true;
  }

  // ── 커뮤니티 설정 ──────────────────────────────────────
  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)$/)) && method === "PATCH") {
    const user = requireUser(req);
    const community = modCommunity(m[1], user);
    const body = await readJson(req);
    const fields: Record<string, string> = {};

    const description = str(body.description).trim();
    if (!description) fields.description = L("소개를 입력해 주세요.");
    else if (charCount(description) > DESCRIPTION_MAX) fields.description = L("소개는 {n}자까지 쓸 수 있어요.", { n: DESCRIPTION_MAX });

    const rawRules = Array.isArray(body.rules) ? body.rules : [];
    const rules = rawRules.map((r) => (typeof r === "string" ? r.trim() : ""));
    if (rules.length > RULES_MAX) fields.rules = L("규칙은 {n}개까지 만들 수 있어요.", { n: RULES_MAX });
    else {
      const empty = rules.findIndex((r) => !r);
      const long = rules.findIndex((r) => charCount(r) > RULE_MAX);
      if (empty >= 0) fields.rules = L("{n}번 규칙이 비어 있어요.", { n: empty + 1 });
      else if (long >= 0) fields.rules = L("{n}번 규칙이 너무 길어요. {n2}자까지 쓸 수 있어요.", { n: long + 1, n2: RULE_MAX });
    }

    const color = str(body.color);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fields.color = L("#rrggbb 형식의 색을 골라 주세요.");

    const image = (key: "icon" | "banner", minWidth: number, minHeight: number): string | null => {
      if (body[key] === null) return null;
      if (typeof body[key] !== "string") return community[key];
      const value = body[key] as string;
      if (value === community[key]) return value; // 이미 쓰고 있는 이미지 주소 그대로
      const upload = ownUpload(value, user);
      if (!upload) fields[key] = L("올린 이미지를 찾을 수 없어요. 다시 올려 주세요.");
      else if (upload.width < minWidth || upload.height < minHeight) fields[key] = L("{minWidth}×{minHeight}px 이상인 이미지를 올려 주세요.", { minWidth, minHeight });
      else return uploadUrl(upload.id);
      return community[key];
    };
    const icon = image("icon", 64, 64);
    const banner = image("banner", 600, 100);
    const access = body.access === undefined ? community.access : (str(body.access) as CommunityAccess);
    if (!(COMMUNITY_ACCESS as readonly string[]).includes(access)) fields.access = L("public, restricted, private 중 하나여야 해요.");
    if (body.mature !== undefined && typeof body.mature !== "boolean") fields.mature = L("true 또는 false 여야 해요.");
    invalid(fields);

    // 규칙이 바뀌면 열린 신고가 가리키는 규칙 번호가 어긋날 수 있다. 신고에는 번호만 있으니 범위만 지킨다.
    for (const r of db.reports.values()) {
      if (r.community === community.name && r.ruleIndex !== null && r.ruleIndex >= rules.length) r.ruleIndex = null;
    }
    community.description = description;
    community.rules = rules;
    community.requireFlair = typeof body.requireFlair === "boolean" ? body.requireFlair : community.requireFlair;
    community.color = color.toLowerCase();
    community.icon = icon;
    community.banner = banner;
    const wasPrivate = community.access === "private";
    community.access = access;
    if (typeof body.mature === "boolean") community.mature = body.mature;
    const approved = wasPrivate && access !== "private" ? openUp(community, user) : 0;
    json(res, 200, { community: communityView(community, user), approved });
    return true;
  }

  return false;
}
