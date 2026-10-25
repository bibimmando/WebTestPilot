import { useCallback, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, EyeOff, Images, Maximize2 } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import type { PostImage, PostVideo } from "@/lib/types";
import { Modal } from "./Modal";

/** 아주 길거나 납작한 이미지도 카드가 지나치게 커지거나 작아지지 않게 비율을 묶는다. */
function frameRatio(img: PostImage): number {
  return Math.min(2, Math.max(0.8, img.width / img.height));
}

/**
 * 이미지 한 장을 틀 안에 맞춰 보여 준다. 틀은 늘 칸 너비를 다 쓰고, 사진은 가운데에 둔다.
 * 틀과 비율이 다르면 남는 양옆 · 위아래를 같은 사진을 어둡고 흐리게 깔아 채운다.
 */
function FramedImage({ img, eager = false, ratio, className }: { img: PostImage; eager?: boolean; ratio?: number; className?: string }) {
  return (
    <div className={clsx("relative w-full overflow-hidden bg-black", className)} style={{ aspectRatio: String(ratio ?? frameRatio(img)) }}>
      <img src={img.src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
      <img
        src={img.src}
        alt={img.alt}
        width={img.width}
        height={img.height}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="relative h-full w-full object-contain"
      />
    </div>
  );
}

/**
 * 여러 장 넘기기. 처음 · 마지막 장에서 더 가지 않는다 (돌아서 반대쪽 끝으로 가지 않는다).
 * 방향키도 같은 규칙을 따른다.
 */
function useSlides(count: number) {
  const [index, setIndex] = useState(0);
  const go = useCallback((delta: number) => setIndex((i) => Math.min(count - 1, Math.max(0, i + delta))), [count]);
  const onKey = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    }
  };
  return { index: Math.min(index, Math.max(0, count - 1)), setIndex, go, onKey };
}

/**
 * 이전 · 다음 버튼. 검은 바탕에 흰 화살표.
 * 끝에 닿으면 누를 수 없게 하고 흐리게 보인다. disabled 대신 aria-disabled 를 써서,
 * 키보드로 버튼에 있던 사람이 끝에 닿아도 포커스를 잃지 않게 한다.
 * hideUntilHover 면 마우스가 있는 화면에서는 이미지에 올렸거나 키보드로 들어왔을 때만 보인다 (터치 화면에서는 늘 보인다).
 */
