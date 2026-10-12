import type { IncomingMessage, ServerResponse } from "node:http";
import { products, collections, type Product } from "./data";
import { findInfoPage, listInfoPages } from "./pages";
import { enabledIds, groundTruth } from "./bugs";
import { accountNameForValidation, rejectsSignupPassword } from "./bugs/validation-behavior";
import {
  consumeResetToken,
  createOrder,
  createResetToken,
  createSession,
  createUser,
  destroySession,
  destroyUserSessions,
  findOrderById,
  findUserByEmail,
  listOrdersByUser,
  orderCount,
  publicUser,
  reset,
  userCount,
  updateUserName,
  updateUserPassword,
  userForResetToken,
  userForToken,
  verifyPassword,
  type Order,
  type User,
} from "./store";

/** 로컬 API 는 1ms 안에 응답해서 스켈레톤이 화면에 뜨지 않는다.
 *  로딩 상태를 관찰 가능하게 만들기 위한 최소 지연. 버그가 아니라 현실성 보정. */
const DELAY_MS = Number(process.env.API_DELAY_MS ?? 250);

const SESSION_COOKIE = "maison_session";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const priceOf = (productId: string): number | null =>
  products.find((p) => p.id === productId)?.price ?? null;

// 서버가 뜨는 시점에 시드 상태를 만든다.
reset(priceOf);

type SortOption = "featured" | "newest" | "price-asc" | "price-desc" | "name-asc";

