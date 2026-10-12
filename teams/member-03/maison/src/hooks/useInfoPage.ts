import { useQuery } from "@tanstack/react-query";
import { api, type ListResponse } from "@/lib/api";

export interface InfoSection {
  heading: string;
  body?: string[];
  bullets?: string[];
  rows?: { label: string; value: string }[];
  qa?: { q: string; a: string }[];
}

export interface InfoPage {
  slug: string;
  title: string;
  eyebrow: string;
  intro: string;
  updatedAt: string;
  sections: InfoSection[];
}

export type InfoPageSummary = Pick<
  InfoPage,
  "slug" | "title" | "eyebrow" | "intro"
>;

export function useInfoPage(slug: string | undefined) {
  return useQuery({
    queryKey: ["page", slug],
    queryFn: () => api.get<InfoPage>(`/api/pages/${encodeURIComponent(slug!)}`),
    enabled: Boolean(slug),
  });
}

/** 푸터가 쓰는 목록. 모든 화면에 있으므로 한 번 받아 두고 재사용한다. */
export function useInfoPages() {
  return useQuery({
    queryKey: ["pages"],
    queryFn: () => api.get<ListResponse<InfoPageSummary>>("/api/pages"),
    staleTime: Infinity,
  });
}
