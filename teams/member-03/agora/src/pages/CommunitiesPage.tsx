import { useT } from "@/i18n";
import { Link, useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { AccessBadges, CommunityAvatar, CommunityBanner } from "@/components/CommunityAvatar";
import { JoinButton } from "@/components/JoinButton";
import { useInterestCatalog } from "@/components/Onboarding";
import { useRecommendations } from "@/components/RecommendedCommunities";
import { useCommunities } from "@/lib/communities";
import { compactNumber } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Community } from "@/lib/types";

/**
 * /communities  모든 커뮤니티. ?category=games 처럼 관심 항목 분류로 거를 수 있다.
 * 로그인했고 관심 항목이 있으면 맨 위에 "나를 위한 추천" 이 붙는다.
 */
export function CommunitiesPage() {
  const t = useT();
  const { list, loading } = useCommunities();
  const { user } = useSession();
  const { data: catalog } = useInterestCatalog();
  const [params, setParams] = useSearchParams();
  const category = params.get("category");

  const selected = catalog?.find((c) => c.id === category);
  const topicIds = new Set(selected?.items.map((i) => i.id) ?? []);
  const shown = selected ? list.filter((c) => c.topics.some((t) => topicIds.has(t))) : list;
  // 커뮤니티가 하나도 없는 분류는 칩을 만들지 않는다.
  const usable = catalog?.filter((cat) => list.some((c) => c.topics.some((t) => cat.items.some((i) => i.id === t)))) ?? [];

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t("모든 커뮤니티")}</h1>
      <p className="mb-4 text-sm text-muted">{t("회원 수가 많은 순서예요. 커뮤니티 {n}곳", { n: list.length })}</p>

      {user && <ForYou />}

      {usable.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t("분류로 거르기")}>
          {[{ id: null as string | null, label: t("전체") }, ...usable.map((c) => ({ id: c.id as string | null, label: c.label }))].map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setParams(c.id ? { category: c.id } : {})}
              className={clsx(
                "btn px-3 py-1 text-xs",
                category === c.id ? "bg-ink text-surface" : "border border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : shown.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">{t("이 분류의 커뮤니티가 아직 없어요.")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((c) => <CommunityCard key={c.name} c={c} />)}
        </ul>
      )}
    </div>
  );
}

function CommunityCard({ c }: { c: Community }) {
  const t = useT();
  return (
    <li className="card flex flex-col overflow-hidden">
      <CommunityBanner banner={c.banner} color={c.color} className="h-20" />
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <div className="-mt-6 flex items-end gap-3">
          <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="lg" />
          <div className="min-w-0 flex-1">
            <Link to={`/c/${c.name}`} className="font-semibold hover:underline">{c.title}</Link>
            <p className="text-xs text-muted">c/{c.name} · {t("회원 {n}", { n: compactNumber(c.members) })} · {t("글 {n}", { n: c.postCount })}</p>
          </div>
        </div>
        <AccessBadges community={c} />
        <p className="line-clamp-2 flex-1 text-sm text-muted">{c.description}</p>
        <JoinButton community={c} className="self-start px-4 py-1.5" />
      </div>
    </li>
  );
}

/** 관심 항목과 겹치는, 아직 가입하지 않은 커뮤니티 */
function ForYou() {
  const t = useT();
  const { data, setData } = useRecommendations(6);
  const items = data?.items.filter((i) => i.reason === "interest") ?? [];
  if (!data?.basedOnInterests || items.length === 0) return null;
  return (
    <section className="card mb-4 p-4" aria-labelledby="for-you-heading">
      <h2 id="for-you-heading" className="mb-3 flex items-center gap-1.5 font-bold">
        <Sparkles className="h-4 w-4 text-accent" /> {t("나를 위한 추천")}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ community: c, matched }) => (
          <li key={c.name} className="flex items-center gap-3 rounded-xl border border-line p-3">
            <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="md" />
            <div className="min-w-0 flex-1">
              <Link to={`/c/${c.name}`} className="block truncate text-sm font-semibold hover:underline">{c.title}</Link>
              <p className="truncate text-xs font-medium text-accent-strong">{t("{topics} 관심", { topics: matched.map((m) => m.label).join(" · ") })}</p>
            </div>
            <JoinButton
              community={c}
              className="px-3 py-1 text-xs"
              onChange={(next) =>
                setData((prev) => prev && { ...prev, items: prev.items.map((it) => (it.community.name === next.name ? { ...it, community: next } : it)) })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
