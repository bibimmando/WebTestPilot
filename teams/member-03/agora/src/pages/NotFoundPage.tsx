import { useT } from "@/i18n";
import { Link } from "react-router-dom";

export function NotFoundCard({ title, detail }: { title: string; detail?: string }) {
  const t = useT();
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <p className="text-4xl font-extrabold text-accent">404</p>
      <h1 className="text-lg font-bold">{t(title)}</h1>
      {detail && <p className="text-sm text-muted">{t(detail)}</p>}
      <Link to="/" className="btn-primary">{t("홈으로")}</Link>
    </div>
  );
}

export function NotFoundPage() {
  const t = useT();
  return <NotFoundCard title={t("페이지를 찾을 수 없어요")} detail="주소가 바뀌었거나 없어진 페이지예요." />;
}
