import { useT } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Bold, Code, EyeOff, Heading, ImagePlus, Italic, Link, Link2, List, ListOrdered, Loader2, Quote,
  SquareCode, Strikethrough, Superscript, Table, Tag, Trash2, Video, X,
} from "lucide-react";
import { clsx } from "clsx";
import { CommunityPicker } from "@/components/CommunityPicker";
import { ImagePicker, nextPickKey, type PickedImage } from "@/components/ImagePicker";
import { Modal } from "@/components/Modal";
import { SpoilerChip } from "@/components/PostCard";
import { durationText } from "@/components/PostMedia";
import { SiteFooter } from "@/components/SiteFooter";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useCommunities } from "@/lib/communities";
import { applyFormat, type Format } from "@/lib/editor";
import { postPath, timeAgo } from "@/lib/format";
import { useSession } from "@/lib/session";
import { VIDEO_ACCEPT, uploadVideo, videoFileError } from "@/lib/upload";
import type { Draft, Post, UploadResult } from "@/lib/types";

const TITLE_MAX = 300;

/** 붙인 동영상 한 개. 고르는 즉시 올리고 진행률을 보여 준다. */
interface PickedVideo {
  name: string;
  preview: string;
  status: "uploading" | "done" | "error";
  progress: number;
  upload: Pick<UploadResult, "id" | "width" | "height" | "duration"> | null;
  error: string | null;
}

type Attach = "none" | "link" | "images" | "video";

/**
 * 글쓰기. 위에서부터 커뮤니티 고르기 · 임시 저장함, 제목, 태그(말머리 · 스포일러), 본문과 도구 모음, 임시 저장 · 등록.
 * 도구 모음의 앞 세 칸(링크 · 이미지 · 동영상)은 글에 붙일 것을 고르고, 나머지는 본문에 마크다운 서식을 넣는다.
 * 링크 · 이미지 · 동영상은 하나만 붙일 수 있다 (글 종류가 하나라서).
 */
