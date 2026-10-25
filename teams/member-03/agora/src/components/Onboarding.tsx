import { useT } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { clsx } from "clsx";
import { tr } from "@/i18n";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useCommunities } from "@/lib/communities";
import { compactNumber } from "@/lib/format";
import type { Gender, InterestCategory, Me, Recommendations } from "@/lib/types";
import { CommunityAvatar } from "./CommunityAvatar";

export const GENDER_LABELS: Record<Gender, string> = {
  male: "남성",
  female: "여성",
  nonbinary: "논바이너리",
};

let catalog: Promise<InterestCategory[]> | null = null;

/** 관심 항목 목록은 바뀌지 않으니 한 번만 받는다. */
export function useInterestCatalog() {
  return useAsync(() => {
    catalog ??= api.get<{ categories: InterestCategory[] }>("/api/interests").then(
      (r) => r.categories,
      (err) => {
        catalog = null;
        throw err;
      },
    );
    return catalog;
  }, []);
}

/** 화면이 바뀌면 제목으로 포커스를 옮겨, 화면 낭독기가 새 단계를 읽게 한다. */
function useFocusHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

const STEPS = 3;

function StepDots({ step }: { step: number }) {
  return (
    <p className="mb-4 flex items-center justify-center gap-1.5" aria-label={tr("{total}단계 중 {n}단계", { total: STEPS, n: step })}>
      {Array.from({ length: STEPS }, (_, i) => i + 1).map((n) => (
        <span key={n} className={clsx("h-1.5 rounded-full", n === step ? "w-6 bg-accent" : "w-1.5 bg-line")} />
      ))}
    </p>
  );
}

const optionClass =
  "btn h-14 w-full rounded-full border border-line bg-surface text-[15px] text-ink hover:border-accent hover:bg-accent-soft disabled:opacity-60";

