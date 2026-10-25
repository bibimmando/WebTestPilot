/**
 * 게임 판을 만드는 난수. 시드가 있으면 늘 같은 순서의 수를, 없으면 Math.random 을 쓴다.
 * 같은 시드라도 게임(salt)과 판 번호(round)가 다르면 다른 판이 나온다 — "다시 하기" 도 재현된다.
 */
export type Rng = () => number;

/** mulberry32: 작고 빠른 32비트 난수기. 같은 시작 값이면 같은 수열을 낸다. */
function mulberry32(a: number): Rng {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function makeRng(seed: number | null, salt: string, round: number): Rng {
  return seed === null ? Math.random : mulberry32(hash(`${seed}:${salt}:${round}`));
}

/** 주소의 ?seed= 를 읽는다. 0~2147483647 의 정수만 받는다. */
export function seedFromUrl(search: string): number | null {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}
