import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * 화면에서 버그 토글을 읽는다.
 *
 * 토글은 서버의 환경변수로 정해지는데, 브라우저에는 process.env 가 없다.
 * 그래서 값이 네트워크를 한 번 타고 와야 한다. 이게 없으면 Checkout 이나
 * ProductDetail 처럼 브라우저에서 도는 코드에는 버그를 심을 수 없다.
 *
 * 빌드 시점에 심는 방법(import.meta.env.VITE_*)도 있지만, 그러면 버그 조합을
 * 바꿀 때마다 다시 빌드해야 한다. 빌드 하나로 정상·버그 두 사이트를 띄우려면
 * 실행 시점에 받아야 한다.
 */

const EMPTY: string[] = [];

export function useEnabledBugs(): string[] {
  const { data } = useQuery({
    queryKey: ["bugs"],
    queryFn: () => api.get<{ enabled: string[] }>("/api/bugs"),
    // 서버가 시작할 때 정해지고 바뀌지 않는다. 화면마다 다시 물어볼 이유가 없다.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return data?.enabled ?? EMPTY;
}

/**
 * 버그 한 건이 켜졌는지.
 *
 *   const bugF1 = useBug("F1");
 *   if (!bugF1 && isSubmitting) return;   // F1: 중복 제출 방어
 *
 * 목록을 아직 못 받았으면 false 다. 즉 기본은 "정상 동작"이고,
 * 잠깐 늦게 와도 멀쩡한 쪽으로 기운다.
 */
export function useBug(id: string): boolean {
  return useEnabledBugs().includes(id);
}

/**
 * 켜진 목록을 <body data-bugs="U1 U2"> 로 찍는다.
 *
 * CSS 로 만드는 UI 버그가 이 속성에 걸린다. 이렇게 해두면 UI 담당자는
 * src/styles/bugs-ui.css 한 파일만 쓰고 다른 사람의 컴포넌트를
 * 건드리지 않아도 된다.
 */
export function useBugBodyAttribute(): void {
  const enabled = useEnabledBugs();

  useEffect(() => {
    const { body } = document;
    if (enabled.length === 0) {
      body.removeAttribute("data-bugs");
      return;
    }
    body.setAttribute("data-bugs", enabled.join(" "));
    return () => body.removeAttribute("data-bugs");
  }, [enabled]);
}
