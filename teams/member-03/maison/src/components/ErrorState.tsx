import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "서버에 연결할 수 없습니다.";
    if (error.status === 404) return "요청한 자료를 찾을 수 없습니다.";
    if (error.status >= 500) return "서버에서 오류가 발생했습니다.";
    return `요청이 거부되었습니다 (${error.status} ${error.code}).`;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

/**
 * 요청 실패를 화면에 드러낸다.
 *
 * role=alert 로 접근성 트리에 남겨, 실패했는데 조용히 빈 화면만 보이는
 * 상황과 구분되게 한다.
 */
export const ErrorState = ({
  error,
  onRetry,
  title = "불러오지 못했습니다",
}: ErrorStateProps) => (
  <div role="alert" className="py-20 text-center">
    <AlertTriangle className="w-8 h-8 mx-auto mb-5 text-destructive" />
    <p className="font-serif text-2xl text-foreground mb-3">{title}</p>
    <p className="text-muted-foreground mb-8">{describe(error)}</p>
    {onRetry && (
      <Button
        variant="outline"
        onClick={onRetry}
        className="rounded-none px-8 text-sm tracking-[0.1em] uppercase"
      >
        <RotateCw className="w-4 h-4 mr-3" />
        다시 시도
      </Button>
    )}
  </div>
);
