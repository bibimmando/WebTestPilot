import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Package, ChevronRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { useMe } from "@/hooks/useAuth";
import { useOrders } from "@/hooks/useOrders";
import { useTitle } from "@/hooks/useTitle";

const Orders = () => {
  useTitle("주문 내역");
  const { isLoggedIn, isPending: authPending } = useMe();
  const {
    data,
    isPending: ordersPending,
    isError,
    error,
    refetch,
  } = useOrders(isLoggedIn);

  // 로그인 여부를 확인하는 동안
  if (authPending) {
    return (
      <Layout>
        <div
          className="container-full py-14 md:py-20"
          role="status"
          aria-busy="true"
          aria-label="불러오는 중"
        >
          <span className="sr-only">주문 내역을 불러오는 중입니다</span>
          <Skeleton className="h-12 w-64 mb-12 rounded-none" />
          <div className="space-y-6">
            <Skeleton className="h-40 w-full rounded-none" />
            <Skeleton className="h-40 w-full rounded-none" />
          </div>
        </div>
      </Layout>
    );
  }

  // 로그인하지 않은 경우
  if (!isLoggedIn) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Package className="w-16 h-16 mx-auto mb-6 text-muted-foreground/30" />
            <h1 className="font-serif text-4xl mb-4">Sign In to Continue</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              주문 내역은 로그인한 뒤에 확인하실 수 있습니다.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/login" state={{ from: "/orders" }}>
                Sign In
                <ArrowRight className="ml-3 w-4 h-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </Layout>
    );
  }

  const orders = data?.items ?? [];

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Orders</span>
        </div>
      </div>

      <section className="py-10 md:py-16">
        <div className="container-full">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="font-serif text-4xl md:text-5xl mb-12"
          >
            Orders
          </motion.h1>

          {ordersPending ? (
            <div role="status" aria-busy="true" aria-label="주문 내역을 불러오는 중">
              <span className="sr-only">주문 내역을 불러오는 중입니다</span>
              <div className="space-y-6">
                <Skeleton className="h-40 w-full rounded-none" />
                <Skeleton className="h-40 w-full rounded-none" />
              </div>
            </div>
          ) : isError ? (
            <ErrorState
              error={error}
              onRetry={() => refetch()}
              title="주문 내역을 불러오지 못했습니다"
            />
          ) : orders.length === 0 ? (
            <div className="py-20 text-center">
              <Package className="w-16 h-16 mx-auto mb-6 text-muted-foreground/30" />
              <p className="font-serif text-2xl text-muted-foreground mb-4">
                No orders yet
              </p>
              <p className="text-muted-foreground mb-8">
                아직 주문하신 내역이 없습니다.
              </p>
              <Button
                asChild
                variant="outline"
                className="rounded-none px-8 text-sm tracking-[0.1em] uppercase"
              >
                <Link to="/products">Start Shopping</Link>
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-8" aria-live="polite">
                {orders.length} {orders.length === 1 ? "order" : "orders"}
              </p>

              <div className="space-y-6">
                {orders.map((order, index) => {
                  const placedAt = new Date(order.createdAt);
                  const itemCount = order.items.reduce(
                    (sum, line) => sum + line.quantity,
                    0,
                  );
                  return (
                    <motion.article
                      key={order.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: index * 0.1 }}
                      className="border border-border hover:border-foreground/20 transition-colors duration-300"
                    >
                      <Link to={`/order/${order.id}`} className="block group">
                        {/* Header row */}
                        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-border bg-linen">
                          <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
                            <div>
                              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                                Order Number
                              </p>
                              <p className="font-serif text-lg">{order.id}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                                Placed On
                              </p>
                              <p className="text-sm">
                                {placedAt.toLocaleDateString("ko-KR")}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                                Total
                              </p>
                              <p className="font-serif text-lg">
                                ${order.total.toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <span className="flex items-center gap-2 text-xs tracking-[0.1em] uppercase text-muted-foreground group-hover:text-foreground transition-colors">
                            View Details
                            <ChevronRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                          </span>
                        </div>

                        {/* Items preview */}
                        <div className="flex items-center gap-4 px-6 py-6">
                          <div className="flex -space-x-3">
                            {order.items.slice(0, 4).map((line, i) =>
                              line.product ? (
                                <div
                                  key={line.product.id}
                                  className="w-16 h-20 overflow-hidden bg-muted/30 border border-background"
                                  style={{ zIndex: 4 - i }}
                                >
                                  <img
                                    src={line.product.images[0]}
                                    alt={line.product.name}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ) : null,
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-serif text-lg truncate">
                              {order.items[0]?.product?.name ?? "주문 상품"}
                              {order.items.length > 1 &&
                                ` 외 ${order.items.length - 1}건`}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {itemCount} {itemCount === 1 ? "piece" : "pieces"}
                            </p>
                          </div>
                        </div>
                      </Link>
                    </motion.article>
                  );
                })}
              </div>

              <Link
                to="/products"
                className="inline-flex items-center gap-2 mt-12 text-sm tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
                Continue Shopping
              </Link>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
};

export default Orders;
