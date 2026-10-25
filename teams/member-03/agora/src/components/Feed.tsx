import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { useCommunities } from "@/lib/communities";
import type { Listing, Post } from "@/lib/types";
import type { ViewMode } from "@/lib/viewMode";
import { FEED_DEFAULTS, type SortDefaults } from "./SortBar";
import { PostCard } from "./PostCard";

interface Props {
  feed?: "home" | "popular" | "all";
  community?: string;
  emptyAction?: { to: string; label: string };
  view?: ViewMode;
  /** 주소에 ?sort= ?t= 가 없을 때 쓰는 값. SortBar 에 넘긴 것과 같아야 한다. */
  defaults?: SortDefaults;
}

/** 글 목록. 정렬·기간·말머리는 주소에서 읽고, "더 보기" 로 이어서 불러온다. */
export function Feed({ feed, community, emptyAction, view = "card", defaults = FEED_DEFAULTS.community }: Props) {
  const t = useT();
  const { list } = useCommunities();
  const [params] = useSearchParams();
  const sort = params.get("sort") ?? defaults.sort;
  const range = params.get("t") ?? defaults.t;
  const flair = params.get("flair") ?? "";

  const [items, setItems] = useState<Post[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 결함 N1: 다시 불러올 조건에서 커뮤니티가 빠져, 커뮤니티 화면 사이를 옮겨도 목록을 새로 받지 않는다
  const bugN1 = useBug("N1");

  const query = (offset: number) => {
    const q = new URLSearchParams({ sort, t: range, offset: String(offset), limit: "10" });
    if (feed) q.set("feed", feed);
    if (community) q.set("community", community);
    if (flair) q.set("flair", flair);
    return `/api/posts?${q}`;
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.get<Listing>(query(0)).then(
      (r) => {
        if (!alive) return;
        setItems(r.items);
        setNextOffset(r.nextOffset);
        setHasMore(r.hasMore);
        setLoading(false);
      },
      (err) => {
        if (!alive) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, bugN1 ? null : community, sort, range, flair]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const r = await api.get<Listing>(query(nextOffset));
      setItems((prev) => [...prev, ...r.items]);
      setNextOffset(r.nextOffset);
      setHasMore(r.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div role="alert" className="card p-6 text-sm text-down">
        {t("글을 불러오지 못했어요.")} {error}
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <p className="font-semibold">{t("아직 글이 없어요")}</p>
        <p className="text-sm text-muted">{flair ? t("'{flair}' 말머리 글이 없어요.", { flair: list.find((c) => c.name === community)?.flairLabels[flair] ?? flair }) : t("첫 글을 남겨 보세요.")}</p>
        {emptyAction && <Link to={emptyAction.to} className="btn-primary">{t(emptyAction.label)}</Link>}
      </div>
    );
  }

  return (
    <div className={view === "compact" ? "space-y-1.5" : "space-y-3"}>
      {items.map((post) => (
        <PostCard key={post.id} post={post} showCommunity={!community} view={view} />
      ))}
      {loading && <p className="py-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>}
      {!loading && hasMore && (
        <div className="flex justify-center pt-2">
          <button type="button" className="btn-outline" onClick={loadMore}>{t("더 보기")}</button>
        </div>
      )}
    </div>
  );
}
