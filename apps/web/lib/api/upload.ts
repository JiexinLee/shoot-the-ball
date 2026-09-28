// ==========================================================================
// lib/api/upload.ts
//   纯前端 upload helper（不直接调 REST API，只依赖浏览器 API）：
//     1) 白名单常量（ACCEPTED_MIME / MAX_UPLOAD_BYTES / DEFAULT_PROJECT_ID）
//     2) 文件名/mime 辅助（generateUid / guessMime / isVideoFile）
//     3) 本地 probe 视频 metadata（probeVideoMetadata — 用 <video> loadedmetadata）
//     4) 真实 PUT 到 R2 预签名 URL（uploadToPresignedUrl — XMLHttpRequest，拿 xhr.upload.onprogress）
//     5) 旧命名兼容：createUploadSession / completeUpload / startProcessing / subscribeJobProgress
//        ——这些实际上会调 api.videos / api.jobs，但为了让现有 VideoUploader 组件不用改 import，
//        就一起放在这个文件里 export。
// ==========================================================================

import { ApiError } from "./core";
import { videos } from "./videos";
import { jobs } from "./jobs";

// ---------- 1) 常量 ----------

/** <input accept=...> 白名单 mime，对应后端 videos.routes 的 extension 白名单。 */
export const ACCEPTED_MIME =
  "video/mp4,video/quicktime,video/x-matroska,video/x-m4v,video/webm,video/x-msvideo";

/** 单个文件最大 16 GB，前后端一致，前端先拦省带宽。 */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;

/**
 * MVP 阶段 UI 不做项目选择，直接用这个固定 project id。
 * prisma/seed.ts 里默认插入了 proj-dev-default-001。
 * 生产环境如果要动态改，设 NEXT_PUBLIC_DEFAULT_PROJECT_ID env。
 */
export const DEFAULT_PROJECT_ID =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_ID ?? "proj-dev-default-001";

// ---------- 2) uid / mime ----------

/** 兼容浏览器回退 uid（只用在前端卡片本地 id，不是 DB 主键）。 */
export function generateUid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** 某些浏览器 file.type 空串，按扩展名回推。 */
export function guessMime(filename: string, fallback?: string): string {
  if (fallback && fallback.startsWith("video/")) return fallback;
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "mkv":
      return "video/x-matroska";
    case "webm":
      return "video/webm";
    case "avi":
      return "video/x-msvideo";
    default:
      return fallback || "application/octet-stream";
  }
}

/** 过滤 FileList：只保留视频文件（后端还会再校验一遍 extension / contentType）。 */
export function isVideoFile(f: File): boolean {
  if (f.type && f.type.startsWith("video/")) return true;
  return /\.(mp4|m4v|mov|mkv|webm|avi)$/i.test(f.name);
}

// ---------- 3) 本地 probe metadata ----------

export type ProbedMetadata = {
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
};

/**
 * 本地 probe 视频：只用浏览器 <video> + objectUrl，不打后端。
 * 返回 durationSec / width / height；拿不到就 undefined，调用方容错。
 * 最多等 3s，超时直接 resolve 空对象，防止卡 UI。
 */
export function probeVideoMetadata(objectUrl: string): Promise<ProbedMetadata> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({});
      return;
    }
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
    };
    const ok = () => {
      if (done) return;
      cleanup();
      resolve({
        durationSec: Number.isFinite(v.duration) ? v.duration : undefined,
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
      });
    };
    const timeout = setTimeout(ok, 3000);
    v.addEventListener("loadedmetadata", () => {
      clearTimeout(timeout);
      ok();
    });
    v.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanup();
      resolve({});
    });
    v.src = objectUrl;
  });
}

// ---------- 4) 预签名 URL 真实 PUT 上传 ----------

export type UploadToPresignedArgs = {
  uploadUrl: string;
  uploadMethod?: "PUT" | "POST";
  file: File;
  contentType: string;
  /** 0~100 整数百分比，直接给 progress bar 用。 */
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
};

/**
 * 用 XMLHttpRequest 而不是 fetch 做 PUT：
 *   fetch Request.body 没有 upload progress 事件，xhr.upload.onprogress 才有。
 *   取消上传：调用方传 AbortController.signal，abort() 即可 xhr.abort()。
 */
export function uploadToPresignedUrl(
  args: UploadToPresignedArgs,
): Promise<void> {
  const { uploadUrl, file, contentType, onProgress, signal } = args;
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.max(
          0,
          Math.min(100, Math.floor((e.loaded / e.total) * 100)),
        );
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(
          new ApiError(
            xhr.status,
            `Upload to presigned URL failed (HTTP ${xhr.status})`,
          ),
        );
      }
    };

    xhr.onerror = () => {
      reject(new ApiError(0, "Upload to presigned URL failed (network error)"));
    };

    xhr.onabort = () => {
      reject(new ApiError(0, "Upload aborted by user"));
    };

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

// ---------- 5) 旧命名兼容层：VideoUploader 组件直接 import 这些名字 ----------

type UploadSessionCompatArgs = {
  projectId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type UploadSessionCompatResponse = {
  videoId: string;
  storageKey: string;
  uploadUrl: string;
  uploadMethod: "PUT" | "POST";
  uploadExpiresInSec: number;
};

/** VideoUploader 旧命名：createUploadSession → api.videos.createUploadSession。字段别名 sizeBytes→size。 */
export async function createUploadSession(
  args: UploadSessionCompatArgs,
): Promise<UploadSessionCompatResponse> {
  const raw = await videos.createUploadSession({
    projectId: args.projectId,
    filename: args.filename,
    contentType: args.contentType,
    size: args.sizeBytes,
  });
  return {
    videoId: raw.videoId,
    storageKey: raw.storageKey,
    uploadUrl: raw.uploadUrl,
    uploadMethod: "PUT",
    uploadExpiresInSec: 1800,
  };
}

type CompleteUploadCompatArgs = {
  videoId: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
};

/** VideoUploader 旧命名：completeUpload({ videoId, durationSec }) → api.videos.completeUpload(videoId, {duration})。 */
export async function completeUpload(args: CompleteUploadCompatArgs) {
  const { videoId, durationSec, ...rest } = args;
  return videos.completeUpload(videoId, {
    duration: durationSec,
    ...rest,
  });
}

/** VideoUploader 旧命名：startProcessing(videoId) → api.videos.triggerProcess → 返回 jobId。 */
export async function startProcessing(videoId: string): Promise<string> {
  const resp = await videos.triggerProcess(videoId);
  return resp.jobId;
}

export type SubscribeCompatHandlers = {
  /** 0~100 整数百分比；SSE 原生给的是 0~1 浮点，这里已经乘过 100。 */
  onProgress?: (pct: number, stage?: string) => void;
  onCompleted?: () => void;
  onFailed?: (error: string) => void;
};

/**
 * VideoUploader 旧命名 subscribeJobProgress：
 *   subscribeJobProgress(jobId, { onProgress(pct, stage), onCompleted, onFailed })。
 *   返回 unsubscribe()，组件 unmount / cleanupUpload 时调。
 */
export function subscribeJobProgress(
  jobId: string,
  handlers: SubscribeCompatHandlers,
): () => void {
  return jobs.subscribeJobEvents(jobId, {
    onProgress: (evt) => {
      const pct = Math.max(
        0,
        Math.min(100, Math.floor((evt.progress ?? 0) * 100)),
      );
      handlers.onProgress?.(pct, evt.stage);
    },
    onCompleted: () => handlers.onCompleted?.(),
    onFailed: (evt) => handlers.onFailed?.(evt.error),
  });
}
