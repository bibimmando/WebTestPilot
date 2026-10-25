import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSession } from "./session";
import type { Community } from "./types";

/** 사이드바·글쓰기 화면이 같이 쓰는 커뮤니티 목록. 가입 상태가 바뀌면 한 곳에서 갱신한다. */

interface CommunitiesValue {
  list: Community[];
  loading: boolean;
  reload: () => Promise<void>;
  replace: (community: Community) => void;
}

const CommunitiesContext = createContext<CommunitiesValue | null>(null);

export function CommunitiesProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [list, setList] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await api.get<{ items: Community[] }>("/api/communities");
      setList(r.items);
    } finally {
      setLoading(false);
    }
  }, []);

  // 로그인한 사람이 바뀌면 가입 여부가 달라지므로 다시 받는다.
  useEffect(() => {
    void reload();
  }, [reload, user?.name]);

  const replace = useCallback((community: Community) => {
    setList((prev) => prev.map((c) => (c.name === community.name ? community : c)));
  }, []);

  const value = useMemo(() => ({ list, loading, reload, replace }), [list, loading, reload, replace]);
  return <CommunitiesContext.Provider value={value}>{children}</CommunitiesContext.Provider>;
}

export function useCommunities(): CommunitiesValue {
  const value = useContext(CommunitiesContext);
  if (!value) throw new Error("CommunitiesProvider 안에서만 쓸 수 있어요.");
  return value;
}
