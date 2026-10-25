import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowBigUp, MessageSquare, Search } from "lucide-react";
import { clsx } from "clsx";
import { Trans, useT } from "@/i18n";
import { api } from "@/lib/api";
import { compactNumber, postPath } from "@/lib/format";
import { useDismiss } from "@/lib/useDismiss";
import { CommunityAvatar } from "./CommunityAvatar";
import { UserAvatar } from "./UserAvatar";

interface Suggestions {
  q: string;
  communities: { name: string; title: string; icon: string | null; color: string; members: number }[];
  users: { name: string; avatar: string | null; karma: number }[];
  posts: { id: string; title: string; community: string; communityIcon: string | null; score: number; commentCount: number; thumbnail: string | null }[];
}

interface Option {
  key: string;
  href: string;
  render: ReactNode;
}

const DEBOUNCE_MS = 150;

/** 검색어에서 맞는 부분을 굵게 */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * 머리글 검색창. 입력하면 아래에 커뮤니티 · 사용자 · 글 추천이 뜬다.
 *   ↑ ↓ 로 고르고 Enter 로 이동, 아무것도 고르지 않고 Enter 면 전체 검색.
 *   ESC · 바깥 클릭으로 닫힌다.
 */
export function SearchBox() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const id = useId();
  const listId = `${id}-list`;
  const boxRef = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState(location.pathname === "/search" ? (params.get("q") ?? "") : "");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const close = useCallback(() => {
    setOpen(false);
    setActive(-1);
  }, []);
  useDismiss(boxRef, open, close);

  // 검색 화면에서는 주소의 검색어를 따라간다.
  useEffect(() => {
    if (location.pathname === "/search") setQ(params.get("q") ?? "");
  }, [location.pathname, params]);

  // 다른 화면으로 옮기면 닫는다.
  useEffect(close, [location.pathname, location.search, close]);

  // 입력이 멈추면 추천을 받는다. 늦게 온 이전 응답은 버린다.
  const term = q.trim();
  useEffect(() => {
    if (!term) {
      setData(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get<Suggestions>(`/api/search/suggest?q=${encodeURIComponent(term)}`).then(
        (r) => {
          if (!alive) return;
          setData(r);
          setLoading(false);
          setActive(-1);
        },
        () => alive && setLoading(false),
      );
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term]);

  const searchHref = `/search?q=${encodeURIComponent(term)}`;
  const shown = data && data.q === term ? data : null;

  const groups: { label: string; options: Option[] }[] = [];
  if (shown?.communities.length) {
    groups.push({
      label: t("커뮤니티"),
      options: shown.communities.map((c) => ({
        key: `c-${c.name}`,
        href: `/c/${c.name}`,
        render: (
          <>
            <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">c/<Highlight text={c.name} q={term} /></span>
              <span className="block truncate text-xs text-muted"><Highlight text={c.title} q={term} /> · {t("회원 {n}", { n: compactNumber(c.members) })}</span>
            </span>
          </>
        ),
      })),
    });
  }
  if (shown?.users.length) {
    groups.push({
      label: t("사용자"),
      options: shown.users.map((u) => ({
        key: `u-${u.name}`,
        href: `/u/${u.name}`,
        render: (
          <>
            <UserAvatar name={u.name} src={u.avatar} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">u/<Highlight text={u.name} q={term} /></span>
              <span className="block text-xs text-muted">{t("카르마 {n}", { n: compactNumber(u.karma) })}</span>
            </span>
          </>
        ),
      })),
    });
  }
  if (shown?.posts.length) {
    groups.push({
      label: t("글"),
      options: shown.posts.map((p) => ({
        key: `p-${p.id}`,
        href: postPath(p),
        render: (
          <>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm"><Highlight text={p.title} q={term} /></span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <CommunityAvatar name={p.community} title={p.community} icon={p.communityIcon} size="xs" />
                c/{p.community}
                <span className="inline-flex items-center gap-0.5"><ArrowBigUp className="h-3.5 w-3.5" />{compactNumber(p.score)}</span>
                <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{compactNumber(p.commentCount)}</span>
              </span>
            </span>
            {p.thumbnail && <img src={p.thumbnail} alt="" className="h-10 w-14 shrink-0 rounded-md object-cover" loading="lazy" />}
          </>
        ),
      })),
    });
  }
  // 마지막 줄은 항상 "전체 검색"
  const searchAll: Option = {
    key: "search-all",
    href: searchHref,
    render: (
      <>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg"><Search className="h-4 w-4 text-muted" /></span>
        <span className="truncate text-sm"><Trans text="'{term}' 전체 검색" values={{ term: <span className="font-semibold">{term}</span> }} /></span>
      </>
    ),
  };
  const flat = [...groups.flatMap((g) => g.options), searchAll];
  const optionId = (i: number) => `${id}-opt-${i}`;
  const visible = open && !!term;

  const go = (href: string) => {
    close();
    navigate(href);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!term) return;
    go(active >= 0 ? flat[active].href : searchHref);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!term) return;
      e.preventDefault();
      setOpen(true);
      // -1 은 "입력창에 머무름". 끝에서 한 번 더 누르면 입력창으로 돌아온다.
      const last = flat.length - 1;
      if (e.key === "ArrowDown") setActive((i) => (i >= last ? -1 : i + 1));
      else setActive((i) => (i <= -1 ? last : i - 1));
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  };

  let index = -1;
  return (
    <form ref={boxRef} onSubmit={onSubmit} role="search" className="relative mx-auto w-full max-w-xl">
      <label className="relative block">
        <span className="sr-only">{t("Agora 검색")}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => term && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("Agora 검색")}
          autoComplete="off"
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
          className={clsx(
            "h-10 w-full rounded-full border border-line bg-bg pl-9 pr-4 text-sm focus:border-accent focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/20",
            visible && "sm:rounded-b-none sm:rounded-t-[1.25rem] sm:border-b-transparent",
          )}
        />
      </label>

      {visible && (
        // 좁은 화면에서는 검색창이 작아서, 추천 목록을 화면 폭에 맞춰 띄운다.
        <div className="fixed inset-x-3 top-[3.25rem] z-40 overflow-hidden rounded-2xl border border-line bg-surface shadow-xl sm:absolute sm:inset-x-0 sm:top-full sm:rounded-t-none sm:border-t-0">
          <ul id={listId} role="listbox" aria-label={t("검색 추천")} className="max-h-[70vh] overflow-y-auto py-1">
            {groups.map((g) => (
              <li key={g.label} role="presentation">
                <p className="px-4 pb-1 pt-2 text-xs font-semibold text-muted" aria-hidden="true">{g.label}</p>
                <ul role="group" aria-label={g.label}>
                  {g.options.map((o) => {
                    index += 1;
                    const i = index;
                    return (
                      <li
                        key={o.key}
                        id={optionId(i)}
                        role="option"
                        aria-selected={active === i}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(o.href)}
                        className={clsx("flex cursor-pointer items-center gap-3 px-4 py-2", active === i && "bg-bg")}
                      >
                        {o.render}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {shown && groups.length === 0 && (
              <li role="presentation" className="px-4 py-3 text-sm text-muted">{t("'{term}' 와 맞는 커뮤니티 · 사용자 · 글 제목이 없어요.", { term })}</li>
            )}
            {!shown && loading && (
              <li role="presentation" className="px-4 py-3 text-sm text-muted">{t("찾는 중…")}</li>
            )}
            <li
              id={optionId(flat.length - 1)}
              role="option"
              aria-selected={active === flat.length - 1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(flat.length - 1)}
              onClick={() => go(searchHref)}
              className={clsx("flex cursor-pointer items-center gap-3 border-t border-line px-4 py-2.5", active === flat.length - 1 && "bg-bg")}
            >
              {searchAll.render}
            </li>
          </ul>
        </div>
      )}
    </form>
  );
}
