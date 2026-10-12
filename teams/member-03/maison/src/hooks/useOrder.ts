import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Product } from "@/data/products";

export interface OrderLine {
  product: Product | null;
  quantity: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  createdAt: string;
  items: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  customer: Record<string, string>;
}

/** 주문 상세. 주문번호로 다시 조회할 수 있어야 새로고침·북마크가 된다. */
export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api.get<Order>(`/api/orders/${encodeURIComponent(orderId!)}`),
    enabled: Boolean(orderId),
  });
}
