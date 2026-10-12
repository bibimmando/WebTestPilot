import "@/styles/bugs-ui.css";

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { useBugBodyAttribute } from "@/hooks/useBugs";
import Index from "./pages/Index";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import About from "./pages/About";
import Cart from "./pages/Cart";
import Wishlist from "./pages/Wishlist";
import Checkout from "./pages/Checkout";
import OrderComplete from "./pages/OrderComplete";
import Orders from "./pages/Orders";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import InfoPageView from "./pages/InfoPage";
import InfoIndex from "./pages/InfoIndex";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 벤치마크 재현성: 자동 재시도가 있으면 실패 1건이 요청 4건이 되고
      // 실행마다 스텝 수와 소요시간이 달라진다. 재시도는 사용자가 누른다.
      retry: 0,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
  },
});

/** 켜진 버그를 <body data-bugs> 로 찍는다. CSS 로 만든 UI 버그가 여기에 걸린다.
 *  Provider 안쪽이어야 useQuery 를 쓸 수 있어서 컴포넌트로 뺐다. */
const BugAttribute = () => {
  useBugBodyAttribute();
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BugAttribute />
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/products" element={<Products />} />
          <Route path="/product/:slug" element={<ProductDetail />} />
          <Route path="/about" element={<About />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/order/:orderId" element={<OrderComplete />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/account" element={<Account />} />
          <Route path="/info" element={<InfoIndex />} />
          <Route path="/info/:slug" element={<InfoPageView />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
