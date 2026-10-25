import { requireUser } from "../auth";
import { L } from "../i18n";
import { HttpError, charCount, forbidden, invalid, json, notFound, readJson, str, type Req, type Res } from "../http";
import { db, nextDraftId } from "../store";
import type { Draft, User } from "../types";
import { ownUpload, uploadUrl } from "./media";

/**
 * 임시 저장. 글쓰기 화면의 "임시 저장" · "임시 저장함" 이 쓴다. 자기 것만 보고 고칠 수 있다.
 *   GET    /api/drafts           내 임시 저장 (최근 고친 순)
 *   POST   /api/drafts           새로 저장 → 201 { draft }
 *   PUT    /api/drafts/:id       고쳐 저장
 *   DELETE /api/drafts/:id
 * 글로 올리면(POST /api/posts 에 draftId) 서버가 그 임시 저장을 지운다.
 * 제목 · 커뮤니티가 비어 있어도 저장할 수 있다 (쓰다 만 글이니까). 단 모두 비어 있으면 저장하지 않는다.
 */

const DRAFTS_MAX = 20;
const TITLE_MAX = 300;
const BODY_MAX = 10_000;

export async function handleDrafts(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  if (path === "/api/drafts" && method === "GET") {
    const user = requireUser(req);
    json(res, 200, { items: mine(user).map(draftView) });
    return true;
  }

  if (path === "/api/drafts" && method === "POST") {
    const user = requireUser(req);
    if (mine(user).length >= DRAFTS_MAX) {
      throw new HttpError(409, { error: "draft_limit", message: L("임시 저장은 {n}개까지예요. 안 쓰는 것을 지워 주세요.", { n: DRAFTS_MAX }) });
    }
    const fields = parse(await readJson(req), user);
    const draft: Draft = { id: nextDraftId(), userId: user.id, ...fields, updatedAt: Date.now() };
    db.drafts.set(draft.id, draft);
    json(res, 201, { draft: draftView(draft) });
    return true;
  }

  if ((m = path.match(/^\/api\/drafts\/([a-z0-9]+)$/))) {
    const user = requireUser(req);
    const draft = db.drafts.get(m[1]) ?? notFound();
    if (draft.userId !== user.id) forbidden(L("내 임시 저장만 열 수 있어요."));
    if (method === "PUT") {
      Object.assign(draft, parse(await readJson(req), user), { updatedAt: Date.now() });
      json(res, 200, { draft: draftView(draft) });
      return true;
    }
    if (method === "DELETE") {
      db.drafts.delete(draft.id);
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

function mine(user: User): Draft[] {
  return [...db.drafts.values()].filter((d) => d.userId === user.id).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 올린 파일 중 내 것만 남긴다 (지워졌거나 남의 파일이면 빼고 저장). */
function parse(body: Record<string, unknown>, user: User): Omit<Draft, "id" | "userId" | "updatedAt"> {
  const title = str(body.title).trim();
  const text = str(body.body).replace(/\s+$/, "");
  const fields: Record<string, string> = {};
  if (charCount(title) > TITLE_MAX) fields.title = L("제목은 300자까지 쓸 수 있어요.");
  if (charCount(text) > BODY_MAX) fields.body = L("본문은 10,000자까지 쓸 수 있어요.");
  const community = str(body.community);
  const images = (Array.isArray(body.images) ? body.images : [])
    .slice(0, 8)
    .map((raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}))
    .filter((img) => ownUpload(str(img.upload), user))
    .map((img) => ({ upload: str(img.upload), alt: str(img.alt).slice(0, 200), caption: str(img.caption).slice(0, 200) }));
  const video = ownUpload(str(body.video), user, "video") ? str(body.video) : null;
  const draft = {
    community: db.communities.has(community) ? community : null,
    title,
    body: text,
    url: str(body.url).trim().slice(0, 2000),
    flair: str(body.flair) || null,
    spoiler: body.spoiler === true,
    images,
    video,
  };
  if (!draft.title && !draft.body && !draft.url && draft.images.length === 0 && !draft.video) {
    fields.title = L("저장할 내용이 없어요. 제목이나 본문을 써 주세요.");
  }
  invalid(fields);
  return draft;
}

function draftView(d: Draft) {
  return {
    id: d.id,
    community: d.community,
    title: d.title,
    body: d.body,
    url: d.url,
    flair: d.flair,
    spoiler: d.spoiler,
    images: d.images.map((img) => {
      const up = db.uploads.get(img.upload)!;
      return { ...img, src: uploadUrl(img.upload), width: up.width, height: up.height };
    }),
    video: d.video
      ? (() => {
          const up = db.uploads.get(d.video)!;
          return { upload: d.video, src: uploadUrl(d.video), width: up.width, height: up.height, duration: up.duration };
        })()
      : null,
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}
