import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 실행 중에 생기는 데이터(계정·세션·주문)를 모아 둔다.
 *
 * 메모리에만 두는 이유는 작업을 줄이려는 게 아니라 벤치마크 때문이다.
 * 영속 저장을 쓰면 실행을 반복할수록 주문이 쌓여 /orders 의 화면이 매번
 * 달라지고, 같은 상태가 새 상태로 잡혀 재현성이 깨진다.
 *
 * 나중에 파일이나 SQLite 로 바꿀 때를 대비해 데이터 접근을 전부 이 파일의
 * 함수로 모았다. 바깥 코드는 내부 구조를 모른다.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

export interface OrderLine {
  productId: string;
  quantity: number;
}

export interface Order {
  id: string;
  userId: string | null; // 비로그인 주문은 null
  createdAt: string;
  items: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  customer: Record<string, string>;
}

// ── 비밀번호 ──────────────────────────────────────────────
// 평문으로 두면 결함을 찾는 프로젝트에서 앞뒤가 안 맞는다.
// 외부 의존성 없이 Node 내장 scrypt 를 쓴다.

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(user: User, password: string): boolean {
  const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
  const stored = Buffer.from(user.passwordHash, "hex");
  if (candidate.length !== stored.length) return false;
  // 길이·내용 비교 시간이 입력에 따라 달라지지 않게 한다.
  return timingSafeEqual(candidate, stored);
}

// ── 상태 ──────────────────────────────────────────────────

let users: User[] = [];
let orders: Order[] = [];
let sessions = new Map<string, string>(); // token → userId
let resetTokens = new Map<string, { userId: string; expiresAt: number }>();
let userSeq = 0;
let orderSeq = 1000;

/** 시드 계정. 크롤러의 로그인 패스가 쓸 고정 자격증명이다.
 *  데모 사이트의 공개 계정이므로 숨길 대상이 아니다. */
const SEED_USERS = [
  { email: "demo@maison.com", password: "demo1234", name: "Demo User" },
  { email: "test@maison.com", password: "test1234", name: "Test User" },
];

/** demo 계정의 과거 주문. /orders 가 빈 화면으로만 보이지 않게 하고,
 *  계정별로 주문이 분리되는지 바로 확인할 수 있게 한다. */
const SEED_ORDERS: { email: string; items: OrderLine[] }[] = [
  { email: "demo@maison.com", items: [{ productId: "arc-pendant", quantity: 1 }] },
  {
    email: "demo@maison.com",
    items: [
      { productId: "vessel-collection", quantity: 2 },
      { productId: "linen-throw", quantity: 1 },
    ],
  },
];

type PriceLookup = (productId: string) => number | null;

/** 시드 상태로 되돌린다. 서버 시작 시와 POST /_reset 에서 부른다. */
export function reset(priceOf: PriceLookup): void {
  users = [];
  orders = [];
  sessions = new Map();
  resetTokens = new Map();
  userSeq = 0;
  orderSeq = 1000;

  for (const seed of SEED_USERS) {
    createUser(seed.email, seed.password, seed.name);
  }

  for (const seed of SEED_ORDERS) {
    const user = findUserByEmail(seed.email);
    if (!user) continue;
    const lines = seed.items.filter((l) => priceOf(l.productId) !== null);
    if (lines.length === 0) continue;
    const subtotal = lines.reduce(
      (sum, l) => sum + (priceOf(l.productId) ?? 0) * l.quantity,
      0,
    );
    createOrder({
      userId: user.id,
      items: lines,
      subtotal,
      shipping: subtotal > 500 ? 0 : 25,
      customer: {
        firstName: "Demo",
        lastName: "User",
        email: user.email,
        address: "12 Rue de Rivoli",
        city: "Paris",
        postalCode: "75001",
        country: "France",
      },
    });
  }
}

// ── 계정 ──────────────────────────────────────────────────

export function findUserByEmail(email: string): User | undefined {
  const needle = email.trim().toLowerCase();
  return users.find((u) => u.email === needle);
}

export function findUserById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function createUser(email: string, password: string, name: string): User {
  const salt = randomBytes(16).toString("hex");
  const user: User = {
    id: `u${++userSeq}`,
    email: email.trim().toLowerCase(),
    name: name.trim(),
    passwordHash: hashPassword(password, salt),
    salt,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  return user;
}

/** 화면과 API 응답에 내보낼 형태. 해시와 솔트는 절대 나가지 않는다. */
export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name };
}

export function updateUserName(userId: string, name: string): User | undefined {
  const user = findUserById(userId);
  if (!user) return undefined;
  user.name = name.trim();
  return user;
}

/** 비밀번호를 바꿀 때는 솔트도 새로 뽑는다. 같은 솔트를 재사용하면
 *  이전 해시와의 관계가 남는다. */
export function updateUserPassword(userId: string, password: string): User | undefined {
  const user = findUserById(userId);
  if (!user) return undefined;
  user.salt = randomBytes(16).toString("hex");
  user.passwordHash = hashPassword(password, user.salt);
  return user;
}

// ── 비밀번호 재설정 토큰 ──────────────────────────────────

const RESET_TTL_MS = 30 * 60 * 1000;

export function createResetToken(userId: string): string {
  const token = randomBytes(24).toString("hex");
  resetTokens.set(token, { userId, expiresAt: Date.now() + RESET_TTL_MS });
  return token;
}

export function userForResetToken(token: string): User | undefined {
  const entry = resetTokens.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    resetTokens.delete(token);
    return undefined;
  }
  return findUserById(entry.userId);
}

/** 한 번 쓴 토큰은 버린다. 남겨 두면 같은 링크로 계속 바꿀 수 있다. */
export function consumeResetToken(token: string): void {
  resetTokens.delete(token);
}

/** 비밀번호가 바뀌면 그 사용자의 기존 세션을 모두 끊는다.
 *  다른 기기에 남아 있던 로그인이 그대로 유지되면 재설정의 의미가 없다. */
export function destroyUserSessions(userId: string): void {
  for (const [token, id] of sessions) {
    if (id === userId) sessions.delete(token);
  }
}

// ── 세션 ──────────────────────────────────────────────────

export function createSession(userId: string): string {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, userId);
  return token;
}

export function userForToken(token: string | undefined): User | undefined {
  if (!token) return undefined;
  const userId = sessions.get(token);
  return userId ? findUserById(userId) : undefined;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

// ── 주문 ──────────────────────────────────────────────────

export function createOrder(input: {
  userId: string | null;
  items: OrderLine[];
  subtotal: number;
  shipping: number;
  customer: Record<string, string>;
}): Order {
  const order: Order = {
    id: `MA-${++orderSeq}`,
    userId: input.userId,
    createdAt: new Date().toISOString(),
    items: input.items,
    subtotal: input.subtotal,
    shipping: input.shipping,
    total: input.subtotal + input.shipping,
    customer: input.customer,
  };
  orders.push(order);
  return order;
}

export function findOrderById(id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function listOrdersByUser(userId: string): Order[] {
  return orders
    .filter((o) => o.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function orderCount(): number {
  return orders.length;
}

export function userCount(): number {
  return users.length;
}
