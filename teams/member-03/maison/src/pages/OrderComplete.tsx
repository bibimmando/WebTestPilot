import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useOrder } from "@/hooks/useOrder";
import { ApiError } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTitle } from "@/hooks/useTitle";

const OrderComplete = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { data: order, isPending, isError, error, refetch } = useOrder(orderId);

  useTitle(order ? `주문 ${order.id}` : "주문 확인");

  if (isPending) {
    return (
      <Layout>
        <div
          className="container-full py-10 md:py-16"
          role="status"
          aria-busy="true"
          aria-label="주문을 불러오는 중"
        >
          <span className="sr-only">주문 정보를 불러오는 중입니다</span>
          <div className="max-w-md mx-auto text-center mb-12 space-y-4">
            <Skeleton className="w-16 h-16 mx-auto rounded-full" />
            <Skeleton className="h-10 w-3/4 mx-auto rounded-none" />
            <Skeleton className="h-4 w-1/2 mx-auto rounded-none" />
          </div>
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
            <div className="lg:col-span-7 space-y-6">
              <Skeleton className="h-32 w-full rounded-none" />
              <Skeleton className="h-32 w-full rounded-none" />
            </div>
            <div className="lg:col-span-5">
              <Skeleton className="h-72 w-full rounded-none" />
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
        <div className="container-wide">
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            title="주문을 불러오지 못했습니다"
          />
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="font-serif text-4xl mb-4">Order Not Found</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              주문번호 {orderId} 로 접수된 주문이 없습니다. 주문번호를 다시
              확인해 주세요.
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

  const placedAt = new Date(order.createdAt);
  const customerName = [order.customer.firstName, order.customer.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Order {order.id}</span>
        </div>
      </div>

      <section className="py-10 md:py-16">
        <div className="container-full">
          {/* Confirmation header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-xl mx-auto text-center mb-14"
          >
            <CheckCircle2 className="w-16 h-16 mx-auto mb-6 text-primary" />
            <h1 className="font-serif text-4xl md:text-5xl mb-4">Thank You</h1>
            <p className="text-muted-foreground mb-6">
              주문이 접수되었습니다. 확인 후 연락드리겠습니다.
            </p>
            <div className="inline-flex flex-col sm:flex-row items-center gap-x-8 gap-y-2 px-8 py-5 bg-linen">
              <div className="text-center sm:text-left">
                <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                  Order Number
                </p>
                <p className="font-serif text-xl">{order.id}</p>
              </div>
              <span className="hidden sm:block w-px h-10 bg-border" />
              <div className="text-center sm:text-left">
                <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                  Placed On
                </p>
                <p className="text-sm">
                  {placedAt.toLocaleDateString("ko-KR")}{" "}
                  {placedAt.toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </motion.div>

          <div className="grid lg:grid-cols-12 gap-12 lg:gap-16">
            {/* Ordered Items */}
            <div className="lg:col-span-7">
              <h2 className="font-serif text-2xl mb-6">Your Order</h2>
              <div className="space-y-0">
                {order.items.map((line, index) => (
                  <motion.div
                    key={line.product?.id ?? index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="flex gap-6 py-8 border-b border-border"
                  >
                    {line.product ? (
                      <>
                        <Link
                          to={`/product/${line.product.slug}`}
                          className="w-28 h-32 md:w-36 md:h-44 flex-shrink-0 overflow-hidden bg-muted/30 group"
                        >
                          <img
                            src={line.product.images[0]}
                            alt={line.product.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        </Link>
                        <div className="flex-1 flex flex-col">
                          <div className="flex-1">
                            <Link
                              to={`/product/${line.product.slug}`}
                              className="font-serif text-lg md:text-xl hover:text-primary transition-colors"
                            >
                              {line.product.name}
                            </Link>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {line.product.description}
                            </p>
                            <p className="font-serif text-lg mt-3">
                              ${line.product.price.toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center justify-between mt-4">
                            <span className="text-sm text-muted-foreground tracking-[0.1em] uppercase">
                              Qty {line.quantity}
                            </span>
                            <span className="font-serif text-lg">
                              ${line.lineTotal.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      /* 주문 후 상품이 사라진 경우. 수량과 금액은 주문에 남아 있다. */
                      <p className="text-sm text-muted-foreground py-4">
                        더 이상 판매하지 않는 상품 · Qty {line.quantity}
                      </p>
                    )}
                  </motion.div>
                ))}
              </div>

              <Link
                to="/products"
                className="inline-flex items-center gap-2 mt-8 text-sm tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
                Continue Shopping
              </Link>
            </div>

            {/* Summary & Delivery */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="lg:col-span-5"
            >
              <div className="bg-linen p-8 lg:sticky lg:top-28">
                <h2 className="font-serif text-2xl mb-8">Order Summary</h2>

                <div className="space-y-4 mb-8">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>${order.subtotal.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Shipping</span>
                    <span>
                      {order.shipping === 0
                        ? "Complimentary"
                        : `$${order.shipping}`}
                    </span>
                  </div>
                </div>

                <div className="border-t border-border pt-4 mb-8">
                  <div className="flex justify-between font-serif text-xl">
                    <span>Total</span>
                    <span>${order.total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="border-t border-border pt-6">
                  <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-3">
                    Delivery To
                  </p>
                  <address className="not-italic text-sm text-muted-foreground leading-[1.8]">
                    {customerName && (
                      <span className="block text-foreground">
                        {customerName}
                      </span>
                    )}
                    {order.customer.address && (
                      <span className="block">{order.customer.address}</span>
                    )}
                    {(order.customer.city || order.customer.postalCode) && (
                      <span className="block">
                        {[order.customer.city, order.customer.postalCode]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    )}
                    {order.customer.country && (
                      <span className="block">{order.customer.country}</span>
                    )}
                    {order.customer.email && (
                      <span className="block mt-2">{order.customer.email}</span>
                    )}
                  </address>
                </div>

                <div className="mt-8 pt-6 border-t border-border grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.15em] uppercase text-muted-foreground/60 mb-1">
                      Shipping
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Worldwide delivery
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold tracking-[0.15em] uppercase text-muted-foreground/60 mb-1">
                      Returns
                    </p>
                    <p className="text-xs text-muted-foreground">
                      14-day policy
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default OrderComplete;