export function SubmitPage() {
  const t = useT();
  const { name } = useParams();
  const [params] = useSearchParams();
  const { user, loading, refresh } = useSession();
  const { list } = useCommunities();
  const navigate = useNavigate();
  const location = useLocation();

  const [community, setCommunity] = useState(name ?? params.get("community") ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [flair, setFlair] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [attach, setAttach] = useState<Attach>(params.get("kind") === "image" ? "images" : "none");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"post" | "draft" | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const videoAbort = useRef<AbortController | null>(null);

  const selected = list.find((c) => c.name === community);

  // 커뮤니티를 바꾸면, 그 커뮤니티에 없는 말머리는 지운다.
  useEffect(() => {
    if (selected && flair && !selected.flairs.includes(flair)) setFlair("");
  }, [selected, flair]);

  const loadDraftCount = useCallback(() => {
    api.get<{ items: Draft[] }>("/api/drafts").then((r) => setDraftCount(r.items.length), () => undefined);
  }, []);
  useEffect(() => {
    if (user) loadDraftCount();
  }, [user, loadDraftCount]);

  // 화면을 떠나면 올리던 동영상을 멈추고 미리보기 주소를 풀어 준다.
  useEffect(() => () => videoAbort.current?.abort(), []);

  if (!loading && !user) {
    return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />;
  }

  // ── 붙이기 ──────────────────────────────────────────────
  const hasLink = url.trim().length > 0;
  const hasImages = images.length > 0;
  const hasVideo = !!video;
  const busyMedia = images.some((i) => i.status === "uploading") || video?.status === "uploading";
  const blocked = (kind: Attach) =>
    (kind !== "link" && hasLink) || (kind !== "images" && hasImages) || (kind !== "video" && hasVideo);

  const pickVideo = (file: File) => {
    const problem = videoFileError(file);
    if (problem) {
      setVideo({ name: file.name, preview: "", status: "error", progress: 0, upload: null, error: problem });
      return;
    }
    const preview = URL.createObjectURL(file);
    const ctrl = new AbortController();
    videoAbort.current = ctrl;
    setVideo({ name: file.name, preview, status: "uploading", progress: 0, upload: null, error: null });
    uploadVideo(file, (progress) => setVideo((v) => v && { ...v, progress }), ctrl.signal).then(
      (upload) => setVideo((v) => v && { ...v, status: "done", progress: 1, upload }),
      (err) => {
        if ((err as DOMException).name === "AbortError") return;
        setVideo((v) => v && { ...v, status: "error", error: errorMessage(err) });
      },
    );
  };
  const removeVideo = () => {
    videoAbort.current?.abort();
    if (video?.preview.startsWith("blob:")) URL.revokeObjectURL(video.preview);
    setVideo(null);
    setAttach("none");
  };

  // ── 서식 ────────────────────────────────────────────────
  const format = (f: Format) => {
    const el = bodyRef.current;
    if (!el) return;
    const edit = applyFormat(body, el.selectionStart, el.selectionEnd, f, (hint) => t(hint));
    setBody(edit.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
    });
  };
  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b" || key === "i") {
      e.preventDefault();
      format(key === "b" ? "bold" : "italic");
    }
  };

  // ── 보내기 ──────────────────────────────────────────────
  const kind = hasVideo ? "video" : hasImages ? "image" : hasLink ? "link" : "text";
  const payload = () => ({
    community,
    title,
    body,
    url: hasLink ? url.trim() : "",
    flair: flair || null,
    spoiler,
    images: images.filter((i) => i.upload).map((i) => ({ upload: i.upload!.id, alt: i.alt, caption: i.caption })),
    video: video?.upload?.id ?? null,
  });

  const mediaProblem = () => {
    if (busyMedia) return t("파일을 올리는 중이에요. 다 올라간 뒤에 해 주세요.");
    if (images.some((i) => i.status === "error") || video?.status === "error") return t("올리지 못한 파일이 있어요. 다시 올리거나 빼 주세요.");
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const problem = mediaProblem();
    if (problem) return setFormError(problem);
    setBusy("post");
    try {
      const p = payload();
      const r = await api.post<{ post: Post }>("/api/posts", { ...p, kind, video: p.video ?? "", draftId });
      void refresh();
      navigate(postPath(r.post));
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    setErrors({});
    setFormError(null);
    const problem = mediaProblem();
    if (problem) return setFormError(problem);
    setBusy("draft");
    try {
      const r = draftId
        ? await api.put<{ draft: Draft }>(`/api/drafts/${draftId}`, payload())
        : await api.post<{ draft: Draft }>("/api/drafts", payload());
      setDraftId(r.draft.id);
      setSavedAt(r.draft.updatedAt);
      loadDraftCount();
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "validation") setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const loadDraft = (d: Draft) => {
    videoAbort.current?.abort();
    setDraftId(d.id);
    setSavedAt(d.updatedAt);
    setCommunity(d.community ?? "");
    setTitle(d.title);
    setBody(d.body);
    setUrl(d.url);
    setFlair(d.flair ?? "");
    setSpoiler(d.spoiler);
    setImages(
      d.images.map((img) => ({
        key: nextPickKey(),
        file: null,
        preview: img.src,
        status: "done",
        upload: { id: img.upload, url: img.src, width: img.width, height: img.height, duration: null, kind: "image" },
        error: null,
        alt: img.alt,
        caption: img.caption,
      })),
    );
    setVideo(d.video ? { name: t("임시 저장한 동영상"), preview: d.video.src, status: "done", progress: 1, upload: { id: d.video.upload, width: d.video.width, height: d.video.height, duration: d.video.duration }, error: null } : null);
    setAttach(d.video ? "video" : d.images.length ? "images" : d.url ? "link" : "none");
    setErrors({});
    setFormError(null);
    setDraftsOpen(false);
  };

  const hasContent = !!(title.trim() || body.trim() || hasLink || hasImages || hasVideo);
  const titleLength = [...title].length;
  const flairLabel = flair && selected ? (selected.flairLabels[flair] ?? flair) : null;

  const tools: { f: Format; label: string; icon: typeof Bold }[][] = [
    [
      { f: "bold", label: "굵게 (Ctrl+B)", icon: Bold },
      { f: "italic", label: "기울임 (Ctrl+I)", icon: Italic },
      { f: "strike", label: "취소선", icon: Strikethrough },
      { f: "superscript", label: "위 첨자", icon: Superscript },
      { f: "heading", label: "제목@@format", icon: Heading },
      { f: "link", label: "링크 넣기", icon: Link },
    ],
    [
      { f: "bullet", label: "글머리 목록", icon: List },
      { f: "number", label: "번호 목록", icon: ListOrdered },
    ],
    [
      { f: "spoiler", label: "스포일러", icon: EyeOff },
      { f: "quote", label: "인용", icon: Quote },
      { f: "code", label: "코드", icon: Code },
      { f: "codeblock", label: "코드 블록", icon: SquareCode },
      { f: "table", label: "표", icon: Table },
    ],
  ];
  const toolClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink disabled:pointer-events-none disabled:opacity-35";

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col">
      <form onSubmit={submit} noValidate className="w-full max-w-[64rem] flex-1 space-y-5">
        <h1 className="sr-only">{t("글쓰기")}</h1>
        <div className="flex items-start justify-between gap-3">
          <CommunityPicker list={list} value={community} onChange={setCommunity} error={errors.community} />
          <button type="button" onClick={() => setDraftsOpen(true)} className="btn-ghost h-12 font-semibold text-ink">
            {t("임시 저장함")}
            {!!draftCount && <span className="rounded-full bg-bg px-1.5 text-xs ring-1 ring-line">{draftCount}</span>}
          </button>
        </div>

        {/* 제목: 칸 안에 이름표를 띄워 두다가 쓰기 시작하면 위로 작게 올린다 */}
        <div>
          <div className="relative">
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder=" "
              aria-invalid={!!errors.title}
              aria-describedby="title-count title-error"
              className={clsx(
                "peer block h-16 w-full rounded-2xl border bg-surface px-4 pb-2 pt-6 text-base text-ink outline-none focus:ring-2 focus:ring-accent/20",
                errors.title ? "border-down" : "border-line focus:border-accent",
              )}
            />
            <label
              htmlFor="title"
              className="pointer-events-none absolute left-4 top-2 text-xs font-semibold text-muted transition-all peer-placeholder-shown:top-5 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:text-xs"
            >
              {t("제목")}<span className="text-down">*</span>
            </label>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <p id="title-error" className="field-error mt-0">{errors.title ?? ""}</p>
            <p id="title-count" className={clsx("shrink-0 text-xs", titleLength > TITLE_MAX ? "text-down" : "text-muted")}>{titleLength}/{TITLE_MAX}</p>
          </div>
        </div>

        {/* 태그: 말머리 · 스포일러 */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTagsOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium text-muted hover:bg-bg hover:text-ink">
            <Tag className="h-4 w-4" /> {t(flair || spoiler ? "태그 바꾸기" : "태그 추가")}
            {selected?.requireFlair && !flair && <span className="text-down">*</span>}
          </button>
          {flairLabel && <span className="chip">{flairLabel}</span>}
          {spoiler && <SpoilerChip />}
          {errors.flair && <p className="field-error mt-0 w-full">{errors.flair}</p>}
        </div>

        {/* 본문 + 붙인 것 + 도구 모음 */}
        <div className="rounded-2xl border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <label htmlFor="body" className="sr-only">{t("본문")} {t("(선택)")}</label>
          <textarea
            id="body"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onBodyKey}
            rows={7}
            placeholder={t("본문 (선택)")}
            aria-invalid={!!errors.body}
            aria-describedby={errors.body ? "body-error" : undefined}
            className="block w-full resize-y rounded-t-2xl bg-transparent px-4 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted"
          />

          {attach === "link" && (
            <div className="border-t border-line px-4 py-3">
              <label htmlFor="url" className="mb-1 block text-sm font-semibold">{t("링크 주소")}</label>
              <div className="flex gap-2">
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="input"
                  placeholder="https://"
                  aria-invalid={!!errors.url}
                  aria-describedby={errors.url ? "url-error" : undefined}
                  autoFocus
                />
                <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label={t("링크 빼기")} onClick={() => { setUrl(""); setAttach("none"); }}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {errors.url && <p id="url-error" className="field-error">{errors.url}</p>}
            </div>
          )}

          {attach === "images" && (
            <div className="border-t border-line px-4 py-3">
              <ImagePicker images={images} onChange={setImages} error={errors.images} />
            </div>
          )}

          {video && (
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-lg bg-black">
                  {video.preview && <video src={video.preview} muted playsInline preload="metadata" className="h-full w-full object-contain" aria-hidden="true" />}
                  {video.upload?.duration != null && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[11px] font-semibold text-white">{durationText(video.upload.duration)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{video.name}</p>
                    <button type="button" className="btn-ghost h-8 w-8 shrink-0 p-0" aria-label={t("동영상 빼기")} onClick={removeVideo}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {video.status === "uploading" && (
                    <div role="progressbar" aria-label={t("동영상 올리는 중")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(video.progress * 100)}>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(video.progress * 100)}%` }} />
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Loader2 className="h-3 w-3 animate-spin" /> {t("올리는 중… {n}%", { n: Math.round(video.progress * 100) })}</p>
                    </div>
                  )}
                  {video.status === "done" && video.upload && (
                    <p className="text-xs text-muted">{t("올렸어요")} · {video.upload.width}×{video.upload.height}</p>
                  )}
                  {video.status === "error" && <p role="alert" className="text-xs font-medium text-down">{video.error}</p>}
                </div>
              </div>
              {errors.video && <p className="field-error">{errors.video}</p>}
            </div>
          )}
          {errors.body && <p id="body-error" className="field-error px-4">{errors.body}</p>}

          <div role="toolbar" aria-label={t("글쓰기 도구")} className="flex items-center gap-0.5 overflow-x-auto border-t border-line px-2 py-1.5">
            <button type="button" className={clsx(toolClass, attach === "link" && "bg-accent-soft text-accent-strong")} aria-label={t("링크 붙이기")} title={t(blocked("link") ? "링크 · 이미지 · 동영상은 하나만 붙일 수 있어요" : "링크 붙이기")} aria-pressed={attach === "link"} disabled={blocked("link")} onClick={() => setAttach(attach === "link" && !hasLink ? "none" : "link")}>
              <Link2 className="h-[18px] w-[18px]" />
            </button>
            <button type="button" className={clsx(toolClass, attach === "images" && "bg-accent-soft text-accent-strong")} aria-label={t("이미지 붙이기")} title={t(blocked("images") ? "링크 · 이미지 · 동영상은 하나만 붙일 수 있어요" : "이미지 붙이기")} aria-pressed={attach === "images"} disabled={blocked("images")} onClick={() => setAttach(attach === "images" && !hasImages ? "none" : "images")}>
              <ImagePlus className="h-[18px] w-[18px]" />
            </button>
            <button type="button" className={clsx(toolClass, hasVideo && "bg-accent-soft text-accent-strong")} aria-label={t("동영상 붙이기")} title={t(blocked("video") ? "링크 · 이미지 · 동영상은 하나만 붙일 수 있어요" : "동영상 붙이기")} aria-pressed={hasVideo} disabled={blocked("video") || hasVideo} onClick={() => videoInput.current?.click()}>
              <Video className="h-[18px] w-[18px]" />
            </button>
            <input
              ref={videoInput}
              type="file"
              accept={VIDEO_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) {
                  setAttach("video");
                  pickVideo(file);
                }
              }}
            />
            {tools.map((group, gi) => (
              <span key={gi} className="flex items-center gap-0.5 border-l border-line pl-1 ml-1">
                {group.map(({ f, label, icon: Icon }) => (
                  <button key={f} type="button" className={toolClass} aria-label={t(label)} title={t(label)} onMouseDown={(e) => e.preventDefault()} onClick={() => format(f)}>
                    <Icon className="h-[18px] w-[18px]" />
                  </button>
                ))}
              </span>
            ))}
          </div>
        </div>

        {formError && <p role="alert" className="rounded-lg bg-down/10 px-4 py-3 text-sm font-medium text-down">{formError}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {savedAt && <p role="status" className="mr-auto text-xs text-muted">{t("임시 저장했어요 · {time}", { time: timeAgo(savedAt) })}</p>}
          <button type="button" className="btn h-11 rounded-full bg-bg px-5 text-ink ring-1 ring-line hover:bg-line" disabled={!hasContent || busy !== null} onClick={saveDraft}>
            {busy === "draft" ? t("저장 중…") : t("임시 저장")}
          </button>
          <button type="submit" className="btn-primary h-11 px-6" disabled={!community || !title.trim() || busy !== null}>
            {busy === "post" ? t("올리는 중…") : t("등록")}
          </button>
        </div>
      </form>

      <SiteFooter className="mx-auto mt-10 max-w-[64rem] text-center [&_nav]:justify-center" />

      <TagsDialog
        open={tagsOpen}
        onClose={() => setTagsOpen(false)}
        flairs={selected?.flairs ?? []}
        flairLabels={selected?.flairLabels ?? {}}
        requireFlair={!!selected?.requireFlair}
        hasCommunity={!!selected}
        flair={flair}
        spoiler={spoiler}
        onApply={(f, s) => {
          setFlair(f);
          setSpoiler(s);
          setTagsOpen(false);
        }}
      />
      <DraftsDialog open={draftsOpen} onClose={() => setDraftsOpen(false)} currentId={draftId} onLoad={loadDraft} onChanged={loadDraftCount} />
    </div>
  );
}

/** 태그 고르기: 커뮤니티 말머리 하나 + 스포일러. "적용" 을 눌러야 바뀐다. */
function TagsDialog({
  open, onClose, flairs, flairLabels, requireFlair, hasCommunity, flair, spoiler, onApply,
}: {
  open: boolean;
  onClose: () => void;
  flairs: string[];
  flairLabels: Record<string, string>;
  requireFlair: boolean;
  hasCommunity: boolean;
  flair: string;
  spoiler: boolean;
  onApply: (flair: string, spoiler: boolean) => void;
}) {
  const t = useT();
  const [f, setF] = useState(flair);
  const [s, setS] = useState(spoiler);
  useEffect(() => {
    if (open) {
      setF(flair);
      setS(spoiler);
    }
  }, [open, flair, spoiler]);
  const close = useCallback(() => onClose(), [onClose]);

  return (
    <Modal open={open} onClose={close} labelledBy="tags-title" size="lg">
      <h2 id="tags-title" className="mb-4 text-xl font-bold">{t("태그 추가")}</h2>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">
          {t("말머리")} {requireFlair && <span className="text-down">*</span>}
        </legend>
        {!hasCommunity ? (
          <p className="text-sm text-muted">{t("커뮤니티를 먼저 고르면 그 커뮤니티의 말머리를 고를 수 있어요.")}</p>
        ) : flairs.length === 0 ? (
          <p className="text-sm text-muted">{t("이 커뮤니티는 말머리를 쓰지 않아요.")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {["", ...flairs].map((value) => (
              <label key={value || "none"} className={clsx("cursor-pointer rounded-full border px-3 py-1.5 text-sm", f === value ? "border-accent bg-accent-soft font-semibold text-accent-strong" : "border-line hover:bg-bg")}>
                <input type="radio" name="flair" value={value} checked={f === value} onChange={() => setF(value)} className="sr-only" />
                {value ? (flairLabels[value] ?? value) : t("말머리 없음")}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <span className="min-w-0 flex-1">
          <span id="spoiler-label" className="block font-semibold">{t("스포일러")}</span>
          <span id="spoiler-detail" className="block text-sm text-muted">{t("목록과 글에서 내용을 가려 두고, 누른 사람에게만 보여 줘요.")}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={s}
          aria-labelledby="spoiler-label"
          aria-describedby="spoiler-detail"
          onClick={() => setS(!s)}
          className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors", s ? "bg-accent" : "bg-line")}
        >
          <span className={clsx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left]", s ? "left-6" : "left-1")} />
        </button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={close}>{t("취소")}</button>
        <button type="button" className="btn-primary" onClick={() => onApply(f, s)}>{t("적용")}</button>
      </div>
    </Modal>
  );
}

/** 임시 저장함. 불러오면 지금 쓰던 내용을 그 임시 저장으로 바꾼다. */
function DraftsDialog({
  open, onClose, currentId, onLoad, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  currentId: string | null;
  onLoad: (d: Draft) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [items, setItems] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setError(null);
    api.get<{ items: Draft[] }>("/api/drafts").then((r) => setItems(r.items), (err) => setError(errorMessage(err)));
  }, [open]);

  const remove = async (d: Draft) => {
    try {
      await api.del(`/api/drafts/${d.id}`);
      setItems((prev) => prev?.filter((x) => x.id !== d.id) ?? null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="drafts-title" size="lg">
      <h2 id="drafts-title" className="text-xl font-bold">{t("임시 저장함")}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t("불러오면 지금 쓰던 내용이 그 임시 저장으로 바뀌어요.")}</p>
      {error && <p role="alert" className="mb-3 text-sm text-down">{error}</p>}
      {!items ? (
        <p className="py-6 text-center text-sm text-muted">{t("불러오는 중…")}</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("임시 저장한 글이 없어요.")}</p>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{d.title || t("(제목 없음)")}</p>
                <p className="truncate text-xs text-muted">
                  {d.community ? `c/${d.community}` : t("커뮤니티 안 고름")} · {timeAgo(d.updatedAt)}
                  {d.video ? ` · ${t("동영상")}` : d.images.length ? ` · ${t("사진 {n}장", { n: d.images.length })}` : ""}
                  {d.id === currentId ? ` · ${t("지금 쓰는 중")}` : ""}
                </p>
              </div>
              <button type="button" className="btn-outline py-1.5" onClick={() => onLoad(d)}>{t("불러오기")}</button>
              <button type="button" className="btn-ghost h-9 w-9 p-0" aria-label={t("{title} 임시 저장 지우기", { title: d.title || t("(제목 없음)") })} onClick={() => remove(d)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
