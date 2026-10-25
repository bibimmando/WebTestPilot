import { currentUser, endSession, requireUser, startSession } from "./auth";
import { handleDrafts } from "./features/drafts";
import { applySeed, currentGameSeed, handleGames } from "./features/games";
import { handleMembership } from "./features/membership";
import { handleMedia, ownUpload, uploadUrl } from "./features/media";
import { DESCRIPTION_MAX, handleMod } from "./features/mod";
import { handleSocial } from "./features/social";
import { lc } from "./content";
import { L, currentLang, langOf, withLang } from "./i18n";
import { INTEREST_IDS } from "./interests";
import { notify } from "./notify";
import { enabledIds, groundTruth, isOn } from "./bugs";
import { HttpError, charCount, conflict, forbidden, intParam, invalid, json, notFound, readJson, str, type Req, type Res } from "./http";
import { challengeView, completeOtpSignup, startOtp, usernameError, verifyOtp, type Channel } from "./otp";
import { COMMENT_SORTS, POST_SORTS, TOP_WINDOWS, sortComments, sortPosts, type CommentSort, type PostSort } from "./ranking";
import { ensureSeeded, resetAll } from "./seed";
import {
  DEFAULT_PREFS,
  activeBan,
  castVote,
  db,
  findUserByContact,
  findUserByName,
  hashPassword,
  membersOf,
  nextCommentId,
  nextPostId,
  nextUserId,
  scoreOf,
  verifyPassword,
} from "./store";
import { COMMUNITY_ACCESS, type Comment, type Community, type CommunityAccess, type Post, type PostImage, type User } from "./types";
import { canViewCommunity, canViewPost, commentView, communityView, isModerator, karmaOf, meView, postView, userView } from "./views";

/**
 * /api/* · /gt.json · /_reset 을 처리한다. 처리했으면 true, 화면 요청이면 false.
 *
 * 오류 응답 모양:
 *   400 { error: "validation", fields: { title: "..." } }
 *   401 { error: "auth_required" }   403 { error: "forbidden" }
 *   404 { error: "not_found" }       409 { error: "conflict" | "pin_limit" | ... }
 */
export async function handleApi(req: Req, res: Res): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://agora.local");
  const path = url.pathname;
  if (!path.startsWith("/api/") && !path.startsWith("/media/u/") && path !== "/gt.json" && path !== "/_reset") return false;

  ensureSeeded();
  try {
    // 이 요청이 끝날 때까지 오류 문구를 화면 언어로 돌려준다.
    await withLang(langOf(req.headers["x-agora-lang"]), () => route(req, res, url));
  } catch (err) {
    if (err instanceof HttpError) json(res, err.status, err.body);
    else throw err;
  }
  return true;
}

function getCommunity(name: string): Community {
  return db.communities.get(name) ?? notFound();
}
function getPost(id: string): Post {
  return db.posts.get(id) ?? notFound();
}
function getComment(id: string): Comment {
  return db.comments.get(id) ?? notFound();
}
/** 비공개 커뮤니티의 글은 회원 · 운영진에게만 */
function viewablePost(id: string, viewer: User | null): Post {
  const post = getPost(id);
  if (!canViewPost(post, viewer)) forbidden(L("비공개 커뮤니티의 글이에요. 회원만 볼 수 있어요."));
  return post;
}
function viewableComment(id: string, viewer: User | null): Comment {
  const comment = getComment(id);
  viewablePost(comment.postId, viewer);
  return comment;
}
function voteDir(value: unknown): 1 | 0 | -1 {
  if (value === 1 || value === 0 || value === -1) return value;
  throw new HttpError(400, { error: "validation", fields: { dir: L("1, 0, -1 중 하나여야 해요.") } });
}

