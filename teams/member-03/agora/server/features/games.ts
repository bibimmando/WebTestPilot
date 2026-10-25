import { currentUser, requireUser } from "../auth";
import { L } from "../i18n";
import { badField, json, notFound, readJson, type Req, type Res } from "../http";
import { db } from "../store";
import type { GameRecord, User } from "../types";

/**
 * Agora 게임. 게임 자체는 화면에서 돌고, 서버는 기록(최고 기록 · 판 수)과 순위만 맡는다.
 *   GET  /api/games               게임 목록 (+ 내 최고 기록)
 *   GET  /api/games/:id           게임 하나 + 순위 10명
 *   POST /api/games/:id/plays     { score, won }  한 판 결과를 남긴다 (로그인 필요)
 * 점수는 모두 "적을수록 좋은" 횟수다 (시도 · 이동 횟수). 진 판(won: false)은 판 수만 센다.
 */

interface GameDef {
  id: string;
  title: string;
  tagline: string;
  howTo: string;
  color: string;
  unit: "tries" | "moves";
  min: number;
  max: number;
  /** 시드 이용자 외의 이번 달 이용자 수 (화면에 보여 줄 기본값) */
  baseMonthly: number;
}

export const GAMES: GameDef[] = [
  {
    id: "word5", title: "다섯 글자", tagline: "매일 바뀌는 영어 단어 맞히기",
    howTo: "여섯 번 안에 다섯 글자 영어 단어를 맞혀요. 초록은 자리까지 맞음, 노랑은 단어에 있지만 다른 자리예요.",
    color: "#facc15", unit: "tries", min: 1, max: 6, baseMonthly: 12400,
  },
  {
    id: "memory", title: "짝 맞추기", tagline: "같은 그림 카드 두 장 찾기",
    howTo: "카드를 두 장씩 뒤집어 같은 그림을 찾아요. 적게 뒤집을수록 좋은 기록이에요.",
    color: "#a78bfa", unit: "moves", min: 8, max: 500, baseMonthly: 8300,
  },
  {
    id: "lights", title: "불 끄기", tagline: "누르면 십자 모양으로 바뀌는 불 끄기",
    howTo: "칸을 누르면 그 칸과 위아래 · 양옆 칸이 함께 바뀌어요. 불을 모두 끄면 끝나요.",
    color: "#38bdf8", unit: "moves", min: 1, max: 999, baseMonthly: 5100,
  },
  {
    id: "updown", title: "업다운", tagline: "1부터 100 사이 숫자 맞히기",
    howTo: "숨은 숫자를 맞혀요. 틀리면 더 큰지(업) 작은지(다운) 알려 줘요.",
    color: "#34d399", unit: "tries", min: 1, max: 100, baseMonthly: 3900,
  },
];

const MONTH = 30 * 24 * 60 * 60_000;

/**
 * 게임 시드. 정해 두면 화면이 같은 판(카드 배치 · 불 끄기 판 · 업다운 정답 · 다섯 글자 단어)을 만든다.
 * 같은 시나리오를 여러 번 돌리는 벤치마크용. 기본은 환경 변수 AGORA_SEED, 없으면 null(매번 무작위).
 * POST /_reset { "seed": 42 } 로 바꾸고, { "seed": null } 로 끈다. 본문 없이 부르면 환경 변수 값으로 돌아간다.
 * 화면 주소의 ?seed= 가 있으면 그것이 이긴다.
 */
export const SEED_MAX = 2_147_483_647;
const envSeed = (): number | null => {
  const n = Number(process.env.AGORA_SEED);
  return process.env.AGORA_SEED && Number.isInteger(n) && n >= 0 && n <= SEED_MAX ? n : null;
};
let gameSeed: number | null = envSeed();
export const currentGameSeed = () => gameSeed;

/** /_reset 본문의 seed. 없으면 환경 변수 값, null 이면 끄기, 정수면 그 값. 잘못된 값이면 오류 문구 */
export function applySeed(body: Record<string, unknown>): string | null {
  if (!("seed" in body)) {
    gameSeed = envSeed();
    return null;
  }
  const v = body.seed;
  if (v === null) {
    gameSeed = null;
    return null;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > SEED_MAX) return L("seed 는 0부터 {max} 사이의 정수이거나 null 이어야 해요.", { max: SEED_MAX });
  gameSeed = v;
  return null;
}
const BOARD_SIZE = 10;

