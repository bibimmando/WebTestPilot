/**
 * API 호출 래퍼.
 *
 * fetch 는 404·500 을 받아도 reject 하지 않는다. res.ok 를 확인하지 않으면
 * 실패한 요청이 성공으로 흘러가고, 호출한 쪽은 성공 토스트를 띄운다.
 * 그 검사를 여기 한 곳에 모아둔다.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly payload: unknown,
  ) {
    super(`API ${status} ${code}`);
    this.name = "ApiError";
  }
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 서버가 HTML 오류 페이지를 돌려주는 경우 — JSON.parse 가 터지면
    // 원인이 "파싱 실패" 로 보여서 진짜 원인인 상태코드를 가린다.
    throw new ApiError(res.status, "invalid_json", text.slice(0, 200));
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    // 네트워크 차단·서버 미동작. fetch 가 실제로 reject 하는 유일한 경우.
    throw new ApiError(0, "network_error", String(err));
  }

  const body = await parse(res);

  if (!res.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : "http_error";
    throw new ApiError(res.status, code, body);
  }

  return body as T;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
};
