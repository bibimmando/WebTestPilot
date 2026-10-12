import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ErrorState } from "@/components/ErrorState";
import { ApiError } from "@/lib/api";
import { useInfoPage, type InfoSection } from "@/hooks/useInfoPage";
import { useTitle } from "@/hooks/useTitle";

const Section = ({ section, index }: { section: InfoSection; index: number }) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    // 상품 그리드와 달리 whileInView 를 쓰지 않는다. 글 중심 페이지는
    // 본문 대부분이 첫 화면 아래에 있어서, 스크롤해야 보이게 만들면
    // 스크롤하지 않고 관찰하는 쪽(크롤러·스크린샷)에 빈 문서로 보인다.
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, delay: Math.min(index, 6) * 0.05 }}
    className="pb-12 mb-12 border-b border-border last:border-0 last:mb-0 last:pb-0"
  >
    <h2 className="font-serif text-2xl md:text-3xl text-foreground mb-6">
      {section.heading}
    </h2>

    {section.body?.map((paragraph, i) => (
      <p key={i} className="text-muted-foreground leading-[1.9] mb-4 last:mb-0">
        {paragraph}
      </p>
    ))}

    {section.rows && (
      <dl className="mt-6 border-t border-border">
        {section.rows.map((row) => (
          <div
            key={row.label}
            className="grid sm:grid-cols-3 gap-2 sm:gap-6 py-4 border-b border-border"
          >
            <dt className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
              {row.label}
            </dt>
            <dd className="sm:col-span-2 text-sm text-foreground leading-[1.8]">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    )}

    {section.bullets && (
      <ul className="mt-6 space-y-3">
        {section.bullets.map((item, i) => (
          <li key={i} className="flex gap-4 text-muted-foreground leading-[1.8]">
            <span className="w-4 h-px bg-border mt-[0.85em] flex-shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    )}

    {section.qa && (
      <Accordion type="single" collapsible className="mt-2">
        {section.qa.map((pair, i) => (
          <AccordionItem key={i} value={`${section.heading}-${i}`}>
            <AccordionTrigger className="text-left font-serif text-lg hover:no-underline hover:text-primary transition-colors">
              {pair.q}
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground leading-[1.9] pb-6">
              {pair.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    )}
  </motion.section>
);

const InfoPageView = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isPending, isError, error, refetch } = useInfoPage(slug);

  useTitle(isPending ? "불러오는 중" : page ? page.title : "페이지를 찾을 수 없습니다");

  if (isPending) {
    return (
      <Layout>
        <div
          className="container-narrow py-20 md:py-28"
          role="status"
          aria-busy="true"
          aria-label="페이지를 불러오는 중"
        >
          <span className="sr-only">페이지를 불러오는 중입니다</span>
          <div className="max-w-2xl mx-auto space-y-5">
            <Skeleton className="h-3 w-20 rounded-none" />
            <Skeleton className="h-12 w-2/3 rounded-none" />
            <Skeleton className="h-4 w-full rounded-none" />
            <div className="pt-10 space-y-4">
              <Skeleton className="h-8 w-1/3 rounded-none" />
              <Skeleton className="h-24 w-full rounded-none" />
              <Skeleton className="h-8 w-1/3 rounded-none" />
              <Skeleton className="h-24 w-full rounded-none" />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const notFound = error instanceof ApiError && error.status === 404;

  if (isError && !notFound) {
    return (
      <Layout>
        <div className="container-narrow">
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            title="페이지를 불러오지 못했습니다"
          />
        </div>
      </Layout>
    );
  }

  if (!page) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-serif text-4xl mb-4">Page Not Found</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              찾으시는 안내 페이지가 없습니다.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/products">
                Continue Shopping
                <ArrowRight className="ml-3 w-4 h-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </Layout>
    );
  }

  const updated = new Date(page.updatedAt);

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          {/* 가운데 조각은 그 링크가 가는 페이지(/info)의 제목을 그대로 쓴다.
              상품 상세의 "Shop / Lighting / 상품명" 과 같은 규칙이다. */}
          <Link to="/info" className="hover:text-foreground transition-colors">
            Customer Care
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">{page.title}</span>
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
                {page.eyebrow}
              </p>
              <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6 leading-[1.05]">
                {page.title}
              </h1>
              <div className="w-12 h-px bg-border mx-auto mb-6" />
              <p className="text-muted-foreground leading-[1.9]">{page.intro}</p>
            </motion.header>

            {page.sections.map((section, i) => (
              <Section key={section.heading} section={section} index={i} />
            ))}

            <div className="mt-16 pt-8 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
              <p className="text-xs text-muted-foreground/60 tracking-[0.05em]">
                Last updated {updated.toLocaleDateString("ko-KR")}
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

export default InfoPageView;
