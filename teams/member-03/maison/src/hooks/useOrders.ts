import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type ListResponse } from "@/lib/api";
import type { Order } from "@/hooks/useOrder";

/** 내 주문 목록. 로그인하지 않았으면 서버가 401 을 돌려준다. */
export function useOrders(enabled = true) {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => api.get<ListResponse<Order>>("/api/orders"),
    enabled,
    retry: (count, err) =>
      // 인증 실패는 다시 시도해도 결과가 같다.
      !(err instanceof ApiError && err.status === 401) && count < 1,
  });
}
