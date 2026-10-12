import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, ChevronLeft, ChevronRight, ArrowRight, ShoppingBag } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ProductCard } from "@/components/ProductCard";
import { QuantitySelector } from "@/components/QuantitySelector";
import { collections } from "@/data/products";
import { useWishlist } from "@/hooks/useWishlist";
import { useCart } from "@/hooks/useCart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useTitle } from "@/hooks/useTitle";
import { useBug } from "@/hooks/useBugs";
import { useRelatedLinkBug } from "@/bugs/routing/useRoutingBugs";
import { useProduct, useRelatedProducts } from "@/hooks/useProducts";
import { ApiError } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";
import { ProductGridSkeleton } from "@/components/ProductGridSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** N1 이 연관 상품 링크를 보내는 곳. 상품 13개가 고정된 시드 데이터라
 *  어느 컬렉션에도 속하지 않는 값을 쓰지 않고 실재하는 상품을 지정한다.
 *  arc-pendant-light(lighting) 의 연관 상품과 다른 컬렉션이어야 한다. */
const N1_WRONG_TARGET = "harvest-dining-table";

const ProductDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const { addItem: addToWishlist, removeItem: removeFromWishlist, isInWishlist } = useWishlist();
  const { addItem: addToCart } = useCart();
  const { toast } = useToast();
  const bugF2 = useBug("F2");

  // 상세와 연관 상품은 별개 요청이다. 한쪽만 실패할 수 있다.
  const shiftRelatedLinks = useRelatedLinkBug();   // N1

  const { data: product, isPending, isError, error, refetch } = useProduct(slug);
  const {
    data: related,
    isPending: relatedPending,
    isError: relatedError,
  } = useRelatedProducts(slug);

  // 라우터는 slug 만 바뀔 때 이 컴포넌트를 다시 만들지 않는다.
  // 직접 되돌리지 않으면 이전 상품의 이미지 인덱스가 남는다.
  useEffect(() => {
    setCurrentImageIndex(0);
    setQuantity(1);
  }, [slug]);

  useTitle(
    isPending ? "불러오는 중" : product ? product.name : "상품을 찾을 수 없습니다"
  );

  if (isPending) {
    return (
      <Layout>
        <div
          className="container-full py-10 md:py-16"
          role="status"
          aria-busy="true"
          aria-label="상품을 불러오는 중"
        >
          <span className="sr-only">상품 정보를 불러오는 중입니다</span>
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-20">
            <div className="lg:col-span-7">
              <Skeleton className="aspect-[4/5] w-full rounded-none" />
            </div>
            <div className="lg:col-span-5 space-y-5">
              <Skeleton className="h-3 w-24 rounded-none" />
              <Skeleton className="h-12 w-3/4 rounded-none" />
              <Skeleton className="h-8 w-28 rounded-none" />
              <Skeleton className="h-24 w-full rounded-none" />
              <Skeleton className="h-14 w-full rounded-none" />
              <Skeleton className="h-14 w-full rounded-none" />
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
            title="상품을 불러오지 못했습니다"
          />
        </div>
      </Layout>
    );
  }

  if (!product) {
    return (
      <Layout>
        <div className="container-wide py-28 text-center">
          <h1 className="font-serif text-4xl mb-4">Product Not Found</h1>
          <p className="text-muted-foreground mb-8">
            The piece you're looking for doesn't exist.
          </p>
          <Button asChild className="rounded-none px-8 text-sm tracking-[0.1em] uppercase">
            <Link to="/products">Browse All Products</Link>
          </Button>
        </div>
      </Layout>
    );
  }

  const inWishlist = isInWishlist(product.id);
  const relatedItems = related?.items ?? [];
  // N1: 보이는 내용은 그대로 두고 링크의 slug 만 바꾼다. 카드에 적힌
  // 이름과 도착한 페이지의 제목을 맞춰봐야만 드러난다.
  //
  // 연관 상품끼리 돌리지 않는 이유: 같은 컬렉션에서 자기를 뺀 것이
  // 연관 상품인데 컬렉션마다 상품이 최대 2개라 항상 1건이다. 1건짜리
  // 목록을 회전하면 제자리가 되어 아무 일도 일어나지 않는다.
  //
  // 지금 상품을 가리키게 하는 방법도 안 된다. URL 이 같아 라우터가 다시
  // 그리지 않으므로 "눌러도 반응 없음"으로 보이고, 목적지가 틀린 것과
  // 구분되지 않는다. 다른 컬렉션의 상품으로 보내야 이동이 실제로 일어난다.
  const relatedProducts = shiftRelatedLinks
    ? relatedItems.map((item) => ({ ...item, slug: N1_WRONG_TARGET }))
    : relatedItems;
  const collection = collections.find((c) => c.id === product.collection);

  const handleWishlistToggle = () => {
    if (inWishlist) {
      removeFromWishlist(product.id);
      toast({
        title: "Removed from wishlist",
        description: `${product.name} has been removed from your wishlist.`,
      });
    } else {
      addToWishlist(product);
      toast({
        title: "Added to wishlist",
        description: `${product.name} has been saved to your wishlist.`,
      });
    }
  };

  const handleAddToCart = () => {
    // F2: 담기를 건너뛰고 성공 토스트만 띄운다.
    if (!bugF2) addToCart(product, quantity);
    toast({
      title: "Added to bag",
      description: `${quantity} × ${product.name} added to your bag.`,
    });
    setQuantity(1);
  };

  const nextImage = () => {
    setCurrentImageIndex((prev) =>
      prev === product.images.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) =>
      prev === 0 ? product.images.length - 1 : prev - 1
    );
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link
            to="/products"
            className="hover:text-foreground transition-colors"
          >
            Shop
          </Link>
          <span className="text-border">/</span>
          {collection && (
            <>
              <Link
                to={`/products?collection=${collection.slug}`}
                className="hover:text-foreground transition-colors"
              >
                {collection.name}
              </Link>
              <span className="text-border">/</span>
            </>
          )}
          <span className="text-foreground">{product.name}</span>
        </div>
      </div>

      {/* Product Content */}
      <section className="py-10 md:py-16">
        <div className="container-full">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-20">
            {/* Image Gallery — Takes 7 columns */}
            <div className="lg:col-span-7 space-y-4">
              {/* Main Image */}
              <div className="relative aspect-[4/5] overflow-hidden bg-muted/30 group cursor-zoom-in">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentImageIndex}
                    src={product.images[currentImageIndex]}
                    alt={product.name}
                    initial={{ opacity: 0, scale: 1.02 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }}
                    className="w-full h-full object-cover transition-transform duration-[1.5s] ease-out group-hover:scale-105"
                  />
                </AnimatePresence>

                {product.images.length > 1 && (
                  <>
                    <button
                      onClick={prevImage}
                      className="absolute left-5 top-1/2 -translate-y-1/2 p-3 bg-background/90 backdrop-blur-md hover:bg-background transition-all duration-300 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={nextImage}
                      className="absolute right-5 top-1/2 -translate-y-1/2 p-3 bg-background/90 backdrop-blur-md hover:bg-background transition-all duration-300 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>

                    {/* Image counter */}
                    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-2">
                      {product.images.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setCurrentImageIndex(index)}
                          className={cn(
                            "w-8 h-0.5 transition-all duration-500",
                            index === currentImageIndex
                              ? "bg-foreground"
                              : "bg-foreground/20 hover:bg-foreground/40"
                          )}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Badges */}
                <div className="absolute top-5 left-5 flex flex-col gap-2">
                  {product.new && (
                    <span className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.2em] uppercase bg-foreground text-background">
                      New
                    </span>
                  )}
                </div>
              </div>

              {/* Thumbnail strip */}
              {product.images.length > 1 && (
                <div className="flex gap-3">
                  {product.images.map((image, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={cn(
                        "w-24 h-24 overflow-hidden transition-all duration-300",
                        index === currentImageIndex
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                          : "opacity-60 hover:opacity-100"
                      )}
                    >
                      <img
                        src={image}
                        alt={`${product.name} view ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info — Takes 5 columns */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const }}
              className="lg:col-span-5 lg:sticky lg:top-28 lg:self-start"
            >
              {collection && (
                <Link
                  to={`/products?collection=${collection.slug}`}
                  className="inline-block text-[11px] font-semibold tracking-[0.3em] uppercase text-primary mb-5 hover:text-primary/80 transition-colors"
                >
                  {collection.name}
                </Link>
              )}

              <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl text-foreground mb-5 leading-[1.05]">
                {product.name}
              </h1>

              <p className="text-2xl font-serif text-foreground mb-8">
                ${product.price.toLocaleString()}
              </p>

              <div className="w-12 h-px bg-border mb-8" />

              <p className="text-muted-foreground leading-[1.8] mb-10">
                {product.longDescription}
              </p>

              {/* Details */}
              <div className="space-y-5 mb-10 pb-10 border-b border-border">
                <div>
                  <span className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-1.5">
                    Materials
                  </span>
                  <span className="text-sm text-foreground">{product.materials}</span>
                </div>
                {product.dimensions && (
                  <div>
                    <span className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-1.5">
                      Dimensions
                    </span>
                    <span className="text-sm text-foreground">{product.dimensions}</span>
                  </div>
                )}
              </div>

              {/* Quantity Selector */}
              <div className="mb-6">
                <span className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground block mb-3">
                  Quantity
                </span>
                <QuantitySelector
                  quantity={quantity}
                  onQuantityChange={setQuantity}
                />
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <Button
                  size="lg"
                  onClick={handleAddToCart}
                  className="rounded-none w-full py-6 text-sm tracking-[0.15em] uppercase btn-premium"
                >
                  <ShoppingBag className="w-4 h-4 mr-3" />
                  Add to Bag
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-none w-full py-6 text-sm tracking-[0.1em] uppercase"
                  onClick={handleWishlistToggle}
                >
                  <Heart
                    className={cn(
                      "w-4 h-4 mr-3 transition-all duration-300",
                      inWishlist && "fill-primary text-primary"
                    )}
                  />
                  {inWishlist ? "Saved to Wishlist" : "Add to Wishlist"}
                </Button>
              </div>

              {/* Trust signals */}
              <div className="mt-10 pt-8 border-t border-border grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.15em] uppercase text-muted-foreground/60 mb-1">
                    Shipping
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Complimentary worldwide
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.15em] uppercase text-muted-foreground/60 mb-1">
                    Returns
                  </p>
                  <p className="text-xs text-muted-foreground">
                    14-day return policy
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Related Products */}
      {(relatedPending || relatedError || relatedProducts.length > 0) && (
        <section className="py-20 md:py-28 bg-linen">
          <div className="container-full">
            <div className="flex items-end justify-between mb-12">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.3em] uppercase text-primary mb-3">
                  You May Also Like
                </p>
                <h2 className="font-serif text-3xl md:text-4xl text-foreground">
                  More from {collection?.name}
                </h2>
              </div>
              <Link
                to={`/products?collection=${collection?.slug}`}
                className="hidden md:flex items-center gap-2 text-sm tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                View All
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            {relatedPending ? (
              <ProductGridSkeleton
                count={4}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-10"
              />
            ) : relatedError ? (
              /* 보조 영역이라 페이지 전체를 막지는 않지만, 실패를 숨기지도 않는다. */
              <p role="alert" className="text-sm text-muted-foreground">
                연관 상품을 불러오지 못했습니다.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-10">
                {relatedProducts.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </Layout>
  );
};

export default ProductDetail;
