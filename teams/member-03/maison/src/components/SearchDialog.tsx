import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { collections } from "@/data/products";

/**
 * 헤더의 검색. 아이콘을 누르면 열리고, 제출하면 /products?q= 로 간다.
 *
 * 검색 결과를 여기서 보여주지 않는 이유는 필터·정렬이 이미 상품 목록에
 * 있기 때문이다. 결과 화면을 따로 만들면 같은 기능이 두 벌이 된다.
 */
export const SearchDialog = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  // 닫을 때 입력을 비운다. 남겨 두면 다음에 열었을 때
  // 이전 검색어가 그대로 있어 새로 친 것처럼 보인다.
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const submit = (value: string) => {
    const q = value.trim();
    if (!q) return;
    setOpen(false);
    navigate(`/products?q=${encodeURIComponent(q)}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(term);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          aria-label="검색"
          className="relative p-2 hover:bg-accent transition-colors duration-300 group"
        >
          <Search className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
        </button>
      </DialogTrigger>

      <DialogContent className="rounded-none sm:max-w-xl p-0 gap-0">
        <div className="px-8 pt-10 pb-8">
          <DialogTitle className="text-[11px] font-semibold tracking-[0.3em] uppercase text-primary mb-5 text-center">
            Search
          </DialogTitle>
          <DialogDescription className="sr-only">
            상품 이름, 설명, 소재로 검색합니다.
          </DialogDescription>

          <form onSubmit={handleSubmit} className="flex gap-0">
            <label htmlFor="search-term" className="sr-only">
              검색어
            </label>
            <Input
              id="search-term"
              name="q"
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="상품 이름, 소재로 찾아보세요"
              className="rounded-none h-14 text-base border-r-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button
              type="submit"
              aria-label="검색 실행"
              className="rounded-none h-14 px-6 btn-premium"
            >
              <ArrowRight className="w-4 h-4" />
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-border">
            <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-4">
              Browse by Collection
            </p>
            <div className="flex flex-wrap gap-2">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/products?collection=${collection.slug}`);
                  }}
                  className="px-4 py-2 text-xs tracking-[0.1em] uppercase border border-border hover:bg-foreground hover:text-background transition-colors duration-300"
                >
                  {collection.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
