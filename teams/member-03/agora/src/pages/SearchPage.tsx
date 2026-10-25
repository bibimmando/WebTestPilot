import { useT } from "@/i18n";
import { Link, useSearchParams } from "react-router-dom";
import { CommunityAvatar } from "@/components/CommunityAvatar";
import { PostCard } from "@/components/PostCard";
import { api, errorMessage } from "@/lib/api";
import { compactNumber } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Community, Post } from "@/lib/types";

export function SearchPage() {
  const t = useT();
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const { user } = useSession();
  const tooShort = [...q].length < 2;

  const { data, error, loading } = useAsync(
    () =>
      tooShort
        ? Promise.resolve(undefined)
        : api.get<{ posts: Post[]; communities: Community[] }>(`/api/search?q=${encodeURIComponent(q)}`),
    [q, user?.name],
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t("검색")}</h1>
      <p className="mb-4 text-sm text-muted">{q ? t("\"{q}\" 검색 결과", { q }) : t("검색어를 입력하세요.")}</p>

      {tooShort ? (
        q && <p className="card p-8 text-center text-sm text-muted">{t("검색어를 2자 이상 입력해 주세요.")}</p>
      ) : error ? (
        <p role="alert" className="card p-6 text-sm text-down">{t("검색하지 못했어요.")} {errorMessage(error)}</p>
      ) : loading && !data ? (
        <p className="py-10 text-center text-sm text-muted">{t("검색하는 중…")}</p>
      ) : data && data.posts.length === 0 && data.communities.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">{t("\"{q}\" 에 대한 결과가 없어요.", { q })}</p>
      ) : (
        data && (
          <div className="space-y-6">
            {data.communities.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-muted">{t("커뮤니티")} {data.communities.length}</h2>
                <ul className="card divide-y divide-line">
                  {data.communities.map((c) => (
                    <li key={c.name} className="flex items-center gap-3 p-3">
                      <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="md" />
                      <div className="min-w-0 flex-1">
                        <Link to={`/c/${c.name}`} className="font-semibold hover:underline">{c.title}</Link>
                        <p className="truncate text-xs text-muted">c/{c.name} · {t("회원 {n}", { n: compactNumber(c.members) })} · {c.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.posts.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-muted">{t("글")} {data.posts.length}</h2>
                <div className="space-y-3">{data.posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
              </section>
            )}
          </div>
        )
      )}
    </div>
  );
}