export async function handleGames(req: Req, res: Res, url: URL): Promise<boolean> {
  const method = req.method ?? "GET";
  const path = url.pathname;
  let m: RegExpMatchArray | null;

  if (path === "/api/games" && method === "GET") {
    const viewer = currentUser(req);
    json(res, 200, { games: GAMES.map((g) => gameView(g, viewer)), seed: gameSeed });
    return true;
  }

  if ((m = path.match(/^\/api\/games\/([a-z0-9]+)$/)) && method === "GET") {
    const game = getGame(m[1]);
    const viewer = currentUser(req);
    json(res, 200, { game: gameView(game, viewer), leaderboard: leaderboard(game.id), seed: gameSeed });
    return true;
  }

  if ((m = path.match(/^\/api\/games\/([a-z0-9]+)\/plays$/)) && method === "POST") {
    const game = getGame(m[1]);
    const user = requireUser(req);
    const body = await readJson(req);
    const won = body.won !== false;
    const score = body.score;
    if (won && (typeof score !== "number" || !Number.isInteger(score) || score < game.min || score > game.max)) {
      badField("score", L("기록은 {min}부터 {max} 사이의 정수여야 해요.", { min: game.min, max: game.max }));
    }
    const record = recordsOf(game.id).get(user.id) ?? { best: null, bestAt: null, plays: 0, lastAt: 0 };
    const now = Date.now();
    const newBest = won && (record.best === null || (score as number) < record.best);
    const next: GameRecord = {
      best: newBest ? (score as number) : record.best,
      bestAt: newBest ? now : record.bestAt,
      plays: record.plays + 1,
      lastAt: now,
    };
    recordsOf(game.id).set(user.id, next);
    json(res, 201, { game: gameView(game, user), newBest, rank: rankOf(game.id, user.id) });
    return true;
  }

  return false;
}

function getGame(id: string): GameDef {
  return GAMES.find((g) => g.id === id) ?? notFound();
}

function recordsOf(gameId: string): Map<string, GameRecord> {
  let map = db.games.get(gameId);
  if (!map) {
    map = new Map();
    db.games.set(gameId, map);
  }
  return map;
}

/** 최고 기록이 있는 사람만, 기록이 적은 순 → 먼저 세운 순 */
function ranked(gameId: string): [string, GameRecord][] {
  return [...recordsOf(gameId).entries()]
    .filter(([, r]) => r.best !== null)
    .sort(([, a], [, b]) => (a.best as number) - (b.best as number) || (a.bestAt as number) - (b.bestAt as number));
}

function rankOf(gameId: string, userId: string): number | null {
  const i = ranked(gameId).findIndex(([id]) => id === userId);
  return i < 0 ? null : i + 1;
}

function leaderboard(gameId: string) {
  return ranked(gameId)
    .slice(0, BOARD_SIZE)
    .map(([userId, r], i) => {
      const user = db.users.get(userId);
      return { rank: i + 1, name: user?.name ?? L("[알 수 없음]"), avatar: user?.avatar ?? null, best: r.best, plays: r.plays };
    });
}

function gameView(g: GameDef, viewer: User | null) {
  const records = recordsOf(g.id);
  const since = Date.now() - MONTH;
  const active = [...records.values()].filter((r) => r.lastAt >= since).length;
  const mine = viewer ? records.get(viewer.id) : undefined;
  return {
    id: g.id,
    title: L(g.title),
    tagline: L(g.tagline),
    howTo: L(g.howTo),
    color: g.color,
    unit: g.unit,
    min: g.min,
    max: g.max,
    monthlyPlayers: g.baseMonthly + active,
    me: viewer ? { best: mine?.best ?? null, plays: mine?.plays ?? 0, rank: rankOf(g.id, viewer.id) } : null,
  };
}

/** 시드 기록. 순위표가 처음부터 비어 있지 않게 몇 명의 기록을 넣는다. */
export function seedGames(now: number, ids: Record<string, string>): void {
  const MIN = 60_000;
  const rows: [string, string, number, number, number][] = [
    // 게임, 사용자, 최고 기록, 판 수, 몇 분 전
    ["word5", "bob", 3, 14, 90],
    ["word5", "alice", 4, 9, 300],
    ["word5", "carol", 4, 5, 2000],
    ["memory", "carol", 11, 6, 45],
    ["memory", "alice", 14, 3, 600],
    ["lights", "bob", 7, 4, 1500],
    ["updown", "alice", 5, 12, 30],
    ["updown", "bob", 6, 8, 800],
    ["updown", "carol", 7, 2, 5000],
  ];
  for (const [game, name, best, plays, ago] of rows) {
    const at = now - ago * MIN;
    recordsOf(game).set(ids[name], { best, bestAt: at, plays, lastAt: at });
  }
}
