import { useT } from "@/i18n";
import { useId, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import type { ReportReason } from "@/lib/types";
import { Modal } from "./Modal";

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "spam", label: "스팸·광고", hint: "반복 게시, 홍보 링크" },
  { value: "harassment", label: "괴롭힘·혐오 표현", hint: "특정인을 겨냥한 공격, 차별 발언" },
  { value: "misinformation", label: "잘못된 정보", hint: "사실과 다른 내용을 퍼뜨림" },
  { value: "rule", label: "커뮤니티 규칙 위반", hint: "이 커뮤니티의 규칙을 어김" },
  { value: "other", label: "기타", hint: "직접 적어 주세요" },
];

const DETAIL_MIN = 10;
const DETAIL_MAX = 500;

/** 글·댓글 신고 창. 규칙 위반을 고르면 어떤 규칙인지, 기타를 고르면 이유를 적게 한다. */
export function ReportDialog({
  open,
  onClose,
  target,
  rules,
}: {
  open: boolean;
  onClose: () => void;
  target: { type: "post" | "comment"; id: string };
  rules: string[];
}) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="report-title" size="lg">
      {open && <ReportForm target={target} rules={rules} onClose={onClose} />}
    </Modal>
  );
}

function ReportForm({ target, rules, onClose }: { target: { type: "post" | "comment"; id: string }; rules: string[]; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const [reason, setReason] = useState<ReportReason | "">("");
  const [rule, setRule] = useState<number | null>(null);
  const [detail, setDetail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const isPost = target.type === "post";
  // 결함 U1: 제목을 정할 때 댓글 구분을 보지 않아 늘 '글 신고하기' 로 나온다 (신고 자체는 정상)
  const bugU1 = useBug("U1");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await api.post("/api/reports", { type: target.type, id: target.id, reason, rule, detail });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-up" />
        <h2 id="report-title" className="mt-3 text-xl font-bold">{t("신고가 접수됐어요")}</h2>
        <p className="mt-2 text-sm text-muted">{t("운영진이 확인하고 조치할게요. 알려 주셔서 고마워요.")}</p>
        <button type="button" className="btn-primary mt-6 w-full" onClick={onClose}>{t("닫기")}</button>
      </div>
    );
  }

  const detailLength = [...detail].length;
  return (
    <form onSubmit={submit} noValidate>
      <h2 id="report-title" className="text-xl font-bold">{t(isPost || bugU1 ? "글 신고하기" : "댓글 신고하기")}</h2>
      <p className="mt-1 text-sm text-muted">{t("어떤 문제가 있나요? 신고한 사람은 작성자에게 알려지지 않아요.")}</p>

      <fieldset className="mt-5" aria-describedby={errors.reason ? `${id}-reason-error` : undefined}>
        <legend className="sr-only">{t("신고 이유")}</legend>
        <div className="space-y-2">
          {REASONS.map((r) => (
            <label
              key={r.value}
              className={clsx(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors",
                reason === r.value ? "border-accent bg-accent-soft" : "border-line hover:bg-bg",
              )}
            >
              <input
                type="radio"
                name={`${id}-reason`}
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="mt-1 accent-[rgb(var(--accent))]"
              />
              <span>
                <span className="block text-sm font-semibold">{t(r.label)}</span>
                <span className="block text-xs text-muted">{t(r.hint)}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.reason && <p id={`${id}-reason-error`} className="field-error">{errors.reason}</p>}
      </fieldset>

      {reason === "rule" && (
        <div className="mt-4">
          <label htmlFor={`${id}-rule`} className="mb-1 block text-sm font-semibold">{t("어긴 규칙")}</label>
          <select
            id={`${id}-rule`}
            value={rule ?? ""}
            onChange={(e) => setRule(e.target.value === "" ? null : Number(e.target.value))}
            className="input"
            aria-invalid={!!errors.rule}
            aria-describedby={errors.rule ? `${id}-rule-error` : undefined}
          >
            <option value="">{t("규칙을 고르세요")}</option>
            {rules.map((r, i) => (
              <option key={r} value={i}>{i + 1}. {r}</option>
            ))}
          </select>
          {errors.rule && <p id={`${id}-rule-error`} className="field-error">{errors.rule}</p>}
        </div>
      )}

      {reason && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor={`${id}-detail`} className="text-sm font-semibold">
              {t("자세한 내용")} {reason === "other" ? <span className="text-down">*</span> : <span className="font-normal text-muted">{t("(선택)")}</span>}
            </label>
            <span className={clsx("text-xs", detailLength > DETAIL_MAX ? "text-down" : "text-muted")}>{detailLength}/{DETAIL_MAX}</span>
          </div>
          <textarea
            id={`${id}-detail`}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            className="input resize-y"
            placeholder={reason === "other" ? t("무엇이 문제인지 {n}자 이상 적어 주세요", { n: DETAIL_MIN }) : t("운영진이 참고할 내용이 있으면 적어 주세요")}
            aria-invalid={!!errors.detail}
            aria-describedby={errors.detail ? `${id}-detail-error` : undefined}
          />
          {errors.detail && <p id={`${id}-detail-error`} className="field-error">{errors.detail}</p>}
        </div>
      )}

      {formError && <p role="alert" className="mt-4 rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>{t("취소")}</button>
        <button type="submit" className="btn-danger" disabled={busy || !reason}>{t("신고하기")}</button>
      </div>
    </form>
  );
}
