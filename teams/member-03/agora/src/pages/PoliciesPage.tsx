import { NavLink, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { POLICY_LINKS } from "@/components/SiteFooter";
import { NotFoundPage } from "./NotFoundPage";

/** 정책마다 짧은 요약. 이 사이트는 시험용이라 실제 서비스 약관이 아니다. */
const BODY: Record<string, string[]> = {
  rules: [
    "다른 사람을 존중해 주세요. 괴롭힘, 혐오 표현, 개인 공격은 지워질 수 있어요.",
    "남의 개인정보(전화번호, 주소, 실명 등)를 올리지 마세요.",
    "커뮤니티마다 따로 정한 규칙도 지켜 주세요. 운영진이 글을 내리거나 활동을 정지할 수 있어요.",
    "광고, 도배, 투표 조작은 금지예요.",
  ],
  privacy: [
    "가입할 때 아이디와 비밀번호, 고르면 전화번호나 이메일, 성별, 관심 항목을 받아요.",
    "관심 항목은 커뮤니티 추천에만 쓰고, 성별은 다른 사람에게 보이지 않아요.",
    "최근 본 글은 서버가 아니라 이 브라우저에만 남아요.",
    "이 사이트의 자료는 서버를 다시 시작하면 처음 상태로 돌아가요.",
  ],
  terms: [
    "Agora 는 기능 시험을 위해 만든 사이트예요. 실제 서비스가 아니에요.",
    "올린 글과 댓글의 책임은 쓴 사람에게 있어요.",
    "규칙을 어기면 글이 지워지거나 활동이 정지될 수 있어요.",
  ],
  accessibility: [
    "모든 기능을 키보드로 쓸 수 있게 만들었어요. 대화 상자 안에서는 Tab 이 대화 상자 안에서만 돌아요.",
    "이미지에는 대체 텍스트를 붙이고, 버튼과 입력 칸에는 화면 낭독기가 읽을 이름을 달았어요.",
    "화면 언어는 머리글의 언어 메뉴에서 한국어와 영어 중에 고를 수 있어요.",
  ],
};

/** /policies/:doc  사이트 정책 */
export function PoliciesPage() {
  const t = useT();
  const { doc = "" } = useParams();
  const current = POLICY_LINKS.find((l) => l.id === doc);
  if (!current) return <NotFoundPage />;

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav aria-label={t("사이트 정책")} className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col">
        {POLICY_LINKS.map((l) => (
          <NavLink
            key={l.id}
            to={`/policies/${l.id}`}
            className={({ isActive }) =>
              clsx("shrink-0 rounded-lg px-3 py-2 text-sm", isActive ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink hover:bg-surface")
            }
          >
            {t(l.label)}
          </NavLink>
        ))}
      </nav>
      <article className="card min-w-0 flex-1 p-6">
        <h1 className="mb-4 text-2xl font-bold">{t(current.label)}</h1>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {BODY[current.id].map((line) => (
            <li key={line}>{t(line)}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}
