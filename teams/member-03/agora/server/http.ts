import type { IncomingMessage, ServerResponse } from "http";
import { L } from "./i18n";

export type Req = IncomingMessage;
export type Res = ServerResponse;

/** 핸들러가 던지면 api.ts 가 그대로 응답으로 바꾼다. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}

export function json(res: Res, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

const MAX_BODY = 200_000;

/** maxBytes 는 이미지 업로드처럼 큰 요청에서만 늘린다. */
export async function readJson(req: Req, maxBytes = MAX_BODY): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw new HttpError(413, { error: "payload_too_large", message: L("요청이 너무 커요.") });
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 아래에서 같은 오류로 처리한다.
  }
  throw new HttpError(400, { error: "invalid_json" });
}

export function parseCookies(req: Req): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 문자열이 아니면 빈 문자열. 입력 검증에서 타입부터 거른다. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 글자 수는 코드 단위가 아니라 사람이 보는 글자로 센다 (이모지·한글 조합). */
export function charCount(text: string): number {
  return [...text].length;
}

export const notFound = (): never => {
  throw new HttpError(404, { error: "not_found" });
};
export const forbidden = (message: string): never => {
  throw new HttpError(403, { error: "forbidden", message });
};
export const conflict = (error: string, message: string): never => {
  throw new HttpError(409, { error, message });
};
/** 칸별 오류가 하나라도 있으면 400 으로 끝낸다. */
export function invalid(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) throw new HttpError(400, { error: "validation", fields });
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** 칸 하나가 틀렸을 때 바로 끝낸다. */
export const badField = (field: string, message: string): never => {
  throw new HttpError(400, { error: "validation", fields: { [field]: message } });
};
