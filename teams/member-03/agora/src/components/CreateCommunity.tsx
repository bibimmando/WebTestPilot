import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, Globe, Lock } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useCommunities } from "@/lib/communities";
import { useSession } from "@/lib/session";
import type { Community, CommunityAccess } from "@/lib/types";
import { Modal } from "./Modal";
import { InterestPicker, toggleIn } from "./Onboarding";

const STEPS = 3;
const TOPICS_MAX = 3;
const NAME_MAX = 21;
const DESCRIPTION_MAX = 500;
const NAME_PATTERN = /^[a-z0-9_]{3,21}$/;

const ACCESS: { id: CommunityAccess; label: string; detail: string; icon: typeof Globe }[] = [
  { id: "public", label: "공개", detail: "누구나 보고 글을 쓸 수 있어요.", icon: Globe },
  { id: "restricted", label: "제한", detail: "누구나 볼 수 있지만, 글은 운영진만 쓸 수 있어요.", icon: Eye },
  { id: "private", label: "비공개", detail: "회원만 보고 글을 쓸 수 있어요. 가입 요청이나 초대로만 들어와요.", icon: Lock },
];

/**
 * 커뮤니티 만들기 모달. 세 단계로 나눠 묻는다.
 *   1. 주제 (관심 항목에서 1~3개)  2. 공개 범위 · 성인용  3. 이름 · 소개 (둘 다 필수)
 * 만들면 새 커뮤니티로 이동한다. 닫았다 열면 처음부터 다시 시작한다.
 */
export function CreateCommunityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="create-community-title" size="lg">
      <CreateCommunityFlow onDone={onClose} />
    </Modal>
  );
}

interface Draft {
  topics: Set<string>;
  access: CommunityAccess;
  mature: boolean;
  name: string;
  description: string;
}

