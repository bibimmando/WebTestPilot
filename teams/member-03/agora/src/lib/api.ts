import { currentLang, tr } from "@/i18n";

/** 서버 API 호출. 실패하면 ApiError 를 던진다. 서버도 같은 언어로 오류 문구를 돌려주도록 언어를 함께 보낸다. */

export class ApiError extends Error {
  status: number;
  body: { error?: string; message?: string; fields?: Record<string, string> } | null;

  constructor(status: number, body: ApiError["body"]) {
    super(body?.message ?? body?.error ?? tr("요청에 실패했어요 (HTTP {status})", { status }));
    this.status = status;
    this.body = body;
  }

  /** 입력 칸별 오류 메시지 */
  get fields(): Record<string, string> {
    return this.body?.fields ?? {};
  }
}

/**
 * 결함 N2: 마지막으로 성공한 GET 응답. 결함이 켜져 있으면 '로그인이 필요해요'(401) 대신 이것을 돌려준다.
 * 기록은 늘 하고(화면 순서상 결함 토글보다 첫 요청이 먼저 갈 수 있다), 꺼내 쓰는 것만 결함일 때 한다.
 */
const lastGood = new Map<string, unknown>();
let staleOnUnauthorized = false;
export function setStaleOnUnauthorized(on: boolean): void {
  staleOnUnauthorized = on;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "x-agora-lang": currentLang(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (method === "GET" && res.ok) {
    lastGood.delete(url);
    lastGood.set(url, data);
    if (lastGood.size > 50) lastGood.delete(lastGood.keys().next().value as string);
  }
  if (!res.ok && res.status === 401 && method === "GET" && staleOnUnauthorized && lastGood.has(url)) return lastGood.get(url) as T;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return tr("알 수 없는 오류가 났어요.");
}
