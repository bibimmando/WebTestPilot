import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useInfoPages, type InfoPageSummary } from "@/hooks/useInfoPage";
import { useTitle } from "@/hooks/useTitle";

const PAGE_TITLE = "Customer Care";

/** eyebrow 값으로 묶는다. 목록을 따로 관리하지 않으므로
 *  안내 페이지를 추가해도 이 화면은 고칠 필요가 없다. */
function groupByEyebrow(items: InfoPageSummary[]) {
  const groups: { label: string; items: InfoPageSummary[] }[] = [];
  for (const item of items) {
    const found = groups.find((g) => g.label === item.eyebrow);
    if (found) found.items.push(item);
    else groups.push({ label: item.eyebrow, items: [item] });
  }
  return groups;
}

const InfoIndex = () => {
  useTitle(PAGE_TITLE);
  const { data, isPending, isError, error, refetch } = useInfoPages();

  const groups = groupByEyebrow(data?.items ?? []);

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">{PAGE_TITLE}</span>
        </div>
      </div>

      <section className="py-16 md:py-24">
        <div className="container-narrow">
          <div className="max-w-2xl mx-auto">
            <motion.header
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mb-16 text-center"
            >
              <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-primary mb-5">
                Support
              </p>
              <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6 leading-[1.05]">
                {PAGE_TITLE}
              </h1>
              <div className="w-12 h-px bg-border mx-auto mb-6" />
              <p className="text-muted-foreground leading-[1.9]">
                주문·배송·반품과 제품 관리에 대한 안내입니다.
              </p>
            </motion.header>

            {isPending ? (
              <div role="status" aria-busy="true" aria-label="안내 목록을 불러오는 중">
                <span className="sr-only">안내 목록을 불러오는 중입니다</span>
                <div className="space-y-10">
                  {[0, 1].map((g) => (
                    <div key={g} className="space-y-0">
                      <Skeleton className="h-3 w-20 mb-4 rounded-none" />
                      {[0, 1, 2].map((i) => (
                        <Skeleton
                          key={i}
                          className="h-24 w-full mb-px rounded-none"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : isError ? (
              <ErrorState
                error={error}
                onRetry={() => refetch()}
                title="안내 목록을 불러오지 못했습니다"
              />
            ) : (
              <div className="space-y-14">
                {groups.map((group, gi) => (
                  <motion.section
                    key={group.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: gi * 0.08 }}
                  >
                    <h2 className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-5">
                      {group.label}
                    </h2>

                    <div className="border border-border">
                      {group.items.map((item, i) => (
                        <Link
                          key={item.slug}
                          to={`/info/${item.slug}`}
                          className={`group flex items-start gap-6 px-6 py-6 transition-colors duration-300 hover:bg-linen ${
                            i > 0 ? "border-t border-border" : ""
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-serif text-xl text-foreground transition-colors duration-300 group-hover:text-primary mb-2">
                              {item.title}
                            </p>
                            <p className="text-sm text-muted-foreground leading-[1.8]">
                              {item.intro}
                            </p>
                          </div>
                          <ChevronRight className="w-5 h-5 mt-1 flex-shrink-0 text-muted-foreground/50 transition-all duration-300 group-hover:text-foreground group-hover:translate-x-1" />
                        </Link>
                      ))}
                    </div>
                  </motion.section>
                ))}
              </div>
            )}

            <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                찾으시는 내용이 없으신가요?
              </p>
              <a
                href="mailto:hello@maison.com"
                className="inline-flex items-center gap-2 text-sm tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                Contact Us
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default InfoIndex;
