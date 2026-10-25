import { requireUser } from "../auth";
import { L } from "../i18n";
import { HttpError, badField, json, notFound, readJson, str, type Req, type Res } from "../http";
import { db, nextUploadId } from "../store";
import type { Upload, User } from "../types";

/**
 * 이미지 · 동영상 업로드.
 *   POST /api/uploads  { dataUrl: "data:image/png;base64,..." }  → { upload: { id, url, width, height } }
 *   POST /api/uploads/video?width=&height=&duration=   본문은 파일 그대로 (content-type: video/mp4 | video/webm)
 *   GET  /media/u/:id  올린 파일. 동영상을 앞뒤로 옮겨 볼 수 있게 Range 요청을 받는다.
 * 이미지 크기는 브라우저가 보낸 값을 믿지 않고 파일 머리에서 직접 읽는다.
 * 동영상은 파일 머리로 형식만 확인하고, 가로 · 세로 · 길이는 브라우저가 읽은 값을 범위 안에서만 받는다
 * (화면 배치에만 쓰는 값이라 컨테이너를 직접 해석하지 않는다).
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "MP4", "video/webm": "WEBM" };
const MAX_SIDE = 8000;
const TYPES: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP", "image/gif": "GIF" };
const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function handleMedia(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  if (path === "/api/uploads" && method === "POST") {
    const user = requireUser(req);
    // base64 는 원본보다 4/3 배 크다.
    const body = await readJson(req, Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 1024);
    const upload = createUpload(user, str(body.dataUrl));
    json(res, 201, { upload: uploadView(upload) });
    return true;
  }

  if (path === "/api/uploads/video" && method === "POST") {
    const user = requireUser(req);
    const upload = await createVideoUpload(req, user, url.searchParams);
    json(res, 201, { upload: uploadView(upload) });
    return true;
  }

  if ((m = path.match(/^\/media\/u\/([a-z0-9]+)$/)) && method === "GET") {
    const upload = db.uploads.get(m[1]) ?? notFound();
    const total = upload.data.length;
    res.setHeader("content-type", upload.mime);
    res.setHeader("cache-control", "public, max-age=86400, immutable");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("accept-ranges", "bytes");
    // 동영상 재생기는 필요한 부분만 잘라 달라고 한다 (bytes=시작-끝).
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : total - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : total - 1;
      start = Math.max(0, start);
      end = Math.min(end, total - 1);
      if (start > end || start >= total) {
        res.statusCode = 416;
        res.setHeader("content-range", `bytes */${total}`);
        res.end();
        return true;
      }
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${start}-${end}/${total}`);
      res.setHeader("content-length", String(end - start + 1));
      res.end(upload.data.subarray(start, end + 1));
      return true;
    }
    res.statusCode = 200;
    res.setHeader("content-length", String(total));
    res.end(upload.data);
    return true;
  }

  return false;
}

function createUpload(user: User, dataUrl: string): Upload {
  const match = dataUrl.match(DATA_URL) ?? badField("file", L("이미지 파일을 골라 주세요."));
  const mime = match[1];
  if (!TYPES[mime]) badField("file", L("JPG, PNG, WEBP, GIF 파일만 올릴 수 있어요."));
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0) badField("file", L("빈 파일이에요."));
  if (data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, { error: "validation", fields: { file: L("5MB 이하의 파일만 올릴 수 있어요.") } });

  const { width, height } = imageSize(data, mime) ?? badField("file", L("{n} 파일이 아니거나 손상된 파일이에요.", { n: TYPES[mime] }));
  if (width > MAX_SIDE || height > MAX_SIDE) badField("file", L("가로·세로 {n}px 이하의 이미지만 올릴 수 있어요.", { n: MAX_SIDE }));

  const id = nextUploadId();
  const upload: Upload = { id, ownerId: user.id, mime, data, width, height, duration: null, createdAt: Date.now() };
  db.uploads.set(id, upload);
  return upload;
}

