import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useCart } from "@/hooks/useCart";
import { useWishlist } from "@/hooks/useWishlist";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * 현재 로그인 사용자.
 *
 * 세션은 httpOnly 쿠키라 JS 가 읽을 수 없다. 로그인 여부는 서버에 물어서만
 * 알 수 있으므로 이 조회가 인증 상태의 유일한 출처다.
 */
export function useMe() {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      // 서버는 비로그인일 때도 200 + user: null 을 돌려준다.
      // 오류로 다루면 화면마다 콘솔 오류가 남는다.
      const { user } = await api.get<{ user: AuthUser | null }>("/api/auth/me");
      return user;
    },
    staleTime: 30_000,
  });

  return {
    ...query,
    user: query.data ?? null,
    isLoggedIn: Boolean(query.data),
  };
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<{ user: AuthUser }>("/api/auth/login", body),
    onSuccess: ({ user }) => {
      qc.setQueryData(["me"], user);
      // 주문 목록은 사용자마다 다르다. 이전 사용자의 결과를 버린다.
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string }) =>
      api.post<{ user: AuthUser }>("/api/auth/signup", body),
    onSuccess: ({ user }) => {
      qc.setQueryData(["me"], user);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const clearCart = useCart((s) => s.clearCart);
  const clearWishlist = useWishlist((s) => s.clearWishlist);

  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/auth/logout", {}),
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      // 장바구니와 위시리스트는 브라우저에 남는다. 비우지 않으면 다음
      // 사용자가 이전 사용자의 담긴 상품을 그대로 보게 된다.
      clearCart();
      clearWishlist();
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: { email: string }) =>
      api.post<{ ok: boolean; resetUrl: string | null }>(
        "/api/auth/forgot",
        body,
      ),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      api.post<{ user: AuthUser }>("/api/auth/reset", body),
    onSuccess: ({ user }) => {
      // 재설정이 끝나면 서버가 새 세션을 준다. 바로 로그인 상태로 잇는다.
      qc.setQueryData(["me"], user);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

/** 링크가 아직 유효한지 미리 확인한다. 비밀번호를 다 치고 나서야
 *  만료를 알려 주면 입력이 헛수고가 된다. */
export function useResetToken(token: string | null) {
  return useQuery({
    queryKey: ["reset-token", token],
    queryFn: () =>
      api.get<{ email: string }>(
        `/api/auth/reset?token=${encodeURIComponent(token!)}`,
      ),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useUpdateName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api.patch<{ user: AuthUser }>("/api/auth/me", body),
    onSuccess: ({ user }) => qc.setQueryData(["me"], user),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post<{ ok: boolean }>("/api/auth/password", body),
  });
}
