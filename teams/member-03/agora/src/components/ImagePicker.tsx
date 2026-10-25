import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { clsx } from "clsx";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import type { UploadResult } from "@/lib/types";
import { UPLOAD_ACCEPT, imageFileError, uploadImage } from "@/lib/upload";

export interface PickedImage {
  key: string;
  /** 임시 저장에서 불러온 이미지는 이미 올라가 있어 파일이 없다 */
  file: File | null;
  preview: string;
  status: "uploading" | "done" | "error";
  upload: UploadResult | null;
  error: string | null;
  alt: string;
  caption: string;
}

export const PICK_MAX = 8;
let seq = 0;
export const nextPickKey = () => `img${++seq}`;

/**
 * 글에 붙일 이미지 고르기. 고르는 즉시 서버에 올리고, 장마다 설명(alt)과 캡션을 적는다.
 * 끌어다 놓기와 파일 선택 둘 다 된다.
 */
export function ImagePicker({
  images,
  onChange,
  error,
}: {
  images: PickedImage[];
  onChange: (update: (prev: PickedImage[]) => PickedImage[]) => void;
  error?: string;
}) {
  const t = useT();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  // 화면을 떠나면 미리보기 주소를 풀어 준다.
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const start = (item: PickedImage) => {
    if (!item.file) return;
    uploadImage(item.file).then(
      (upload) => onChange((prev) => prev.map((x) => (x.key === item.key ? { ...x, status: "done", upload, error: null } : x))),
      (err) => onChange((prev) => prev.map((x) => (x.key === item.key ? { ...x, status: "error", error: errorMessage(err) } : x))),
    );
  };

  const add = (files: FileList | File[]) => {
    const list = [...files];
    const problems: string[] = [];
    const room = PICK_MAX - images.length;
    const accepted: PickedImage[] = [];
    for (const file of list) {
      const problem = imageFileError(file);
      if (problem) problems.push(problem);
      else if (accepted.length >= room) problems.push(`${file.name}: ${t("이미지는 {n}장까지 올릴 수 있어요.", { n: PICK_MAX })}`);
      else {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        accepted.push({ key: `img${++seq}`, file, preview, status: "uploading", upload: null, error: null, alt: "", caption: "" });
      }
    }
    setRejected(problems);
    if (accepted.length === 0) return;
    onChange((prev) => [...prev, ...accepted]);
    accepted.forEach(start);
  };

  const update = (key: string, patch: Partial<PickedImage>) => onChange((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: string) => onChange((prev) => prev.filter((x) => x.key !== key));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={clsx(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-line bg-bg/50",
          error && "border-down/60",
        )}
      >
        <ImagePlus className="h-8 w-8 text-muted" />
        <p className="text-sm font-semibold">{t("이미지를 끌어다 놓거나")}</p>
        <button type="button" className="btn-outline py-1.5" onClick={() => inputRef.current?.click()} disabled={images.length >= PICK_MAX}>
          {t("파일 선택")}
        </button>
        <p className="text-xs text-muted">{t("JPG · PNG · WEBP · GIF, 한 장에 5MB 까지, 최대 {n}장", { n: PICK_MAX })} ({images.length}/{PICK_MAX})</p>
        <input
          ref={inputRef}
          id={`${id}-file`}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          className="sr-only"
          aria-label={t("이미지 파일 선택")}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 && (
        <ul role="alert" className="mt-2 space-y-0.5">
          {rejected.map((r) => <li key={r} className="field-error mt-0">{r}</li>)}
        </ul>
      )}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}

      {images.length > 0 && (
        <ol className="mt-3 space-y-3">
          {images.map((img, i) => (
            <li key={img.key} className="flex gap-3 rounded-xl border border-line p-3">
              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-bg">
                <img src={img.preview} alt="" className="h-full w-full object-cover" />
                {img.status === "uploading" && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white" role="status" aria-label={t("{n}번째 이미지 올리는 중", { n: i + 1 })}>
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted">
                    {i + 1}. {img.file?.name ?? t("임시 저장한 이미지")}
                    {img.upload && ` · ${img.upload.width}×${img.upload.height}`}
                  </p>
                  <button type="button" className="btn-ghost h-7 w-7 p-0" aria-label={t("{n}번째 이미지 빼기", { n: i + 1 })} onClick={() => remove(img.key)}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {img.status === "error" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="field-error mt-0">{img.error}</p>
                    <button
                      type="button"
                      className="btn-outline px-3 py-1 text-xs"
                      onClick={() => {
                        update(img.key, { status: "uploading", error: null });
                        start(img);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> {t("다시 올리기")}
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="block">
                      <span className="sr-only">{t("{n}번째 이미지 설명", { n: i + 1 })}</span>
                      <input
                        value={img.alt}
                        onChange={(e) => update(img.key, { alt: e.target.value })}
                        maxLength={200}
                        placeholder={t("이미지 설명 (화면 낭독기가 읽어요)")}
                        className="input py-1.5"
                      />
                    </label>
                    <label className="block">
                      <span className="sr-only">{t("{n}번째 이미지 캡션", { n: i + 1 })}</span>
                      <input
                        value={img.caption}
                        onChange={(e) => update(img.key, { caption: e.target.value })}
                        maxLength={200}
                        placeholder={t("캡션 (선택)")}
                        className="input py-1.5"
                      />
                    </label>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