/** 동영상 파일을 그대로 받는다 (base64 로 부풀리지 않게). */
async function createVideoUpload(req: Req, user: User, params: URLSearchParams): Promise<Upload> {
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!VIDEO_TYPES[mime]) badField("file", L("MP4, WEBM 동영상만 올릴 수 있어요."));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_VIDEO_BYTES) throw new HttpError(413, { error: "validation", fields: { file: L("{n}MB 이하의 동영상만 올릴 수 있어요.", { n: MAX_VIDEO_BYTES / 1024 / 1024 }) } });
    chunks.push(chunk as Buffer);
  }
  const data = Buffer.concat(chunks);
  if (data.length === 0) badField("file", L("빈 파일이에요."));
  if (!looksLikeVideo(data, mime)) badField("file", L("{n} 파일이 아니거나 손상된 파일이에요.", { n: VIDEO_TYPES[mime] }));

  const num = (key: string) => Number(params.get(key));
  const width = Math.round(num("width"));
  const height = Math.round(num("height"));
  const duration = num("duration");
  if (!(width >= 16 && width <= MAX_SIDE && height >= 16 && height <= MAX_SIDE)) badField("file", L("동영상 크기를 읽지 못했어요."));
  if (!(duration > 0)) badField("file", L("동영상 길이를 읽지 못했어요."));
  if (duration > MAX_VIDEO_SECONDS) badField("file", L("{n}분 이하의 동영상만 올릴 수 있어요.", { n: MAX_VIDEO_SECONDS / 60 }));

  const id = nextUploadId();
  const upload: Upload = { id, ownerId: user.id, mime, data, width, height, duration: Math.round(duration * 10) / 10, createdAt: Date.now() };
  db.uploads.set(id, upload);
  return upload;
}

/** MP4 는 4번째 바이트부터 "ftyp", WEBM 은 EBML 머리(1A 45 DF A3)로 시작한다. */
function looksLikeVideo(b: Buffer, mime: string): boolean {
  if (mime === "video/mp4") return b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp";
  if (mime === "video/webm") return b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3;
  return false;
}

export function uploadView(u: Upload) {
  return { id: u.id, url: uploadUrl(u.id), width: u.width, height: u.height, duration: u.duration, kind: u.mime.startsWith("video/") ? "video" : "image" };
}

export const uploadUrl = (id: string): string => `/media/u/${id}`;

/** 내가 올린 파일만 글·프로필에 붙일 수 있다. 이미지 자리에는 이미지만, 동영상 자리에는 동영상만. */
export function ownUpload(id: string, user: User, kind: "image" | "video" = "image"): Upload | null {
  const upload = db.uploads.get(id);
  if (!upload || upload.ownerId !== user.id) return null;
  return upload.mime.startsWith(`${kind}/`) ? upload : null;
}

/** 파일 머리에서 가로·세로를 읽는다. 형식이 맞지 않으면 null */
function imageSize(b: Buffer, mime: string): { width: number; height: number } | null {
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  try {
    if (mime === "image/png") {
      if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return null;
      return ok(b.readUInt32BE(16), b.readUInt32BE(20));
    }
    if (mime === "image/gif") {
      if (b.length < 10 || b.toString("ascii", 0, 4) !== "GIF8") return null;
      return ok(b.readUInt16LE(6), b.readUInt16LE(8));
    }
    if (mime === "image/webp") {
      if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
      const chunk = b.toString("ascii", 12, 16);
      if (chunk === "VP8X") return ok(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
      if (chunk === "VP8 ") return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
      if (chunk === "VP8L") {
        const bits = b.readUInt32LE(21);
        return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      return null;
    }
    if (mime === "image/jpeg") {
      if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        // SOF0~SOF15 (DHT·JPG·DAC 제외) 에 크기가 들어 있다.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return ok(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
        }
        i += 2 + len;
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}
