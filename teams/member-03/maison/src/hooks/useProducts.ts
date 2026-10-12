import { useQuery } from "@tanstack/react-query";
import { api, type ListResponse } from "@/lib/api";
import type { Product } from "@/data/products";

export type SortOption =
  | "featured"
  | "newest"
  | "price-asc"
  | "price-desc"
  | "name-asc";

interface ProductQuery {
  collection?: string;
  sort?: SortOption;
  limit?: number;
  featured?: boolean;
  new?: boolean;
  q?: string;
}

function toSearch(q: ProductQuery): string {
  const p = new URLSearchParams();
  if (q.q?.trim()) p.set("q", q.q.trim());
  if (q.collection && q.collection !== "all") p.set("collection", q.collection);
  if (q.sort && q.sort !== "featured") p.set("sort", q.sort);
  if (q.limit) p.set("limit", String(q.limit));
  if (q.featured) p.set("featured", "1");
  if (q.new) p.set("new", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

interface ProductListResponse extends ListResponse<Product> {
  query?: string;
}

/** 목록. 쿼리가 바뀌면 키가 바뀌어 새로 받아온다. */
export function useProducts(q: ProductQuery = {}) {
  return useQuery({
    queryKey: ["products", q],
    queryFn: () => api.get<ProductListResponse>(`/api/products${toSearch(q)}`),
  });
}

/** 상세. slug 가 없으면 요청하지 않는다. */
export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["product", slug],
    queryFn: () => api.get<Product>(`/api/products/${encodeURIComponent(slug!)}`),
    enabled: Boolean(slug),
  });
}

/** 연관 상품. 상세와 별개 요청이라 한쪽만 실패할 수 있다. */
export function useRelatedProducts(slug: string | undefined, limit = 4) {
  return useQuery({
    queryKey: ["related", slug, limit],
    queryFn: () =>
      api.get<ListResponse<Product>>(
        `/api/products/${encodeURIComponent(slug!)}/related?limit=${limit}`,
      ),
    enabled: Boolean(slug),
  });
}
