import { scoreOf } from "./store";
import type { Comment, Post } from "./types";

/**
 * "인기" 정렬. 점수의 로그와 작성 시각을 더한다.
 * 점수가 10배가 되면 약 12.5시간 더 최근 글과 같은 순위가 된다.
 * 오래된 고득점 글보다 새로 뜨는 글이 위로 오게 하는 일반적인 공식이다.
 */
const EPOCH_SECONDS = 1_134_028_003;

export function hotRank(score: number, createdAt: number): number {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  return sign * order + (createdAt / 1000 - EPOCH_SECONDS) / 45_000;
}

export const POST_SORTS = ["hot", "new", "top"] as const;
export type PostSort = (typeof POST_SORTS)[number];

/** "추천순" 의 기간 */
export const TOP_WINDOWS: Record<string, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
  all: Number.POSITIVE_INFINITY,
};

export function sortPosts(posts: Post[], sort: PostSort): Post[] {
  const list = [...posts];
  if (sort === "new") return list.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === "top") return list.sort((a, b) => scoreOf(b) - scoreOf(a) || b.createdAt - a.createdAt);
  return list.sort((a, b) => hotRank(scoreOf(b), b.createdAt) - hotRank(scoreOf(a), a.createdAt));
}

export const COMMENT_SORTS = ["best", "top", "new", "old"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export function sortComments(list: Comment[], sort: CommentSort): Comment[] {
  const out = [...list];
  if (sort === "new") return out.sort((a, b) => b.createdAt - a.createdAt);
  if (sort === "old") return out.sort((a, b) => a.createdAt - b.createdAt);
  // best 와 top 은 점수 순. 같은 점수면 best 는 먼저 쓴 댓글, top 은 최근 댓글이 위로.
  if (sort === "top") return out.sort((a, b) => scoreOf(b) - scoreOf(a) || b.createdAt - a.createdAt);
  return out.sort((a, b) => scoreOf(b) - scoreOf(a) || a.createdAt - b.createdAt);
}