const URL_PATTERN = /^https?:\/\/[^\s/]+\.[^\s]+$/;
/** 결함 V2: 영어 · 숫자 · 일부 기호만 받는 주소 검사 (한글이 든 주소를 거부한다) */
const ASCII_URL_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?(?:[/?#][A-Za-z0-9\-._~%!$&'()*+,;=:@/?#]*)?$/;
export const IMAGES_MAX = 8;
/** 인기 피드에 오르는 최소 점수 */
const POPULAR_MIN_SCORE = 100;
const ALT_MAX = 200;
const CAPTION_MAX = 200;

/** 활동 정지 중이면 글·댓글을 쓸 수 없다. */
function assertNotBanned(community: Community, user: User): void {
  const ban = activeBan(community.name, user.id);
  if (!ban) return;
  const until = ban.until === null ? L("영구 정지") : L("{date} 까지", { date: new Date(ban.until).toLocaleDateString(currentLang() === "en" ? "en-US" : "ko-KR") });
  forbidden(L("c/{c} 에서 활동이 정지돼 글과 댓글을 쓸 수 없어요 ({until}). 이유: {reason}", { c: community.name, until, reason: ban.reason }));
}

/**
 * 글에 붙일 이미지. [{ upload, alt, caption }] 모양을 받아 검사한다.
 * 설명(alt)을 비우면 제목으로 채운다 — 화면 낭독기가 "이미지" 라고만 읽지 않게.
 */
function parseImages(raw: unknown, user: User, title: string, fields: Record<string, string>): PostImage[] {
  if (!Array.isArray(raw)) {
    fields.images = L("이미지를 한 장 이상 올려 주세요.");
    return [];
  }
  if (raw.length === 0) fields.images = L("이미지를 한 장 이상 올려 주세요.");
  else if (raw.length > IMAGES_MAX) fields.images = L("이미지는 {n}장까지 올릴 수 있어요.", { n: IMAGES_MAX });
  const images: PostImage[] = [];
  raw.slice(0, IMAGES_MAX).forEach((item, i) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const upload = ownUpload(str(entry.upload), user);
    const alt = str(entry.alt).trim();
    const caption = str(entry.caption).trim();
    if (!upload) fields.images = L("{n}번째 이미지를 찾을 수 없어요. 다시 올려 주세요.", { n: i + 1 });
    else if (charCount(alt) > ALT_MAX) fields.images = L("{n}번째 이미지 설명은 {n2}자까지 쓸 수 있어요.", { n: i + 1, n2: ALT_MAX });
    else if (charCount(caption) > CAPTION_MAX) fields.images = L("{n}번째 이미지 캡션은 {n2}자까지 쓸 수 있어요.", { n: i + 1, n2: CAPTION_MAX });
    else {
      images.push({
        src: uploadUrl(upload.id),
        width: upload.width,
        height: upload.height,
        alt: alt || (raw.length > 1 ? `${title} (${i + 1}/${raw.length})` : title),
        caption,
      });
    }
  });
  return images;
}

export const COMMUNITY_NAME_PATTERN = /^[a-z0-9_]{3,21}$/;
const COMMUNITY_TOPICS_MAX = 3;
const COMMUNITY_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#0f766e", "#b45309"];

/**
 * 새 커뮤니티. POST /api/communities  { name, description, topics, access, mature }
 *   name        영문 소문자 · 숫자 · 밑줄 3~21자. 대문자는 소문자로 바꾼다. 이미 있는 이름은 안 된다.
 *   description 필수, 500자까지
 *   topics      관심 항목 id 1~3개
 *   access      public | restricted | private
 * 만든 사람이 첫 운영진이자 회원이 된다.
 */
function createCommunity(user: User, body: Record<string, unknown>): Community {
  const name = str(body.name).trim().toLowerCase();
  const description = str(body.description).trim();
  const rawTopics = Array.isArray(body.topics) ? body.topics.map(str) : null;
  const topics = [...new Set(rawTopics ?? [])];
  const access = str(body.access) as CommunityAccess;

  const fields: Record<string, string> = {};
  if (!name) fields.name = L("커뮤니티 이름을 입력해 주세요.");
  else if (!COMMUNITY_NAME_PATTERN.test(name)) fields.name = L("이름은 영문 소문자 · 숫자 · 밑줄로 3~21자여야 해요.");
  else if (db.communities.has(name)) fields.name = L("c/{name} 은(는) 이미 있어요. 다른 이름을 골라 주세요.", { name });
  if (!description) fields.description = L("커뮤니티 소개를 입력해 주세요.");
  else if (charCount(description) > DESCRIPTION_MAX) fields.description = L("소개는 {n}자까지 쓸 수 있어요.", { n: DESCRIPTION_MAX });
  if (!rawTopics || topics.length === 0) fields.topics = L("주제를 1개 이상 골라 주세요.");
  else if (topics.length > COMMUNITY_TOPICS_MAX) fields.topics = L("주제는 {n}개까지 고를 수 있어요.", { n: COMMUNITY_TOPICS_MAX });
  else if (topics.some((t) => !INTEREST_IDS.has(t))) fields.topics = L("없는 주제예요.");
  if (!(COMMUNITY_ACCESS as readonly string[]).includes(access)) fields.access = L("public, restricted, private 중 하나여야 해요.");
  if (body.mature !== undefined && typeof body.mature !== "boolean") fields.mature = L("true 또는 false 여야 해요.");
  invalid(fields);

  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const community: Community = {
    name,
    title: name,
    description,
    rules: [],
    flairs: [],
    requireFlair: false,
    access,
    mature: body.mature === true,
    moderatorIds: [user.id],
    icon: null,
    banner: null,
    color: COMMUNITY_COLORS[h % COMMUNITY_COLORS.length],
    topics,
    baseMembers: 0,
    createdAt: Date.now(),
  };
  db.communities.set(name, community);
  membersOf(name).add(user.id);
  return community;
}

async function route(req: Req, res: Res, url: URL): Promise<void> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  const viewer = currentUser(req);
  let m: RegExpMatchArray | null;

  // ── 벤치마크용 ──────────────────────────────────────────
  if (path === "/_reset" && method === "POST") {
    // { "seed": 42 } 를 같이 보내면 게임 판을 고정한다 (features/games.ts applySeed)
    const problem = applySeed(await readJson(req));
    if (problem) return json(res, 400, { error: "validation", fields: { seed: problem } });
    resetAll();
    return json(res, 200, { ok: true, seed: currentGameSeed() });
  }
  if (path === "/gt.json" && method === "GET") return json(res, 200, groundTruth());
  if (path === "/api/bugs" && method === "GET") return json(res, 200, { enabled: enabledIds() });
  if (path === "/api/health" && method === "GET") return json(res, 200, { status: "ok" });

  if (await handleMedia(req, res, url)) return;
  if (await handleSocial(req, res, url)) return;
  if (await handleMod(req, res, url)) return;
  if (await handleGames(req, res, url)) return;
  if (await handleDrafts(req, res, url)) return;
  if (await handleMembership(req, res, url)) return;

  // ── 로그인 ────────────────────────────────────────────
  if (path === "/api/session" && method === "GET") {
    return json(res, 200, { user: viewer ? meView(viewer) : null });
  }

  if (path === "/api/auth/signup" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.username).trim();
    const password = str(body.password);
    const confirm = str(body.passwordConfirm);
    const fields: Record<string, string> = {};
    const nameError = usernameError(name);
    if (nameError) fields.username = nameError;
    if (charCount(password) < 8) fields.password = L("비밀번호는 8자 이상이어야 해요.");
    if (password !== confirm) fields.passwordConfirm = L("비밀번호가 서로 달라요.");
    invalid(fields);
    const id = nextUserId();
    const user: User = {
      id,
      name,
      ...hashPassword(password),
      phone: null,
      email: null,
      createdAt: Date.now(),
      bio: "",
      avatar: null,
      prefs: { ...DEFAULT_PREFS },
      gender: null,
      interests: [],
    };
    db.users.set(id, user);
    startSession(res, id);
    return json(res, 201, { user: meView(user) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readJson(req);
    // 아이디 또는 이메일로 로그인한다.
    const identifier = str(body.username).trim();
    const user = identifier.includes("@")
      ? findUserByContact("email", identifier.toLowerCase())
      : findUserByName(identifier);
    if (!user || !verifyPassword(user, str(body.password))) {
      throw new HttpError(401, { error: "invalid_credentials", message: L("아이디 또는 비밀번호가 맞지 않아요.") });
    }
    startSession(res, user.id);
    return json(res, 200, { user: meView(user) });
  }

  // ── 전화번호·이메일로 계속하기 ─────────────────────────────
  if (path === "/api/auth/otp/start" && method === "POST") {
    const body = await readJson(req);
    const channel = str(body.channel);
    if (channel !== "phone" && channel !== "email") {
      throw new HttpError(400, { error: "validation", fields: { channel: L("phone 또는 email 이어야 해요.") } });
    }
    return json(res, 201, challengeView(startOtp(channel as Channel, str(body.target))));
  }

  if (path === "/api/auth/otp/verify" && method === "POST") {
    const body = await readJson(req);
    const { challenge, user } = verifyOtp(str(body.challengeId), str(body.code).trim());
    if (user) {
      startSession(res, user.id);
      return json(res, 200, { status: "logged_in", user: meView(user) });
    }
    return json(res, 200, { status: "needs_username", channel: challenge.channel });
  }

  if (path === "/api/auth/otp/complete" && method === "POST") {
    const body = await readJson(req);
    const user = completeOtpSignup(str(body.challengeId), str(body.username));
    startSession(res, user.id);
    return json(res, 201, { user: meView(user) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    endSession(req, res);
    return json(res, 200, { ok: true });
  }

  // ── 커뮤니티 ──────────────────────────────────────────
  if (path === "/api/communities" && method === "GET") {
    const list = [...db.communities.values()].map((c) => communityView(c, viewer));
    list.sort((a, b) => b.members - a.members);
    return json(res, 200, { items: list });
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)$/)) && method === "GET") {
    return json(res, 200, { community: communityView(getCommunity(m[1]), viewer) });
  }

  if (path === "/api/communities" && method === "POST") {
    const user = requireUser(req);
    const community = createCommunity(user, await readJson(req));
    return json(res, 201, { community: communityView(community, user) });
  }

  if ((m = path.match(/^\/api\/communities\/([a-z0-9_]+)\/join$/)) && method === "POST") {
    const user = requireUser(req);
    const community = getCommunity(m[1]);
    const members = membersOf(community.name);
    if (community.access === "private" && !members.has(user.id) && !isModerator(community, user)) {
      forbidden(L("비공개 커뮤니티는 가입 요청을 보내거나 초대를 받아야 들어갈 수 있어요."));
    }
    if (members.has(user.id)) members.delete(user.id);
    else members.add(user.id);
    return json(res, 200, { community: communityView(community, user) });
  }

  // ── 글 목록 ────────────────────────────────────────────
  if (path === "/api/posts" && method === "GET") {
    return json(res, 200, listPosts(url, viewer));
  }

  // 최근 본 글처럼 ID 로 여러 글을 한꺼번에 받는다. 넘긴 순서대로, 지워졌거나 볼 수 없는 글은 뺀다.
  if (path === "/api/posts/batch" && method === "GET") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
    const hidden = viewer ? db.hides.get(viewer.id) : undefined;
    const items = ids
      .map((id) => db.posts.get(id))
      .filter((p): p is Post => !!p && !p.deleted && !p.removed && !hidden?.has(p.id) && canViewPost(p, viewer))
      .map((p) => postView(p, viewer));
    return json(res, 200, { items });
  }

  // ── 글 쓰기 ────────────────────────────────────────────
  if (path === "/api/posts" && method === "POST") {
    const user = requireUser(req);
    const body = await readJson(req);
    const community = db.communities.get(str(body.community));
    const title = str(body.title).trim();
    const text = str(body.body).replace(/\s+$/, "");
    const kind = str(body.kind) || "text";
    const spoiler = body.spoiler === true;
    const link = kind === "link" ? str(body.url).trim() : "";
    const flair = str(body.flair) || null;

    const fields: Record<string, string> = {};
    if (!community) fields.community = L("커뮤니티를 골라 주세요.");
    if (!title) fields.title = L("제목을 입력해 주세요.");
    else if (charCount(title) > 300) fields.title = L("제목은 300자까지 쓸 수 있어요.");
    if (charCount(text) > 10_000) fields.body = L("본문은 10,000자까지 쓸 수 있어요.");
    if (kind !== "text" && kind !== "link" && kind !== "image" && kind !== "video") fields.kind = L("text, link, image, video 중 하나여야 해요.");
    if (body.spoiler !== undefined && typeof body.spoiler !== "boolean") fields.spoiler = L("true 또는 false 여야 해요.");
    if (kind === "link" && !link) fields.url = L("링크 주소를 넣어 주세요.");
    else if (link && !(isOn("V2") ? ASCII_URL_PATTERN : URL_PATTERN).test(link)) fields.url = L("http:// 또는 https:// 로 시작하는 주소를 넣어 주세요.");
    const images = kind === "image" ? parseImages(body.images, user, title, fields) : [];
    const videoUpload = kind === "video" ? ownUpload(str(body.video), user, "video") : null;
    if (kind === "video" && !videoUpload) fields.video = L("동영상을 찾을 수 없어요. 다시 올려 주세요.");
    if (community) {
      if (flair && !community.flairs.includes(flair)) fields.flair = L("이 커뮤니티에 없는 말머리예요.");
      if (community.requireFlair && !flair) fields.flair = L("이 커뮤니티는 말머리를 골라야 해요.");
    }
    invalid(fields);
    if (community!.access === "restricted" && !isModerator(community!, user)) {
      forbidden(L("운영진만 글을 쓸 수 있는 커뮤니티예요."));
    }
    if (!canViewCommunity(community!, user)) forbidden(L("비공개 커뮤니티는 회원만 글을 쓸 수 있어요."));
    assertNotBanned(community!, user);

    const id = nextPostId();
    const post: Post = {
      id,
      community: community!.name,
      authorId: user.id,
      title,
      body: text,
      url: link || null,
      images,
      video: videoUpload
        ? { src: uploadUrl(videoUpload.id), width: videoUpload.width, height: videoUpload.height, duration: videoUpload.duration ?? 0 }
        : null,
      spoiler,
      flair,
      createdAt: Date.now(),
      editedAt: null,
      baseScore: 0,
      pinned: false,
      deleted: false,
      removed: false,
    };
    db.posts.set(id, post);
    castVote(user.id, id, 1); // 글쓴이는 자기 글에 자동으로 추천 1표
    // 임시 저장한 글을 올렸으면 그 임시 저장은 지운다.
    const draft = db.drafts.get(str(body.draftId));
    if (draft && draft.userId === user.id) db.drafts.delete(draft.id);
    return json(res, 201, { post: postView(post, user) });
  }

  // ── 글 하나 ────────────────────────────────────────────
  if ((m = path.match(/^\/api\/posts\/([a-z0-9]+)$/))) {
    const post = viewablePost(m[1], viewer);
    if (method === "GET") return json(res, 200, { post: postView(post, viewer) });

    const user = requireUser(req);
    const community = getCommunity(post.community);
    if (post.deleted || post.removed) conflict("gone", L("이미 삭제된 글이에요."));

    if (method === "PATCH") {
      if (user.id !== post.authorId) forbidden(L("내가 쓴 글만 고칠 수 있어요."));
      const body = await readJson(req);
      const text = str(body.body).replace(/\s+$/, "");
      invalid(charCount(text) > 10_000 ? { body: L("본문은 10,000자까지 쓸 수 있어요.") } : {});
      post.body = text;
      post.editedAt = Date.now();
      return json(res, 200, { post: postView(post, user) });
    }

    if (method === "DELETE") {
      const isAuthor = user.id === post.authorId;
      if (!isAuthor && !isModerator(community, user)) forbidden(L("이 글을 지울 권한이 없어요."));
      if (isAuthor) post.deleted = true;
      else {
        post.removed = true;
        notify({
          userId: post.authorId, type: "mod_removed", actorId: null, community: community.name,
          postId: post.id, commentId: null, text: post.title,
        });
      }
      post.pinned = false;
      return json(res, 200, { post: postView(post, user) });
    }
  }

  if ((m = path.match(/^\/api\/posts\/([a-z0-9]+)\/vote$/)) && method === "POST") {
    const user = requireUser(req);
    const post = viewablePost(m[1], user);
    if (post.deleted || post.removed) conflict("gone", L("삭제된 글에는 투표할 수 없어요."));
    castVote(user.id, post.id, voteDir((await readJson(req)).dir));
    return json(res, 200, { post: postView(post, user) });
  }

  if ((m = path.match(/^\/api\/posts\/([a-z0-9]+)\/pin$/)) && method === "POST") {
    const user = requireUser(req);
    const post = getPost(m[1]);
    const community = getCommunity(post.community);
    if (!isModerator(community, user)) forbidden(L("운영진만 글을 고정할 수 있어요."));
    if (post.deleted || post.removed) conflict("gone", L("삭제된 글은 고정할 수 없어요."));
    if (!post.pinned) {
      const pinnedCount = [...db.posts.values()].filter((p) => p.community === community.name && p.pinned).length;
      if (pinnedCount >= 2) conflict("pin_limit", L("고정 글은 커뮤니티마다 2개까지예요."));
    }
    post.pinned = !post.pinned;
    return json(res, 200, { post: postView(post, user) });
  }

  // ── 댓글 ──────────────────────────────────────────────
  if ((m = path.match(/^\/api\/posts\/([a-z0-9]+)\/comments$/))) {
    const post = viewablePost(m[1], viewer);

    if (method === "GET") {
      const raw = url.searchParams.get("sort");
      const sort: CommentSort = (COMMENT_SORTS as readonly string[]).includes(raw ?? "") ? (raw as CommentSort) : "best";
      return json(res, 200, { sort, items: commentTree(post.id, sort, viewer) });
    }

    if (method === "POST") {
      const user = requireUser(req);
      if (post.deleted || post.removed) conflict("gone", L("삭제된 글에는 댓글을 달 수 없어요."));
      const body = await readJson(req);
      const text = str(body.body).trim();
      const parentId = str(body.parentId) || null;
      // 결함 F4: 정지 검사를 새 댓글에만 하고 답글(parentId 있음)에는 하지 않는다
      if (!(isOn("F4") && parentId)) assertNotBanned(getCommunity(post.community), user);
      const fields: Record<string, string> = {};
      if (!text) fields.body = L("댓글 내용을 입력해 주세요.");
      else if (charCount(text) > 10_000) fields.body = L("댓글은 10,000자까지 쓸 수 있어요.");
      invalid(fields);
      const parent = parentId ? db.comments.get(parentId) : undefined;
      if (parentId) {
        if (!parent || parent.postId !== post.id) notFound();
        if (parent!.deleted || parent!.removed) conflict("gone", L("삭제된 댓글에는 답글을 달 수 없어요."));
      }
      const id = nextCommentId();
      const comment: Comment = {
        id,
        postId: post.id,
        parentId,
        authorId: user.id,
        body: text,
        createdAt: Date.now(),
        editedAt: null,
        baseScore: 0,
        deleted: false,
        removed: false,
      };
      db.comments.set(id, comment);
      castVote(user.id, id, 1);
      notify({
        userId: parent ? parent.authorId : post.authorId,
        type: parent ? "comment_reply" : "post_reply",
        actorId: user.id,
        community: post.community,
        postId: post.id,
        commentId: id,
        text: text,
      });
      return json(res, 201, { comment: { ...commentView(comment, user), children: [] } });
    }
  }

  if ((m = path.match(/^\/api\/comments\/([a-z0-9]+)$/))) {
    const user = requireUser(req);
    const comment = viewableComment(m[1], user);
    if (comment.deleted || comment.removed) conflict("gone", L("이미 삭제된 댓글이에요."));

    if (method === "PATCH") {
      if (user.id !== comment.authorId) forbidden(L("내가 쓴 댓글만 고칠 수 있어요."));
      const text = str((await readJson(req)).body).trim();
      invalid(!text ? { body: L("댓글 내용을 입력해 주세요.") } : charCount(text) > 10_000 ? { body: L("댓글은 10,000자까지 쓸 수 있어요.") } : {});
      comment.body = text;
      comment.editedAt = Date.now();
      return json(res, 200, { comment: commentView(comment, user) });
    }

    if (method === "DELETE") {
      const community = getCommunity(getPost(comment.postId).community);
      const isAuthor = user.id === comment.authorId;
      if (!isAuthor && !isModerator(community, user)) forbidden(L("이 댓글을 지울 권한이 없어요."));
      // 답글이 달려 있을 수 있으니 자리는 남기고 내용만 지운다.
      if (isAuthor) comment.deleted = true;
      else {
        comment.removed = true;
        notify({
          userId: comment.authorId, type: "mod_removed", actorId: null, community: community.name,
          postId: comment.postId, commentId: comment.id, text: comment.body,
        });
      }
      return json(res, 200, { comment: commentView(comment, user) });
    }
  }

  if ((m = path.match(/^\/api\/comments\/([a-z0-9]+)\/vote$/)) && method === "POST") {
    const user = requireUser(req);
    const comment = viewableComment(m[1], user);
    if (comment.deleted || comment.removed) conflict("gone", L("삭제된 댓글에는 투표할 수 없어요."));
    castVote(user.id, comment.id, voteDir((await readJson(req)).dir));
    return json(res, 200, { comment: commentView(comment, user) });
  }

  // ── 사용자 ────────────────────────────────────────────
  if ((m = path.match(/^\/api\/users\/([A-Za-z0-9_]+)$/)) && method === "GET") {
    const user = findUserByName(m[1]) ?? notFound();
    const posts = [...db.posts.values()]
      .filter((p) => p.authorId === user.id && !p.deleted && !p.removed && canViewPost(p, viewer))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((p) => postView(p, viewer));
    const comments = [...db.comments.values()]
      .filter((c) => c.authorId === user.id && !c.deleted && !c.removed && canViewPost(db.posts.get(c.postId)!, viewer))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((c) => {
        const post = db.posts.get(c.postId)!;
        return { ...commentView(c, viewer), postTitle: lc(post.title), community: post.community };
      });
    return json(res, 200, {
      user: userView(user, viewer),
      posts,
      comments,
    });
  }

  // ── 검색 ──────────────────────────────────────────────
  if (path === "/api/search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (charCount(q) < 2) {
      throw new HttpError(400, { error: "validation", fields: { q: L("검색어를 2자 이상 입력해 주세요.") } });
    }
    const needle = q.toLowerCase();
    const hit = (s: string) => s.toLowerCase().includes(needle);
    const posts = sortPosts(
      [...db.posts.values()].filter((p) => !p.deleted && !p.removed && canViewPost(p, viewer) && (hit(p.title) || hit(p.body) || hit(lc(p.title)) || hit(lc(p.body)))),
      "top",
    ).map((p) => postView(p, viewer));
    const communities = [...db.communities.values()]
      .filter((c) => hit(c.name) || hit(c.title) || hit(c.description) || hit(lc(c.title)) || hit(lc(c.description)))
      .map((c) => communityView(c, viewer));
    return json(res, 200, { q, posts, communities });
  }

  // 검색창 자동 완성. 한 글자부터 받고, 앞부분이 맞는 것을 먼저 보여 준다.
  if (path === "/api/search/suggest" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json(res, 200, { q, communities: [], users: [], posts: [] });
    const needle = q.toLowerCase();
    // 0: 앞부분이 맞음, 1: 중간에 들어 있음, -1: 안 맞음
    const rank = (...fields: string[]) => {
      let best = -1;
      for (const f of fields) {
        const i = f.toLowerCase().indexOf(needle);
        if (i === 0) return 0;
        if (i > 0) best = 1;
      }
      return best;
    };
    const communities = [...db.communities.values()]
      .map((c) => ({ v: communityView(c, viewer), r: rank(c.name, c.title, lc(c.title)) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || b.v.members - a.v.members)
      .slice(0, 4)
      .map(({ v }) => ({ name: v.name, title: v.title, icon: v.icon, color: v.color, members: v.members }));
    const users = [...db.users.values()]
      .map((u) => ({ u, r: rank(u.name) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.u.name.localeCompare(b.u.name))
      .slice(0, 3)
      .map(({ u }) => {
        const k = karmaOf(u.id);
        return { name: u.name, avatar: u.avatar, karma: k.post + k.comment };
      });
    const hidden = viewer ? db.hides.get(viewer.id) : undefined;
    const posts = sortPosts(
      [...db.posts.values()].filter((p) => !p.deleted && !p.removed && !hidden?.has(p.id) && canViewPost(p, viewer) && rank(p.title, lc(p.title)) >= 0),
      "top",
    )
      .slice(0, 5)
      .map((p) => {
        const v = postView(p, viewer);
        return { id: v.id, title: v.translated?.title ?? v.title, community: v.community, communityIcon: v.communityIcon, score: v.score, commentCount: v.commentCount, thumbnail: v.images[0]?.src ?? null };
      });
    return json(res, 200, { q, communities, users, posts });
  }

  notFound();
}

/**
 * 글 목록.
 *   feed=home      가입한 커뮤니티 글 (로그인 안 했거나 가입한 곳이 없으면 인기 글)
 *   feed=popular   점수 100 이상, 공지 · 비공개 · 성인용 커뮤니티 제외
 *   feed=all       전체
 *   community=dev  한 커뮤니티 (인기 정렬일 때 고정 글이 맨 위)
 *   sort=hot|new|top, t=hour|day|week|month|year|all (top 일 때), flair=질문
 *   offset, limit  (기본 10, 최대 50)
 */
function listPosts(url: URL, viewer: User | null) {
  const params = url.searchParams;
  const rawSort = params.get("sort");
  const sort: PostSort = (POST_SORTS as readonly string[]).includes(rawSort ?? "") ? (rawSort as PostSort) : "hot";
  const window = TOP_WINDOWS[params.get("t") ?? "day"] ?? TOP_WINDOWS.day;
  const communityName = params.get("community");
  const feed = params.get("feed") ?? "all";
  const flair = params.get("flair");
  const offset = intParam(params.get("offset"), 0, 0, 100_000);
  const limit = intParam(params.get("limit"), 10, 1, 50);
  const now = Date.now();

  const hidden = viewer ? db.hides.get(viewer.id) : undefined;
  let posts = [...db.posts.values()].filter((p) => !p.deleted && !p.removed && !hidden?.has(p.id) && canViewPost(p, viewer));

  if (communityName) {
    if (!canViewCommunity(getCommunity(communityName), viewer)) forbidden(L("비공개 커뮤니티의 글이에요. 회원만 볼 수 있어요."));
    posts = posts.filter((p) => p.community === communityName);
  } else {
    let joined = viewer ? new Set([...db.communities.keys()].filter((name) => db.members.get(name)?.has(viewer.id))) : new Set<string>();
    // 결함 F1: 홈 피드는 로그인할 때 기억한 가입 목록을 다음 로그인까지 계속 쓴다 (탈퇴 · 가입이 반영되지 않음)
    if (isOn("F1") && viewer && feed === "home") joined = db.homeJoined.get(viewer.id) ?? joined;
    // 홈은 가입한 커뮤니티 글. 로그인하지 않았거나 가입한 곳이 없으면 인기 글을 보여 준다.
    const asPopular = feed === "popular" || (feed === "home" && joined.size === 0);
    if (feed === "home" && joined.size > 0) posts = posts.filter((p) => joined.has(p.community));
    if (asPopular) {
      // 인기 피드에는 누구나 글을 쓰는 일반 커뮤니티만 (공지 · 비공개 · 성인용 제외)
      posts = posts.filter((p) => {
        const c = db.communities.get(p.community);
        return scoreOf(p) >= POPULAR_MIN_SCORE && c?.access === "public" && !c.mature;
      });
    }
  }

  if (flair) posts = posts.filter((p) => p.flair === flair);
  if (sort === "top") posts = posts.filter((p) => now - p.createdAt <= window);

  // 커뮤니티 화면의 기본(인기) 정렬에서만 고정 글을 맨 위에 올린다.
  const pinFirst = !!communityName && sort === "hot" && !flair;
  const pinned = pinFirst ? posts.filter((p) => p.pinned).sort((a, b) => b.createdAt - a.createdAt) : [];
  const rest = sortPosts(pinFirst ? posts.filter((p) => !p.pinned) : posts, sort);
  const ordered = [...pinned, ...rest];

  return {
    items: ordered.slice(offset, offset + limit).map((p) => postView(p, viewer)),
    hasMore: offset + limit < ordered.length,
    nextOffset: offset + limit,
    total: ordered.length,
  };
}

type CommentNode = ReturnType<typeof commentView> & { children: CommentNode[] };

function commentTree(postId: string, sort: CommentSort, viewer: User | null): CommentNode[] {
  const all = [...db.comments.values()].filter((c) => c.postId === postId);
  const byParent = new Map<string | null, Comment[]>();
  for (const c of all) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  const build = (parentId: string | null): CommentNode[] =>
    sortComments(byParent.get(parentId) ?? [], sort).map((c) => ({ ...commentView(c, viewer), children: build(c.id) }));
  return build(null);
}

export type { CommentNode };
