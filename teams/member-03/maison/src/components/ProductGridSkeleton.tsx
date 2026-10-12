import { Skeleton } from "@/components/ui/skeleton";

interface ProductGridSkeletonProps {
  count?: number;
  className?: string;
}

/**
 * 목록을 받아오는 동안 자리를 채운다.
 *
 * role=status + aria-busy 를 붙여 접근성 트리에 "불러오는 중" 노드가
 * 남게 한다. 이게 없으면 로딩 상태가 스크린리더와 크롤러 양쪽에
 * 보이지 않는다.
 */
export const ProductGridSkeleton = ({
  count = 8,
  className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10",
}: ProductGridSkeletonProps) => (
  <div role="status" aria-busy="true" aria-label="상품을 불러오는 중">
    <span className="sr-only">상품을 불러오는 중입니다</span>
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="aspect-[3/4] w-full rounded-none" />
          <Skeleton className="h-3 w-20 rounded-none" />
          <Skeleton className="h-5 w-3/4 rounded-none" />
          <Skeleton className="h-4 w-16 rounded-none" />
        </div>
      ))}
    </div>
  </div>
);
