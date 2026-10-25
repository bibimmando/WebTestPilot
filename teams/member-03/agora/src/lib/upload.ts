import { currentLang, tr } from "@/i18n";
import { api } from "./api";
import type { UploadResult } from "./types";

/** 서버 features/media.ts 와 같은 제한. 서버가 다시 검사하므로 여기서는 미리 알려 주는 용도다. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(",");

/** 올릴 수 없는 파일이면 이유를, 괜찮으면 null */
export function imageFileError(file: File): string | null {
  if (!UPLOAD_TYPES.includes(file.type)) return `${file.name}: ${tr("JPG, PNG, WEBP, GIF 파일만 올릴 수 있어요.")}`;
  if (file.size === 0) return `${file.name}: ${tr("빈 파일이에요.")}`;
  if (file.size > UPLOAD_MAX_BYTES) return `${file.name}: ${tr("5MB 이하의 파일만 올릴 수 있어요.")}`;
  return null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name}: ${tr("파일을 읽지 못했어요.")}`));
    reader.readAsDataURL(file);
  });
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const dataUrl = await readAsDataUrl(file);
  const r = await api.post<{ upload: UploadResult }>("/api/uploads", { dataUrl });
  return r.upload;
}

/** 서버 features/media.ts 의 동영상 제한 */
export const VIDEO_MAX_BYTES = 30 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 180;
export const VIDEO_TYPES = ["video/mp4", "video/webm"];
export const VIDEO_ACCEPT = VIDEO_TYPES.join(",");

export function videoFileError(file: File): string | null {
  if (!VIDEO_TYPES.includes(file.type)) return `${file.name}: ${tr("MP4, WEBM 동영상만 올릴 수 있어요.")}`;
  if (file.size === 0) return `${file.name}: ${tr("빈 파일이에요.")}`;
  if (file.size > VIDEO_MAX_BYTES) return `${file.name}: ${tr("{n}MB 이하의 동영상만 올릴 수 있어요.", { n: VIDEO_MAX_BYTES / 1024 / 1024 })}`;
  return null;
}

/** 브라우저로 동영상 머리를 읽어 가로 · 세로 · 길이를 얻는다. 재생할 수 없는 파일이면 실패한다. */
export function readVideoMeta(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const done = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const meta = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
      done();
      if (!meta.width || !meta.height || !Number.isFinite(meta.duration)) reject(new Error(`${file.name}: ${tr("동영상 정보를 읽지 못했어요.")}`));
      else if (meta.duration > VIDEO_MAX_SECONDS) reject(new Error(`${file.name}: ${tr("{n}분 이하의 동영상만 올릴 수 있어요.", { n: VIDEO_MAX_SECONDS / 60 })}`));
      else resolve(meta);
    };
    video.onerror = () => {
      done();
      reject(new Error(`${file.name}: ${tr("이 브라우저에서 재생할 수 없는 동영상이에요.")}`));
    };
    video.src = url;
  });
}

/**
 * 동영상을 파일 그대로 올린다. 크기가 커서 진행률(0~1)을 알려 준다 — fetch 는 올리는 진행률을 못 줘서 XHR 을 쓴다.
 * signal 로 취소할 수 있다.
 */
export async function uploadVideo(file: File, onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<UploadResult> {
  const meta = await readVideoMeta(file);
  const qs = new URLSearchParams({ width: String(meta.width), height: String(meta.height), duration: String(meta.duration) });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads/video?${qs}`);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-agora-lang", currentLang());
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { upload?: UploadResult; message?: string; fields?: Record<string, string> } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // 아래에서 상태 코드로 알린다.
      }
      if (xhr.status === 201 && body?.upload) resolve(body.upload);
      else reject(new Error(body?.fields?.file ?? body?.message ?? tr("요청에 실패했어요 (HTTP {status})", { status: xhr.status })));
    };
    xhr.onerror = () => reject(new Error(tr("네트워크 오류로 올리지 못했어요.")));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
