import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { collections } from "@/data/products";
import { api, ApiError } from "@/lib/api";

export const Footer = () => {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  // onSubmit 이 없으면 브라우저 기본 동작으로 페이지가 통째로 새로고침된다.
  // 푸터는 모든 화면에 있어서 영향 범위가 넓다.
  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      await api.post<{ ok: boolean }>("/api/subscribe", { email });
      setState("done");
      setMessage("구독 신청이 접수되었습니다.");
      setEmail("");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof ApiError && err.code === "invalid_email"
          ? "이메일 형식을 확인해 주세요."
          : "신청하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
  };

  return (
    <footer className="bg-foreground text-background">
      {/* Top bar */}
      <div className="border-b border-background/10">
        <div className="container-full py-12 md:py-16">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <Link
                to="/"
                className="font-serif text-3xl md:text-4xl tracking-tight text-background"
              >
                Maison
              </Link>
              <p className="mt-3 text-sm text-background/50 leading-relaxed max-w-xs">
                Curated home objects and lifestyle pieces for considered living.
              </p>
            </div>

            {/* Newsletter in footer */}
            <div className="max-w-sm w-full">
              <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-background/40 mb-3">
                Stay Connected
              </p>
              <form onSubmit={handleSubscribe} className="flex gap-0">
                <label htmlFor="newsletter-email" className="sr-only">
                  이메일 주소
                </label>
                <input
                  id="newsletter-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (state !== "idle") setState("idle");
                  }}
                  placeholder="Your email"
                  className="flex-1 h-12 px-4 text-sm bg-background/5 border border-background/15 text-background placeholder:text-background/30 focus:outline-none focus:border-background/40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={state === "sending"}
                  aria-label="뉴스레터 구독 신청"
                  className="h-12 px-5 text-sm font-medium bg-background text-foreground hover:bg-background/90 transition-colors disabled:opacity-60"
                >
                  {state === "done" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                </button>
              </form>
              {message && (
                <p
                  role={state === "error" ? "alert" : "status"}
                  className={`mt-3 text-xs ${
                    state === "error" ? "text-destructive" : "text-background/60"
                  }`}
                >
                  {message}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main footer content */}
      <div className="container-full py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-4">
          {/* Collections */}
          <div>
            <h4 className="text-[11px] font-semibold tracking-[0.25em] uppercase text-background/40 mb-5">
              Collections
            </h4>
            <ul className="space-y-3">
              {collections.slice(0, 6).map((collection) => (
                <li key={collection.id}>
                  <Link
                    to={`/products?collection=${collection.slug}`}
                    className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                  >
                    {collection.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Explore */}
          <div>
            <h4 className="text-[11px] font-semibold tracking-[0.25em] uppercase text-background/40 mb-5">
              Explore
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/products"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  Shop All
                </Link>
              </li>
              <li>
                <Link
                  to="/about"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  Our Story
                </Link>
              </li>
              <li>
                <Link
                  to="/cart"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  Shopping Bag
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-[11px] font-semibold tracking-[0.25em] uppercase text-background/40 mb-5">
              Support
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/info/shipping-returns"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  Shipping & Returns
                </Link>
              </li>
              <li>
                <Link
                  to="/info/care-guide"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  Care Guide
                </Link>
              </li>
              <li>
                <Link
                  to="/info/faq"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  to="/info"
                  className="inline-flex items-center gap-2 text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  View All
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-[11px] font-semibold tracking-[0.25em] uppercase text-background/40 mb-5">
              Contact
            </h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="mailto:hello@maison.com"
                  className="text-sm text-background/60 hover:text-background transition-colors duration-300"
                >
                  hello@maison.com
                </a>
              </li>
              <li>
                <p className="text-sm text-background/40 leading-relaxed">
                  Mon–Fri, 9am–6pm CET
                </p>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-background/10">
        <div className="container-full py-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-background/30">
            © {new Date().getFullYear()} Maison. All rights reserved.
          </p>
          <div className="flex gap-8">
            <Link
                  to="/info/privacy"
                  className="text-xs text-background/30 hover:text-background/60 transition-colors duration-300"
                >
                  Privacy Policy
                </Link>
            <Link
                  to="/info/terms"
                  className="text-xs text-background/30 hover:text-background/60 transition-colors duration-300"
                >
                  Terms of Service
                </Link>
            <Link
                  to="/info/cookies"
                  className="text-xs text-background/30 hover:text-background/60 transition-colors duration-300"
                >
                  Cookie Policy
                </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