function SlideButton({ dir, disabled, onClick, hideUntilHover = false }: { dir: -1 | 1; disabled: boolean; onClick: () => void; hideUntilHover?: boolean }) {
  const t = useT();
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      aria-label={t(dir < 0 ? "이전 이미지" : "다음 이미지")}
      aria-disabled={disabled}
      className={clsx(
        "absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full shadow transition-[opacity,background-color]",
        dir < 0 ? "left-2" : "right-2",
        disabled ? "bg-black/30 text-white/40" : "bg-black/75 text-white hover:bg-black",
        hideUntilHover && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/**
 * 목록 카드에 들어가는 이미지. 여러 장이면 글에 들어가지 않고도 좌우로 넘겨 볼 수 있다.
 * 이미지를 누르면 글로 간다. 틀 비율은 첫 장에 맞춰 두어, 넘겨도 카드 높이가 바뀌지 않는다.
 */
export function CardMedia({ images, to }: { images: PostImage[]; to: string }) {
  const t = useT();
  const count = images.length;
  const { index, go, onKey } = useSlides(count);
  if (count === 0) return null;
  const img = images[index];

  return (
    <div
      className="group relative mt-2 overflow-hidden rounded-xl border border-line"
      role={count > 1 ? "group" : undefined}
      aria-roledescription={count > 1 ? t("이미지 넘기기") : undefined}
      aria-label={count > 1 ? t("이미지 {n}장", { n: count }) : undefined}
      onKeyDown={onKey}
    >
      <Link to={to} className="block" aria-label={count > 1 ? t("{n}장 중 {i}번째 이미지 · 글 보기", { n: count, i: index + 1 }) : t("이미지 보기")}>
        <FramedImage img={img} ratio={frameRatio(images[0])} className="max-h-[30rem]" />
      </Link>
      {count > 1 && (
        <>
          <SlideButton dir={-1} disabled={index === 0} onClick={() => go(-1)} hideUntilHover />
          <SlideButton dir={1} disabled={index === count - 1} onClick={() => go(1)} hideUntilHover />
          <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white" aria-live="polite">
            <Images className="h-3.5 w-3.5" aria-hidden="true" /> {index + 1}/{count}
          </span>
          <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden="true">
            {images.map((_, i) => (
              <span key={i} className={clsx("h-1.5 rounded-full shadow transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/60")} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}

/** 압축 목록용 작은 썸네일 */
export function Thumbnail({ img, className }: { img: PostImage; className?: string }) {
  return <img src={img.src} alt="" aria-hidden="true" loading="lazy" decoding="async" className={clsx("rounded-lg bg-bg object-cover", className)} />;
}

/**
 * 글 화면의 이미지. 여러 장이면 좌우로 넘기고(버튼·방향키), 누르면 크게 본다.
 */
export function Gallery({ images }: { images: PostImage[] }) {
  const t = useT();
  const [zoomed, setZoomed] = useState(false);
  const titleId = useId();
  const count = images.length;
  const { index, setIndex, go, onKey } = useSlides(count);
  const close = useCallback(() => setZoomed(false), []);

  if (count === 0) return null;
  const img = images[index];
  const first = index === 0;
  const last = index === count - 1;

  return (
    <figure
      className="mt-3"
      aria-roledescription={count > 1 ? t("이미지 넘기기") : undefined}
      aria-label={count > 1 ? t("이미지 {n}장", { n: count }) : undefined}
      onKeyDown={onKey}
    >
      <div className="group relative overflow-hidden rounded-xl border border-line">
        <button type="button" className="block w-full cursor-zoom-in" onClick={() => setZoomed(true)} aria-label={t("이미지 크게 보기")}>
          <FramedImage img={img} eager className="max-h-[36rem]" />
        </button>
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-4 w-4" />
        </span>
        {count > 1 && (
          <>
            <SlideButton dir={-1} disabled={first} onClick={() => go(-1)} />
            <SlideButton dir={1} disabled={last} onClick={() => go(1)} />
            <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white" aria-live="polite">
              {index + 1}/{count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={t("{n}번째 이미지", { n: i + 1 })}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={clsx("h-2 rounded-full transition-all", i === index ? "w-5 bg-accent" : "w-2 bg-line hover:bg-muted/50")}
            />
          ))}
        </div>
      )}
      {img.caption && <figcaption className="mt-2 text-center text-sm text-muted">{img.caption}</figcaption>}

      <Modal open={zoomed} onClose={close} labelledBy={titleId} size="full">
        <h2 id={titleId} className="sr-only">{t("이미지 크게 보기")}</h2>
        <div className="flex items-center justify-center" onKeyDown={onKey}>
          <img src={img.src} alt={img.alt} width={img.width} height={img.height} className="max-h-[80vh] w-auto rounded-lg object-contain" />
        </div>
        {count > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button type="button" onClick={() => !first && go(-1)} aria-disabled={first} className={clsx("btn text-white", first ? "bg-white/5 opacity-40" : "bg-white/10 hover:bg-white/20")}>
              <ChevronLeft className="h-4 w-4" /> {t("이전")}
            </button>
            <span aria-live="polite">{index + 1} / {count}</span>
            <button type="button" onClick={() => !last && go(1)} aria-disabled={last} className={clsx("btn text-white", last ? "bg-white/5 opacity-40" : "bg-white/10 hover:bg-white/20")}>
              {t("다음")} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        {img.caption && <p className="mt-2 text-center text-sm text-white/80">{img.caption}</p>}
      </Modal>
    </figure>
  );
}

/**
 * 동영상. 틀은 칸 너비를 다 쓰고 검은 바탕 가운데에 맞춘다. 스스로 재생하지 않는다 (소리 · 데이터 낭비 방지).
 * preload="metadata" 라 첫 화면과 길이만 받아 오고, 재생을 누르면 그때 나머지를 받는다.
 */
export function VideoPlayer({ video, label, className }: { video: PostVideo; label: string; className?: string }) {
  return (
    <div className={clsx("relative w-full overflow-hidden rounded-xl border border-line bg-black", className)} style={{ aspectRatio: String(Math.min(2, Math.max(0.8, video.width / video.height))) }}>
      <video src={video.src} controls playsInline preload="metadata" aria-label={label} className="absolute inset-0 h-full w-full object-contain" />
    </div>
  );
}

/** "1:05" 처럼 */
export function durationText(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * 스포일러 가림막. 누르기 전에는 내용 대신 흐린 미리보기(있으면)와 "스포일러 보기" 단추만 보여 준다.
 * 가려진 동안에는 진짜 내용을 그리지 않는다 — 동영상이 재생되거나 화면 낭독기가 읽지 않게.
 */
export function SpoilerGate({ preview, children, className }: { preview?: string | null; children: ReactNode; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (open) return <>{children}</>;
  return (
    <div className={clsx("relative mt-2 flex h-48 items-center justify-center overflow-hidden rounded-xl border border-line bg-bg", className)}>
      {preview && <img src={preview} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl" />}
      <button type="button" onClick={() => setOpen(true)} className="relative btn bg-black/75 text-white hover:bg-black">
        <EyeOff className="h-4 w-4" /> {t("스포일러 보기")}
      </button>
    </div>
  );
}