function CreateCommunityFlow({ onDone }: { onDone: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { reload } = useCommunities();
  const { refresh } = useSession();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({ topics: new Set(), access: "public", mature: false, name: "", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // 단계가 바뀌면 제목으로 포커스를 옮겨 화면 낭독기가 새 질문을 읽게 한다.
  useEffect(() => {
    if (step > 1) heading.current?.focus();
  }, [step]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const r = await api.post<{ community: Community }>("/api/communities", {
        name: draft.name,
        description: draft.description,
        topics: [...draft.topics],
        access: draft.access,
        mature: draft.mature,
      });
      await Promise.all([reload(), refresh()]);
      onDone();
      navigate(`/c/${r.community.name}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        const { name, description, ...rest } = err.fields;
        setErrors({ ...(name ? { name } : {}), ...(description ? { description } : {}) });
        // 앞 단계에서 고른 값의 오류(주제 · 공개 범위)는 위에 한 줄로 알린다.
        const other = Object.values(rest);
        if (other.length) setError(other.join(" "));
      } else setError(errorMessage(err));
      setBusy(false);
    }
  };

  const headingProps = { id: "create-community-title", ref: heading, tabIndex: -1, className: "text-2xl font-extrabold outline-none" };

  return (
    <div>
      {step > 1 && (
        <button type="button" onClick={() => setStep(step - 1)} className="absolute left-4 top-4 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-bg hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t("뒤로")}
        </button>
      )}
      <p className="mb-4 flex items-center justify-center gap-1.5" aria-label={t("{total}단계 중 {n}단계", { total: STEPS, n: step })}>
        {Array.from({ length: STEPS }, (_, i) => i + 1).map((n) => (
          <span key={n} className={clsx("h-1.5 rounded-full", n === step ? "w-6 bg-accent" : "w-1.5 bg-line")} />
        ))}
      </p>

      {step === 1 && (
        <>
          <div className="mb-5">
            <h2 {...headingProps}>{t("어떤 주제의 커뮤니티인가요?")}</h2>
            <p className="mt-2 text-sm text-muted">{t("커뮤니티에 맞는 주제를 {n}개까지 골라 주세요. 이 주제에 관심 있는 사람에게 추천돼요.", { n: TOPICS_MAX })}</p>
          </div>
          <p className="mb-2 text-sm font-semibold" aria-live="polite">{t("주제 {n}/{max}", { n: draft.topics.size, max: TOPICS_MAX })}</p>
          <div className="-mx-2 max-h-[46vh] overflow-y-auto px-2 pb-2">
            <InterestPicker selected={draft.topics} max={TOPICS_MAX} onToggle={(id) => update({ topics: toggleIn(draft.topics, id) })} />
          </div>
          <Footer>
            <button type="button" className="btn-primary px-6" disabled={draft.topics.size === 0} onClick={() => setStep(2)}>
              {t("다음")}
            </button>
          </Footer>
        </>
      )}

      {step === 2 && (
        <>
          <div className="mb-5">
            <h2 {...headingProps}>{t("어떤 종류의 커뮤니티인가요?")}</h2>
            <p className="mt-2 text-sm text-muted">{t("누가 보고 글을 쓸 수 있는지 정해요.")}</p>
          </div>
          <fieldset>
            <legend className="sr-only">{t("공개 범위")}</legend>
            <div className="space-y-2">
              {ACCESS.map((a) => {
                const on = draft.access === a.id;
                return (
                  <label
                    key={a.id}
                    className={clsx(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                      on ? "border-accent bg-accent-soft" : "border-line hover:bg-bg",
                    )}
                  >
                    <a.icon className={clsx("h-5 w-5 shrink-0", on ? "text-accent-strong" : "text-muted")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{t(a.label)}</span>
                      <span className="block text-sm text-muted">{t(a.detail)}</span>
                    </span>
                    <input type="radio" name="community-access" value={a.id} checked={on} onChange={() => update({ access: a.id })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <span className="min-w-0 flex-1">
              <span id="mature-label" className="block font-semibold">
                {t("성인용 (18+)")}
              </span>
              <span id="mature-detail" className="block text-sm text-muted">{t("성인 이용자를 위한 커뮤니티예요. 인기 피드와 추천에 나오지 않아요.")}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.mature}
              aria-labelledby="mature-label"
              aria-describedby="mature-detail"
              onClick={() => update({ mature: !draft.mature })}
              className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors", draft.mature ? "bg-accent" : "bg-line")}
            >
              <span className={clsx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]", draft.mature ? "left-6" : "left-1")} />
            </button>
          </div>

          <Footer>
            <button type="button" className="btn-primary px-6" onClick={() => setStep(3)}>
              {t("다음")}
            </button>
          </Footer>
        </>
      )}

      {step === 3 && (
        <form onSubmit={submit} noValidate>
          <div className="mb-5">
            <h2 {...headingProps}>{t("커뮤니티를 소개해 주세요")}</h2>
            <p className="mt-2 text-sm text-muted">{t("이름과 소개를 보고 사람들이 어떤 커뮤니티인지 알 수 있어요.")}</p>
          </div>
          <NameField value={draft.name} onChange={(name) => update({ name })} error={errors.name} />
          <div className="mt-4">
            <label htmlFor="community-description" className="mb-1 block text-sm font-semibold">
              {t("소개")} <span className="text-down" aria-hidden="true">*</span>
            </label>
            <textarea
              id="community-description"
              required
              rows={4}
              maxLength={DESCRIPTION_MAX}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              aria-invalid={!!errors.description}
              aria-describedby="community-description-count community-description-error"
              className="input resize-y"
              placeholder={t("어떤 이야기를 나누는 곳인지 알려 주세요.")}
            />
            <div className="mt-1 flex justify-between gap-2">
              <p id="community-description-error" className="field-error mt-0">{errors.description ?? ""}</p>
              <p id="community-description-count" className="shrink-0 text-xs text-muted">{draft.description.length}/{DESCRIPTION_MAX}</p>
            </div>
          </div>
          {error && <p role="alert" className="mt-3 rounded-2xl bg-down/10 px-4 py-3 text-sm font-medium text-down">{error}</p>}
          <Footer>
            <button type="submit" className="btn-primary px-6" disabled={busy || !NAME_PATTERN.test(draft.name) || !draft.description.trim()}>
              {busy ? t("만드는 중…") : t("커뮤니티 만들기")}
            </button>
          </Footer>
        </form>
      )}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex justify-end border-t border-line pt-4">{children}</div>;
}

/**
 * 커뮤니티 이름. 대문자는 소문자로, 쓸 수 없는 글자는 바로 지운다.
 * 형식이 맞으면 잠시 뒤 이미 있는 이름인지 확인해 알려 준다.
 */
function NameField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const t = useT();
  const [taken, setTaken] = useState<string | null>(null);

  useEffect(() => {
    setTaken(null);
    if (!NAME_PATTERN.test(value)) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      api.get(`/api/communities/${value}`).then(
        () => alive && setTaken(value),
        () => undefined, // 404 면 쓸 수 있는 이름
      );
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [value]);

  const message = error ?? (taken === value ? t("c/{name} 은(는) 이미 있어요. 다른 이름을 골라 주세요.", { name: value }) : "");
  return (
    <div>
      <label htmlFor="community-name" className="mb-1 block text-sm font-semibold">
        {t("커뮤니티 이름")} <span className="text-down" aria-hidden="true">*</span>
      </label>
      <div className={clsx("flex items-center rounded-lg border bg-surface focus-within:ring-2 focus-within:ring-accent/20", message ? "border-down" : "border-line focus-within:border-accent")}>
        <span className="pl-3 text-sm text-muted" aria-hidden="true">c/</span>
        <input
          id="community-name"
          required
          autoComplete="off"
          spellCheck={false}
          maxLength={NAME_MAX}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          aria-invalid={!!message}
          aria-describedby="community-name-hint community-name-error"
          className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none"
        />
        <span className="pr-3 text-xs text-muted">{value.length}/{NAME_MAX}</span>
      </div>
      <p id="community-name-error" role="status" className="field-error">{message}</p>
      <p id="community-name-hint" className="mt-1 text-xs text-muted">{t("영문 소문자 · 숫자 · 밑줄로 3~21자. 만든 뒤에는 바꿀 수 없어요.")}</p>
    </div>
  );
}
