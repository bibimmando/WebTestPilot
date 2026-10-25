import { useT } from "@/i18n";
import { Link } from "react-router-dom";
import { Flame, Globe, Home } from "lucide-react";
import { clsx } from "clsx";
import { CommunityAvatar } from "@/components/CommunityAvatar";
import { Feed } from "@/components/Feed";
import { displayPost } from "@/components/PostCard";
import { TwoColumn } from "@/components/Layout";
import { RecentPosts } from "@/components/RecentPosts";
import { SiteFooter } from "@/components/SiteFooter";
import { FEED_DEFAULTS, SortBar } from "@/components/SortBar";
import { api } from "@/lib/api";
import { useAuthModal } from "@/lib/authModal";
import { useCommunities } from "@/lib/communities";
import { compactNumber, postPath } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import type { Listing } from "@/lib/types";
import { useViewMode } from "@/lib/viewMode";

type FeedKind = "home" | "popular" | "all";

/**
 * /  홈 · /popular  인기 · /all  전체
 * 세 화면은 글 목록(서버 listPosts)도 머리 부분도 다르다.
 *   홈    가입한 커뮤니티 글, 인기순. 손님은 환영 카드 + 인기 글
 *   인기  추천 100 이상 글, 이번 주 추천순 + 이번 주 인기 글 띠
 *   전체  모든 커뮤니티의 모든 글, 최신순
 */
export function HomePage({ feed }: { feed: FeedKind }) {
  const [view, setView] = useViewMode();

  return (
    <TwoColumn aside={<HomeAside />}>
      {feed === "home" && <HomeHeader />}
      {feed === "popular" && <PopularHeader />}
      {feed === "all" && <AllHeader />}
      <SortBar view={view} onViewChange={setView} defaults={FEED_DEFAULTS[feed]} />
      {/* key 로 피드를 바꿀 때 이전 목록이 잠깐 남지 않게 새로 만든다. */}
      <Feed key={feed} feed={feed} view={view} defaults={FEED_DEFAULTS[feed]} emptyAction={{ to: "/submit", label: "글쓰기" }} />
    </TwoColumn>
  );
}

function FeedTitle({ icon: Icon, tone, title, children }: { icon: typeof Home; tone: string; title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{t(title)}</h1>
        <p className="text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}

function HomeHeader() {
  const t = useT();
  const { user } = useSession();
  const { list } = useCommunities();
  const { open: openAuth } = useAuthModal();

  if (!user) {
    return (
      <section className="card mb-3 overflow-hidden">
        <div className="bg-gradient-to-r from-[#4f46e5] to-[#7c3aed] px-5 py-6 text-white">
          <h1 className="text-2xl font-extrabold">{t("Agora 에 오신 것을 환영해요")}</h1>
          <p className="mt-1 text-sm text-white/85">{t("관심사별 커뮤니티 {n}곳에서 글을 나누고 추천해 보세요.", { n: list.length })}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn bg-white text-[#3730a3] hover:bg-white/90" onClick={() => openAuth("signup")}>{t("가입하기@@signup")}</button>
            <button type="button" className="btn border border-white/60 text-white hover:bg-white/10" onClick={() => openAuth("login")}>{t("로그인")}</button>
          </div>
        </div>
        <p className="px-5 py-3 text-sm text-muted">{t("로그인하면 가입한 커뮤니티의 글을 모아 볼 수 있어요. 지금은 인기 글을 보여 드려요.")}</p>
      </section>
    );
  }

  const joined = list.filter((c) => c.joined);
  if (joined.length === 0) {
    return (
      <FeedTitle icon={Home} tone="bg-accent-soft text-accent-strong" title={t("홈")}>
        {t("아직 가입한 커뮤니티가 없어서 인기 글을 보여 드려요.")} <Link to="/explore" className="font-semibold text-accent hover:underline">{t("커뮤니티 둘러보기")}</Link>
      </FeedTitle>
    );
  }
  return (
    <div className="mb-3">
      <FeedTitle icon={Home} tone="bg-accent-soft text-accent-strong" title={t("홈")}>
        {t("가입한 커뮤니티 {n}곳의 글을 모아 봐요.", { n: joined.length })}
      </FeedTitle>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label={t("가입한 커뮤니티")}>
        {joined.map((c) => (
          <Link key={c.name} to={`/c/${c.name}`} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-xs font-semibold hover:bg-bg">
            <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="xs" />
            {c.title}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PopularHeader() {
  const t = useT();
  const { data } = useAsync(() => api.get<Listing>("/api/posts?feed=popular&sort=top&t=week&limit=4"), []);
  return (
    <div className="mb-3">
      <FeedTitle icon={Flame} tone="bg-orange-100 text-orange-600 dark:bg-orange-400/15 dark:text-orange-300" title={t("인기")}>
        {t("추천 100개 이상 받은 글을 이번 주 추천순으로 모았어요.")}{" "}
        {/* 왼쪽 메뉴에서 뺀 "전체" 로 가는 길 */}
        <Link to="/all" className="font-semibold text-accent hover:underline">{t("모든 글 보기 →")}</Link>
      </FeedTitle>
      <section aria-labelledby="trending-heading">
        <h2 id="trending-heading" className="mb-2 text-sm font-bold">{t("이번 주 인기 글")}</h2>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(data?.items ?? Array.from({ length: 4 }, () => null)).map((p, i) =>
            p ? (
              <li key={p.id}>
                <Link to={postPath(p)} className="group relative block aspect-[4/3] overflow-hidden rounded-xl bg-black">
                  {p.images[0] ? (
                    <img src={p.images[0].src} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                  ) : (
                    <span className="absolute inset-0 bg-gradient-to-br from-[#4f46e5] to-[#7c3aed]" />
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-bold text-white">{t("{n}위", { n: i + 1 })}</span>
                  <span className="absolute inset-x-2 bottom-2 text-white">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug">{displayPost(p).title}</span>
                    <span className="mt-0.5 block text-[11px] text-white/80">c/{p.community} · {t("추천 {n}", { n: compactNumber(p.score) })}</span>
                  </span>
                </Link>
              </li>
            ) : (
              <li key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-line" />
            ),
          )}
        </ol>
      </section>
    </div>
  );
}

function AllHeader() {
  const t = useT();
  const { list } = useCommunities();
  const posts = list.reduce((n, c) => n + c.postCount, 0);
  return (
    <FeedTitle icon={Globe} tone="bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300" title={t("전체")}>
      {t("커뮤니티 {c}곳의 글 {n}개를 가입 여부와 상관없이 최신순으로 보여 줘요.", { c: list.length, n: posts })}
    </FeedTitle>
  );
}

/** 홈 오른쪽: 최근 본 글, 맨 아래에 사이트 정책 링크. 화면을 내려도 그 자리에 붙어 있다. */
function HomeAside() {
  return (
    <div className="sticky top-[4.5rem] flex h-[calc(100vh-5.5rem)] flex-col gap-4">
      <div className="min-h-0 overflow-y-auto">
        <RecentPosts />
      </div>
      <SiteFooter className="mt-auto pb-2" />
    </div>
  );
}