function sortProducts(list: Product[], sort: SortOption): Product[] {
  const out = [...list];
  switch (sort) {
    case "newest":
      return out.filter((p) => p.new).concat(out.filter((p) => !p.new));
    case "price-asc":
      return out.sort((a, b) => a.price - b.price);
    case "price-desc":
      return out.sort((a, b) => b.price - a.price);
    case "name-asc":
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case "featured":
    default:
      return out.filter((p) => p.featured).concat(out.filter((p) => !p.featured));
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  // 벤치마크 재현성: 캐시가 끼면 요청 수가 실행마다 달라진다.
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** 세션 쿠키. httpOnly 라서 JS 가 읽을 수 없고, Playwright 의
 *  storage_state 에는 담기므로 크롤러의 로그인 패스가 그대로 쓸 수 있다. */
function setSessionCookie(res: ServerResponse, token: string) {
  res.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}

function clearSessionCookie(res: ServerResponse) {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function currentUser(req: IncomingMessage): User | undefined {
  return userForToken(parseCookies(req)[SESSION_COOKIE]);
}

/** 주문의 상품 id 를 화면이 쓸 수 있는 형태로 펼친다. */
function expandOrder(order: Order) {
  const items = order.items.map((line) => {
    const product = products.find((p) => p.id === line.productId);
    return {
      quantity: line.quantity,
      product: product ?? null,
      lineTotal: product ? product.price * line.quantity : 0,
    };
  });
  return { ...order, items };
}

/** 검색어 매칭.
 *
 * 이름·설명·소재·컬렉션 이름을 모두 본다. 소재를 넣은 건 "brass",
 * "linen" 처럼 소재로 찾는 경우가 많아서다. 공백으로 나눈 낱말이
 * 전부 들어 있어야 맞는 것으로 본다(AND). 하나라도 걸리면 맞다고
 * 하면(OR) 결과가 거의 전체가 된다. */
function matchesQuery(product: Product, query: string): boolean {
  const collection = collections.find((c) => c.id === product.collection);
  const haystack = [
    product.name,
    product.description,
    product.longDescription,
    product.materials,
    collection?.name ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (!path.startsWith("/api/") && path !== "/_reset" && path !== "/gt.json")
    return false;

  // POST /_reset — 시드 상태로 복원. 벤치마크가 매 실행 전에 부른다.
  if (path === "/_reset") {
    reset(priceOf);
    json(res, 200, { ok: true, users: userCount(), orders: orderCount() });
    return true;
  }

  // GET /gt.json — 정답지. 벤치마크가 측정 전에 읽는다.
  // 지연을 주지 않는다. 측정 대상이 아니라 측정 조건이다.
  if (path === "/gt.json") {
    json(res, 200, groundTruth());
    return true;
  }

  await sleep(DELAY_MS);

  // GET /api/bugs — 지금 켜진 버그. 화면이 토글을 읽는 유일한 통로다.
  // 환경변수는 서버에만 있고 브라우저에는 없기 때문에 거쳐야 한다.
  if (path === "/api/bugs" && req.method === "GET") {
    json(res, 200, { enabled: enabledIds() });
    return true;
  }

  // GET /api/health
  if (path === "/api/health") {
    json(res, 200, {
      ok: true,
      products: products.length,
      users: userCount(),
      orders: orderCount(),
    });
    return true;
  }

  // ── 인증 ────────────────────────────────────────────────

  // POST /api/auth/signup
  if (path === "/api/auth/signup" && req.method === "POST") {
    let payload: { email?: string; password?: string; name?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }

    const email = (payload.email ?? "").trim();
    const password = payload.password ?? "";
    const name = (payload.name ?? "").trim();

    const missing = [
      !name && "name",
      !email && "email",
      !password && "password",
    ].filter(Boolean);
    if (missing.length > 0) {
      json(res, 400, { error: "missing_fields", fields: missing });
      return true;
    }
    if (!isEmail(email)) {
      json(res, 400, { error: "invalid_email" });
      return true;
    }
    if (rejectsSignupPassword(password)) {
      json(res, 400, { error: "weak_password", minLength: 8 });
      return true;
    }
    if (findUserByEmail(email)) {
      json(res, 409, { error: "email_taken" });
      return true;
    }

    const user = createUser(email, password, name);
    setSessionCookie(res, createSession(user.id));
    json(res, 201, { user: publicUser(user) });
    return true;
  }

  // POST /api/auth/login
  if (path === "/api/auth/login" && req.method === "POST") {
    let payload: { email?: string; password?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }

    const email = (payload.email ?? "").trim();
    const password = payload.password ?? "";
    if (!email || !password) {
      json(res, 400, {
        error: "missing_fields",
        fields: [!email && "email", !password && "password"].filter(Boolean),
      });
      return true;
    }

    const user = findUserByEmail(email);
    // 계정이 없는 경우와 비밀번호가 틀린 경우를 구분해서 알리지 않는다.
    // 구분하면 어떤 이메일이 가입돼 있는지 확인하는 데 쓸 수 있다.
    if (!user || !verifyPassword(user, password)) {
      json(res, 401, { error: "invalid_credentials" });
      return true;
    }

    setSessionCookie(res, createSession(user.id));
    json(res, 200, { user: publicUser(user) });
    return true;
  }

  // POST /api/auth/logout
  if (path === "/api/auth/logout" && req.method === "POST") {
    destroySession(parseCookies(req)[SESSION_COOKIE]);
    clearSessionCookie(res);
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/auth/me
  //
  // 비로그인은 오류가 아니라 "현재 사용자가 없다"는 정상적인 답이므로
  // 200 + user: null 로 돌려준다. 여기서 401 을 쓰면 모든 화면이 이 조회를
  // 하므로 브라우저가 페이지마다 콘솔 오류를 찍고, 크롤러의 console_error
  // 검사가 전 페이지에서 오탐한다. 실제로 19개 상태 전부에서 1건씩 나왔다.
  // 보호가 필요한 /api/orders 는 그대로 401 을 쓴다.
  if (path === "/api/auth/me" && req.method === "GET") {
    const user = currentUser(req);
    json(res, 200, { user: user ? publicUser(user) : null });
    return true;
  }

  // PATCH /api/auth/me — 이름 변경
  if (path === "/api/auth/me" && req.method === "PATCH") {
    const user = currentUser(req);
    if (!user) {
      json(res, 401, { error: "not_authenticated" });
      return true;
    }
    let payload: { name?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const name = accountNameForValidation(payload.name ?? "");
    if (!name) {
      json(res, 400, { error: "missing_fields", fields: ["name"] });
      return true;
    }
    const updated = updateUserName(user.id, name);
    json(res, 200, { user: publicUser(updated!) });
    return true;
  }

  // POST /api/auth/password — 로그인한 상태에서 비밀번호 변경
  if (path === "/api/auth/password" && req.method === "POST") {
    const user = currentUser(req);
    if (!user) {
      json(res, 401, { error: "not_authenticated" });
      return true;
    }
    let payload: { currentPassword?: string; newPassword?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const current = payload.currentPassword ?? "";
    const next = payload.newPassword ?? "";
    const missing = [
      !current && "currentPassword",
      !next && "newPassword",
    ].filter(Boolean);
    if (missing.length > 0) {
      json(res, 400, { error: "missing_fields", fields: missing });
      return true;
    }
    // 세션만 믿고 바꾸면 자리를 비운 사이 남이 바꿀 수 있다.
    if (!verifyPassword(user, current)) {
      json(res, 401, { error: "wrong_password" });
      return true;
    }
    if (next.length < 8) {
      json(res, 400, { error: "weak_password", minLength: 8 });
      return true;
    }
    if (next === current) {
      json(res, 400, { error: "same_password" });
      return true;
    }

    updateUserPassword(user.id, next);
    destroyUserSessions(user.id);
    // 방금 바꾼 본인은 계속 쓰게 새 세션을 준다.
    setSessionCookie(res, createSession(user.id));
    json(res, 200, { ok: true });
    return true;
  }

  // POST /api/auth/forgot — 재설정 링크 요청
  if (path === "/api/auth/forgot" && req.method === "POST") {
    let payload: { email?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const email = (payload.email ?? "").trim();
    if (!email || !isEmail(email)) {
      json(res, 400, { error: "invalid_email" });
      return true;
    }

    const user = findUserByEmail(email);
    // 계정이 없어도 200 을 돌려준다. 404 를 주면 어떤 이메일이 가입돼
    // 있는지 확인하는 데 쓸 수 있다.
    //
    // resetUrl 을 응답에 함께 넣는 건 이 데모에 메일 발송이 없기 때문이다.
    // 실제 서비스라면 메일로만 보내야 한다. 여기서는 계정 존재 여부가
    // 드러나지만, 링크를 받을 다른 경로가 없어서 감수한다.
    const resetUrl = user
      ? `/reset-password?token=${createResetToken(user.id)}`
      : null;
    json(res, 200, { ok: true, resetUrl });
    return true;
  }

  // POST /api/auth/reset — 토큰으로 새 비밀번호 설정
  if (path === "/api/auth/reset" && req.method === "POST") {
    let payload: { token?: string; password?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const token = (payload.token ?? "").trim();
    const password = payload.password ?? "";
    if (!token) {
      json(res, 400, { error: "missing_fields", fields: ["token"] });
      return true;
    }
    if (password.length < 8) {
      json(res, 400, { error: "weak_password", minLength: 8 });
      return true;
    }
    const user = userForResetToken(token);
    if (!user) {
      json(res, 400, { error: "invalid_token" });
      return true;
    }

    updateUserPassword(user.id, password);
    consumeResetToken(token);
    destroyUserSessions(user.id);
    setSessionCookie(res, createSession(user.id));
    json(res, 200, { user: publicUser(user) });
    return true;
  }

  // GET /api/auth/reset?token= — 링크가 아직 유효한지 미리 확인
  if (path === "/api/auth/reset" && req.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    const user = userForResetToken(token);
    if (!user) {
      json(res, 400, { error: "invalid_token" });
      return true;
    }
    json(res, 200, { email: user.email });
    return true;
  }

  // ── 안내 페이지 ─────────────────────────────────────────

  // GET /api/pages — 푸터가 쓰는 목록
  if (path === "/api/pages" && req.method === "GET") {
    const items = listInfoPages();
    json(res, 200, { items, total: items.length });
    return true;
  }

  // GET /api/pages/:slug
  const pageMatch = path.match(/^\/api\/pages\/([^/]+)$/);
  if (pageMatch && req.method === "GET") {
    const slug = decodeURIComponent(pageMatch[1]);
    const page = findInfoPage(slug);
    if (!page) {
      json(res, 404, { error: "page_not_found", slug });
      return true;
    }
    json(res, 200, page);
    return true;
  }

  // POST /api/subscribe — 푸터 뉴스레터
  if (path === "/api/subscribe" && req.method === "POST") {
    let payload: { email?: string };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }
    const email = (payload.email ?? "").trim();
    if (!email) {
      json(res, 400, { error: "missing_fields", fields: ["email"] });
      return true;
    }
    if (!isEmail(email)) {
      json(res, 400, { error: "invalid_email" });
      return true;
    }
    // 메일 발송 연동은 없다. 접수만 확인해 준다.
    json(res, 202, { ok: true, email });
    return true;
  }

  // ── 상품 ────────────────────────────────────────────────

  // GET /api/collections
  if (path === "/api/collections" && req.method === "GET") {
    json(res, 200, { items: collections, total: collections.length });
    return true;
  }

  // GET /api/products/:slug/related
  const relatedMatch = path.match(/^\/api\/products\/([^/]+)\/related$/);
  if (relatedMatch && req.method === "GET") {
    const slug = decodeURIComponent(relatedMatch[1]);
    const base = products.find((p) => p.slug === slug);
    if (!base) {
      json(res, 404, { error: "product_not_found", slug });
      return true;
    }
    const limit = Number(url.searchParams.get("limit") ?? 4);
    const items = products
      .filter((p) => p.collection === base.collection && p.id !== base.id)
      .slice(0, limit);
    json(res, 200, { items, total: items.length });
    return true;
  }

  // GET /api/products/:slug
  const detailMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (detailMatch && req.method === "GET") {
    const slug = decodeURIComponent(detailMatch[1]);
    const product = products.find((p) => p.slug === slug);
    if (!product) {
      json(res, 404, { error: "product_not_found", slug });
      return true;
    }
    json(res, 200, product);
    return true;
  }

  // GET /api/products?collection=&sort=&limit=&featured=&new=
  if (path === "/api/products" && req.method === "GET") {
    const collectionSlug = url.searchParams.get("collection");
    const sort = (url.searchParams.get("sort") ?? "featured") as SortOption;
    const limitRaw = url.searchParams.get("limit");
    const q = (url.searchParams.get("q") ?? "").trim();

    let list = products;

    if (q) {
      list = list.filter((p) => matchesQuery(p, q));
    }

    if (collectionSlug && collectionSlug !== "all") {
      const collection = collections.find((c) => c.slug === collectionSlug);
      if (!collection) {
        json(res, 404, { error: "collection_not_found", slug: collectionSlug });
        return true;
      }
      list = list.filter((p) => p.collection === collection.id);
    }
    if (url.searchParams.get("featured") === "1") {
      list = list.filter((p) => p.featured);
    }
    if (url.searchParams.get("new") === "1") {
      list = list.filter((p) => p.new);
    }

    let items = sortProducts(list, sort);
    const total = items.length;
    if (limitRaw) {
      const limit = Number(limitRaw);
      if (Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);
    }

    json(res, 200, { items, total, query: q || undefined });
    return true;
  }

  // ── 주문 ────────────────────────────────────────────────

  // GET /api/orders/:id — 본인 주문이거나 비로그인 주문일 때만 보인다.
  const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "GET") {
    const id = decodeURIComponent(orderMatch[1]);
    const order = findOrderById(id);
    if (!order) {
      json(res, 404, { error: "order_not_found", id });
      return true;
    }
    // 계정에 묶인 주문은 그 계정으로 로그인해야 열린다.
    // 이게 없으면 주문번호가 순번이라 1001 부터 올려가며 남의
    // 이름·주소를 전부 읽을 수 있다.
    if (order.userId) {
      const user = currentUser(req);
      if (!user) {
        json(res, 401, { error: "not_authenticated" });
        return true;
      }
      if (user.id !== order.userId) {
        json(res, 403, { error: "forbidden" });
        return true;
      }
    }
    json(res, 200, expandOrder(order));
    return true;
  }

  // GET /api/orders — 내 주문 목록. 로그인 필요.
  if (path === "/api/orders" && req.method === "GET") {
    const user = currentUser(req);
    if (!user) {
      json(res, 401, { error: "not_authenticated" });
      return true;
    }
    const items = listOrdersByUser(user.id).map(expandOrder);
    json(res, 200, { items, total: items.length });
    return true;
  }

  // POST /api/orders — 로그인 상태면 계정에 묶이고, 아니면 게스트 주문.
  if (path === "/api/orders" && req.method === "POST") {
    let payload: {
      items?: { productId: string; quantity: number }[];
      customer?: Record<string, string>;
    };
    try {
      payload = JSON.parse((await readBody(req)) || "{}");
    } catch {
      json(res, 400, { error: "invalid_json" });
      return true;
    }

    const lines = payload.items ?? [];
    if (lines.length === 0) {
      json(res, 400, { error: "empty_cart" });
      return true;
    }

    const required = ["firstName", "lastName", "email", "address"];
    const missing = required.filter((k) => !payload.customer?.[k]?.trim());
    if (missing.length > 0) {
      json(res, 400, { error: "missing_fields", fields: missing });
      return true;
    }

    let subtotal = 0;
    for (const line of lines) {
      const price = priceOf(line.productId);
      if (price === null) {
        json(res, 422, { error: "unknown_product", productId: line.productId });
        return true;
      }
      subtotal += price * line.quantity;
    }

    const user = currentUser(req);
    const order = createOrder({
      userId: user?.id ?? null,
      items: lines,
      subtotal,
      shipping: subtotal > 500 ? 0 : 25,
      customer: payload.customer ?? {},
    });

    json(res, 201, {
      orderId: order.id,
      total: order.total,
      shipping: order.shipping,
    });
    return true;
  }

  json(res, 404, { error: "not_found", path });
  return true;
}
