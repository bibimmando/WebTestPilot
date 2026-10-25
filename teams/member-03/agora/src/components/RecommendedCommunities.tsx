import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Recommendations } from "@/lib/types";

/** 추천 커뮤니티. 관심 항목과 겹치는 곳을 먼저, 모자라면 인기 커뮤니티로 채운다 (탐색 화면의 "나를 위한 추천"). */
export function useRecommendations(limit: number) {
  const { user } = useSession();
  return useAsync(() => api.get<Recommendations>(`/api/communities/recommended?limit=${limit}`), [user?.name, user?.interests.join(","), limit]);
}
