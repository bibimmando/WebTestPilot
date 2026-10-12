import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Heart, ShoppingBag, Trash2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { ProductCard } from "@/components/ProductCard";
import { useWishlist } from "@/hooks/useWishlist";
import { useCart } from "@/hooks/useCart";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTitle } from "@/hooks/useTitle";
import { useBug } from "@/hooks/useBugs";

const Wishlist = () => {
  useTitle("위시리스트");
  const { items, clearWishlist } = useWishlist();
  const bugF1 = useBug("F1");
  const { addItem: addToCart } = useCart();
  const { toast } = useToast();

  const handleAddAllToCart = () => {
    items.forEach((product) => addToCart(product, 1));
    toast({
      title: "Added to bag",
      description: `${items.length} ${
        items.length === 1 ? "piece" : "pieces"
      } moved to your bag.`,
    });
  };

  const handleClear = () => {
    const count = items.length;
    clearWishlist();
    toast({
      title: "Wishlist cleared",
      description: `${count} ${count === 1 ? "piece" : "pieces"} removed.`,
    });
  };

  if (items.length === 0) {
    return (
      <Layout>
        <div className="container-narrow py-28 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Heart className="w-16 h-16 mx-auto mb-6 text-muted-foreground/30" />
            <h1 className="font-serif text-4xl mb-4">Your Wishlist is Empty</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Save the pieces you love as you browse. They'll be waiting here
              whenever you return.
            </p>
            <Button
              asChild
              size="lg"
              className="rounded-none px-10 py-6 text-sm tracking-[0.15em] uppercase btn-premium"
            >
              <Link to="/products">
                Start Shopping
                <ArrowRight className="ml-3 w-4 h-4" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="container-full py-6 border-b border-border">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Link to="/products" className="hover:text-foreground transition-colors">
            Shop
          </Link>
          <span className="text-border">/</span>
          <span className="text-foreground">Wishlist</span>
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
            Wishlist
          </motion.h1>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {items.length} {items.length === 1 ? "piece" : "pieces"} saved
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddAllToCart}
                className="rounded-none px-5 text-xs tracking-[0.1em] uppercase"
              >
                <ShoppingBag className="w-4 h-4 mr-2" />
                Add All to Bag
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClear}
                className="rounded-none px-5 text-xs tracking-[0.1em] uppercase text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            </div>
          </div>

          {/* Saved pieces — 카탈로그와 같은 카드를 쓴다.
              카드의 하트가 이미 채워진 상태이고, 누르면 목록에서 빠진다. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-10">
            {/* F1: 목록만 마지막 항목을 빠뜨린다. 하트와 카운트는 정상. */}
            {(bugF1 ? items.slice(0, -1) : items).map((product, index) => (
              <ProductCard key={product.id} product={product} index={index} />
            ))}
          </div>

          <Link
            to="/products"
            className="inline-flex items-center gap-2 mt-12 text-sm tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
            Continue Shopping
          </Link>
        </div>
      </section>
    </Layout>
  );
};

export default Wishlist;