/** 가입 1단계: 성별. 고르면 바로 다음 단계로, 원하지 않으면 건너뛴다. */
export function GenderStep({ onNext }: { onNext: () => void }) {
  const t = useT();
  const heading = useFocusHeading();
  const [busy, setBusy] = useState<Gender | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (gender: Gender) => {
    setBusy(gender);
    setError(null);
    try {
      await api.put("/api/me/gender", { gender });
      onNext();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div>
      <StepDots step={1} />
      <div className="mb-6 text-center">
        <h2 id="auth-title" ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">{t("성별을 알려 주세요")}</h2>
        <p className="mt-2 text-sm text-muted">{t("맞춤 추천에만 쓰고, 다른 사람에게는 보이지 않아요. 설정에서 언제든 바꿀 수 있어요.")}</p>
      </div>
      <div className="space-y-3" role="group" aria-label={t("성별")}>
        {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
          <button key={g} type="button" className={optionClass} disabled={busy !== null} onClick={() => choose(g)}>
            {t(GENDER_LABELS[g])}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{error}</p>}
      <button type="button" className="btn mt-6 w-full text-muted hover:text-ink" disabled={busy !== null} onClick={onNext}>
        {t("건너뛰기")}
      </button>
    </div>
  );
}

/** 관심 항목 고르기. 가입 2단계 · 설정 화면 · 커뮤니티 만들기에서 같이 쓴다. max 를 채우면 고르지 않은 항목은 막는다. */
export function InterestPicker({ selected, onToggle, max }: { selected: Set<string>; onToggle: (id: string) => void; max?: number }) {
  const t = useT();
  const { data, error } = useInterestCatalog();
  if (error) return <p role="alert" className="text-sm text-down">{t("관심 항목을 불러오지 못했어요.")} {errorMessage(error)}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>;
  return (
    <div className="space-y-5">
      {data.map((cat) => (
        <section key={cat.id} aria-labelledby={`interest-cat-${cat.id}`}>
          <h3 id={`interest-cat-${cat.id}`} className="mb-2 text-sm font-bold">{cat.label}</h3>
          <div className="flex flex-wrap gap-2">
            {cat.items.map((item) => {
              const on = selected.has(item.id);
              const full = !on && max !== undefined && selected.size >= max;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => onToggle(item.id)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    on ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink hover:border-muted/50 hover:bg-bg",
                  )}
                >
                  <span aria-hidden="true">{item.emoji}</span>
                  {item.label}
                  {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 가입 2단계: 관심 항목을 1개 이상 고른다. */
export function InterestsStep({ onBack, onDone }: { onBack: () => void; onDone: (interests: string[]) => void }) {
  const t = useT();
  const heading = useFocusHeading();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ settings: { interests: string[] } }>("/api/me/interests", { interests: [...selected] });
      onDone(r.settings.interests);
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields.interests ?? err.message) : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="absolute left-4 top-4 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-bg hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {t("뒤로")}
      </button>
      <StepDots step={2} />
      <div className="mb-5 text-center">
        <h2 id="auth-title" ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">{t("관심 있는 주제를 골라 주세요")}</h2>
        <p className="mt-2 text-sm text-muted">{t("여러 개 고를 수 있어요. 설정에서 언제든 바꿀 수 있어요.")}</p>
      </div>
      <div className="-mx-2 max-h-[46vh] overflow-y-auto px-2 pb-2">
        <InterestPicker selected={selected} onToggle={(id) => setSelected((s) => toggleIn(s, id))} />
      </div>
      {error && <p role="alert" className="mt-3 rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{error}</p>}
      <div className="mt-4 border-t border-line pt-4">
        <button type="button" className="btn h-12 w-full rounded-full bg-accent text-base text-on-accent hover:bg-accent-strong disabled:bg-line disabled:text-muted" disabled={busy || selected.size === 0} onClick={save}>
          {selected.size === 0 ? t("1개 이상 골라 주세요") : t("{n}개 선택 · 계속", { n: selected.size })}
        </button>
      </div>
    </div>
  );
}

/** 처음부터 골라 둘 추천 커뮤니티 수 */
const PRESELECT = 3;

/**
 * 가입 3단계: 관심 항목에 맞는 커뮤니티. 위에서부터 몇 곳을 골라 둔 채로 보여 주고,
 * 고른 곳에 한꺼번에 가입한다. 첫 홈 화면이 바로 "내 피드" 가 되게 하려는 단계다.
 */
export function CommunitiesStep({ onBack, onDone }: { onBack: () => void; onDone: (user: Me | null) => void }) {
  const t = useT();
  const heading = useFocusHeading();
  const { reload } = useCommunities();
  const { data, error } = useAsync(() => api.get<Recommendations>("/api/communities/recommended?limit=8"), []);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 관심 항목과 겹치는 곳 중 위에서부터 몇 곳을 골라 둔다.
  const picked = selected ?? new Set(data?.items.filter((i) => i.reason === "interest").slice(0, PRESELECT).map((i) => i.community.name) ?? []);

  const join = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const r = await api.post<{ user: Me }>("/api/me/joined", { names: [...picked] });
      await reload();
      onDone(r.user);
    } catch (err) {
      setSaveError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="absolute left-4 top-4 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-bg hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {t("뒤로")}
      </button>
      <StepDots step={3} />
      <div className="mb-5 text-center">
        <h2 id="auth-title" ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">{t("이런 커뮤니티는 어때요?")}</h2>
        <p className="mt-2 text-sm text-muted">{t("고른 관심 항목에 맞춰 골랐어요. 가입한 곳의 글이 홈에 모여요.")}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-down">{t("추천 커뮤니티를 불러오지 못했어요.")} {errorMessage(error)}</p>
      ) : !data ? (
        <p className="py-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : (
        <ul className="-mx-2 max-h-[46vh] space-y-2 overflow-y-auto px-2 pb-2" aria-label={t("추천 커뮤니티")}>
          {data.items.map(({ community: c, reason, matched }) => {
            const on = picked.has(c.name);
            return (
              <li key={c.name}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(toggleIn(picked, c.name))}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                    on ? "border-accent bg-accent-soft" : "border-line hover:bg-bg",
                  )}
                >
                  <CommunityAvatar name={c.name} title={c.title} icon={c.icon} color={c.color} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{c.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {reason === "interest" ? t("{topics} 관심", { topics: matched.map((m) => m.label).join(" · ") }) : t("회원 {n}", { n: compactNumber(c.members) })}
                    </span>
                  </span>
                  <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border", on ? "border-accent bg-accent text-on-accent" : "border-line")}>
                    {on && <Check className="h-4 w-4" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {saveError && <p role="alert" className="mt-3 rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{saveError}</p>}
      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <button type="button" className="btn h-12 w-full rounded-full bg-accent text-base text-on-accent hover:bg-accent-strong disabled:bg-line disabled:text-muted" disabled={busy || !data} onClick={join}>
          {picked.size > 0 ? t("{n}곳 가입하고 시작하기", { n: picked.size }) : t("시작하기")}
        </button>
        <button type="button" className="btn w-full text-muted hover:text-ink" disabled={busy} onClick={() => onDone(null)}>
          {t("건너뛰기")}
        </button>
      </div>
    </div>
  );
}
