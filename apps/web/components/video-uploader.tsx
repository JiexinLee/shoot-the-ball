"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Upload,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Play,
  Loader2,
  X,
  Trash2,
  UploadCloud,
} from "lucide-react";

export type UploadStatus =
  "pending" | "uploading" | "processing" | "success" | "error";

export interface UploadedVideo {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  createdAt: number;
  videoId?: string;
  jobId?: string;
}

export interface VideoUploaderProps {
  className?: string;
  onPreview?: (video: UploadedVideo) => void;
  onRemove?: (video: UploadedVideo) => void;
}

const MEGABYTE = 1024 * 1024;
const GIGABYTE = MEGABYTE * 1024;
const ACCEPTED = "video/*";
const MAX_SIZE_BYTES = 8 * GIGABYTE;

const API_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  "http://127.0.0.1:4000/v1";

const DEFAULT_PROJECT_ID = "proj-dev-default-001";

const VIDEO_EXT_ALLOWLIST = /\.(mp4|mov|mkv|m4v|webm|avi)$/i;

interface UploadSessionResponse {
  videoId: string;
  storageKey: string;
  uploadUrl: string;
  uploadMethod: "PUT" | "POST";
  uploadExpiresInSec: number;
}

interface ProcessResponse {
  jobId: string;
}

interface SseProgressEvent {
  jobId: string;
  stage?: string;
  progress?: number;
  status?: string;
}

interface SseFailedEvent {
  jobId: string;
  error?: string;
}

function formatBytes(n: number): string {
  if (n >= GIGABYTE) return `${(n / GIGABYTE).toFixed(2)} GB`;
  if (n >= MEGABYTE) return `${(n / MEGABYTE).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function isVideoFile(f: File): boolean {
  if (f.type && f.type.startsWith("video/")) return true;
  return VIDEO_EXT_ALLOWLIST.test(f.name);
}

function guessMime(name: string, fallback: string): string {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".m4v":
      return "video/x-m4v";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".avi":
      return "video/x-msvideo";
    default:
      return fallback || "video/mp4";
  }
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function probeVideo(
  previewUrl: string,
): Promise<{ durationSec?: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = previewUrl;
    const done = () => {
      resolve({
        durationSec: isFinite(v.duration) ? v.duration : undefined,
        width: v.videoWidth || undefined,
        height: v.videoHeight || undefined,
      });
      v.remove();
    };
    v.addEventListener("loadedmetadata", done, { once: true });
    v.addEventListener("error", done, { once: true });
    setTimeout(done, 5000);
  });
}

async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = new Headers(init.headers ?? {});
  if (
    !headers.has("Content-Type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  if (!res.ok) {
    const err =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : null) || `Request failed (HTTP ${res.status})`;
    throw new Error(err);
  }
  return data;
}

async function createUploadSession(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<UploadSessionResponse> {
  return apiFetch<UploadSessionResponse>("/videos/upload-session", {
    method: "POST",
    body: JSON.stringify({
      projectId: DEFAULT_PROJECT_ID,
      filename: input.filename,
      contentType: input.contentType,
      size: input.sizeBytes,
    }),
  });
}

async function uploadToPresignedUrl(args: {
  uploadUrl: string;
  uploadMethod: "PUT" | "POST";
  file: File;
  contentType: string;
  onProgress: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { uploadUrl, uploadMethod, file, contentType, onProgress, signal } =
    args;
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(uploadMethod, uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.max(0, Math.min(100, (e.loaded / e.total) * 100));
      onProgress(pct);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `Upload to storage failed (HTTP ${xhr.status}): ${xhr.statusText}`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

async function completeUpload(args: {
  videoId: string;
  durationSec?: number;
  width?: number;
  height?: number;
}): Promise<void> {
  const body: Record<string, number> = {};
  if (args.durationSec != null) body.duration = args.durationSec;
  if (args.width != null) body.width = args.width;
  if (args.height != null) body.height = args.height;
  await apiFetch(`/videos/${args.videoId}/complete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function startProcessing(videoId: string): Promise<string> {
  const data = await apiFetch<ProcessResponse>(`/videos/${videoId}/process`, {
    method: "POST",
  });
  return data.jobId;
}

function subscribeJobProgress(args: {
  jobId: string;
  videoId: string;
  onProgress: (pct: number, stage?: string) => void;
  onCompleted: () => void;
  onFailed: (err: string) => void;
}): () => void {
  const { jobId, onProgress, onCompleted, onFailed } = args;
  let closed = false;
  let es: EventSource | null = null;
  const hardStopAt = Date.now() + 10 * 60 * 1000;
  let hardStopTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    closed = true;
    if (es) {
      try {
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
    if (hardStopTimer) clearTimeout(hardStopTimer);
  };

  const start = () => {
    if (closed) return;
    const url = `${API_BASE}/jobs/${jobId}/events`;
    es = new EventSource(url, { withCredentials: false });
    es.addEventListener("progress", (e) => {
      try {
        const payload = JSON.parse(e.data) as SseProgressEvent;
        const pct =
          typeof payload.progress === "number"
            ? Math.max(0, Math.min(100, payload.progress * 100))
            : undefined;
        if (pct != null) onProgress(pct, payload.stage);
      } catch {
        /* ignore malformed event */
      }
    });
    es.addEventListener("completed", () => {
      onCompleted();
      cleanup();
    });
    es.addEventListener("failed", (e) => {
      try {
        const payload = JSON.parse(e.data) as SseFailedEvent;
        onFailed(payload.error ?? "AI analysis failed");
      } catch {
        onFailed("AI analysis failed");
      }
      cleanup();
    });
    es.addEventListener("heartbeat", () => {
      /* keep-alive only */
    });
    es.onerror = () => {
      if (closed) return;
      cleanup();
      if (Date.now() >= hardStopAt) {
        onFailed("SSE connection timed out");
        return;
      }
      setTimeout(start, 2500);
    };
  };

  hardStopTimer = setTimeout(
    () => {
      cleanup();
      onFailed("AI analysis timed out after 10 minutes");
    },
    10 * 60 * 1000,
  );

  void hardStopAt;
  start();
  return cleanup;
}

export function VideoUploader({
  className,
  onPreview,
  onRemove,
}: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCountRef = useRef(0);
  const sseCleanupRef = useRef<Map<string, () => void>>(new Map());
  const aborterRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      sseCleanupRef.current.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
      sseCleanupRef.current.clear();
      aborterRef.current.forEach((ab) => ab.abort());
      aborterRef.current.clear();
      videos.forEach((v) => URL.revokeObjectURL(v.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateVideo = (id: string, patch: Partial<UploadedVideo>) =>
    setVideos((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    );

  const cleanupUpload = (id: string, previewUrl: string) => {
    const sseCleanup = sseCleanupRef.current.get(id);
    if (sseCleanup) {
      try {
        sseCleanup();
      } catch {
        /* ignore */
      }
      sseCleanupRef.current.delete(id);
    }
    const ab = aborterRef.current.get(id);
    if (ab) {
      ab.abort();
      aborterRef.current.delete(id);
    }
    URL.revokeObjectURL(previewUrl);
  };

  const startRealUploadAndProcess = async (v: UploadedVideo) => {
    const contentType = guessMime(v.name, v.mimeType);
    updateVideo(v.id, { status: "uploading", progress: 0 });

    try {
      const session = await createUploadSession({
        filename: v.name,
        contentType,
        sizeBytes: v.sizeBytes,
      });
      updateVideo(v.id, { videoId: session.videoId });

      const ab = new AbortController();
      aborterRef.current.set(v.id, ab);
      const signal = ab.signal;

      await uploadToPresignedUrl({
        uploadUrl: session.uploadUrl,
        uploadMethod: session.uploadMethod,
        file: v.file,
        contentType,
        onProgress: (pct) => updateVideo(v.id, { progress: pct }),
        signal,
      });
      aborterRef.current.delete(v.id);

      await completeUpload({
        videoId: session.videoId,
        durationSec: v.durationSec,
        width: v.width,
        height: v.height,
      });

      updateVideo(v.id, {
        status: "processing",
        progress: 0,
      });
      const jobId = await startProcessing(session.videoId);
      updateVideo(v.id, { jobId });

      sseCleanupRef.current.set(
        v.id,
        subscribeJobProgress({
          jobId,
          videoId: session.videoId,
          onProgress: (pct, _stage) => {
            updateVideo(v.id, { progress: pct });
          },
          onCompleted: () => {
            updateVideo(v.id, { progress: 100, status: "success" });
            sseCleanupRef.current.delete(v.id);
          },
          onFailed: (err) => {
            updateVideo(v.id, { status: "error", error: err });
            sseCleanupRef.current.delete(v.id);
          },
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown upload error";
      updateVideo(v.id, { status: "error", error: message });
    }
  };

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isVideoFile);
    if (!arr.length) return;

    const created: UploadedVideo[] = await Promise.all(
      arr.map(async (file) => {
        const id = crypto.randomUUID ? crypto.randomUUID() : uid();
        const previewUrl = URL.createObjectURL(file);
        const probe = await probeVideo(previewUrl);
        const mimeType = guessMime(file.name, file.type);
        return {
          id,
          file,
          previewUrl,
          name: file.name,
          sizeBytes: file.size,
          mimeType,
          progress: 0,
          status: "pending",
          createdAt: Date.now(),
          ...probe,
        };
      }),
    );

    setVideos((prev) => [...created, ...prev]);
    created.forEach((v) => {
      if (v.sizeBytes > MAX_SIZE_BYTES) {
        updateVideo(v.id, {
          status: "error",
          error: `File too large (max ${formatBytes(MAX_SIZE_BYTES)})`,
        });
        return;
      }
      void startRealUploadAndProcess(v);
    });
  };

  const validateDragData = (e: React.DragEvent<HTMLDivElement>): boolean => {
    if (!e.dataTransfer) return false;
    if (
      e.dataTransfer.types &&
      Array.from(e.dataTransfer.types).includes("Files")
    ) {
      return true;
    }
    const items = e.dataTransfer.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") return true;
      }
    }
    return false;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!validateDragData(e)) return;
    dragCountRef.current += 1;
    if (dragCountRef.current === 1) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = Math.max(0, dragCountRef.current - 1);
    if (dragCountRef.current === 0) {
      setDragActive(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleRemove = (v: UploadedVideo) => {
    cleanupUpload(v.id, v.previewUrl);
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
    onRemove?.(v);
  };

  const statusBadge = (s: UploadStatus, progress: number) => {
    switch (s) {
      case "pending":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3" /> Pending
          </span>
        );
      case "uploading":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Uploading{" "}
            {progress.toFixed(0)}%
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
            <Loader2 className="h-3 w-3 animate-spin" /> AI Processing…
          </span>
        );
      case "success":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Ready
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--destructive)]">
            <AlertCircle className="h-3 w-3" /> Failed
          </span>
        );
    }
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* ---- Drop Zone ---- */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-all duration-200 select-none",
          dragActive
            ? "border-primary bg-(--primary)/5 scale-[1.01]"
            : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60 hover:bg-[var(--card)]/80",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-2xl transition-all",
            dragActive
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--primary)]/10 text-[var(--primary)] group-hover:bg-[var(--primary)]/20",
          )}
        >
          {dragActive ? (
            <UploadCloud className="h-8 w-8" />
          ) : (
            <Upload className="h-8 w-8" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">
            Drag and drop video files here, or
            <span className="mx-1 text-[var(--primary)] underline underline-offset-4">
              click to browse
            </span>
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            Supports MP4 / MOV / MKV and other common formats · Max 8 GB per
            file · Batch upload enabled
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="pointer-events-none"
        >
          <FileVideo className="h-4 w-4" /> Select Video
        </Button>
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[var(--primary)]/5" />
        )}
      </div>

      {/* ---- Upload List ---- */}
      {videos.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--muted-foreground)]">
              Upload Queue · {videos.length} item
              {videos.length !== 1 ? "s" : ""}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                videos.forEach((v) => cleanupUpload(v.id, v.previewUrl));
                setVideos([]);
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear All
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => (
              <Card
                key={v.id}
                className="group overflow-hidden border transition-all hover:border-[var(--primary)]/40"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden bg-black">
                  <video
                    src={v.previewUrl}
                    muted
                    preload="metadata"
                    className="h-full w-full object-cover"
                    poster=""
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.currentTime = Math.min((v.durationSec ?? 5) / 3, 3);
                      el.play().catch(() => {});
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.pause();
                    }}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3">
                    <div className="flex items-center justify-between text-xs text-white/80">
                      <span>{formatDuration(v.durationSec)}</span>
                      {v.width && v.height && (
                        <span>
                          {v.width}×{v.height}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Preview"
                    onClick={() => onPreview?.(v)}
                    className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--primary)]/95 text-[var(--primary-foreground)] opacity-0 shadow-lg transition-all hover:scale-110 group-hover:opacity-100"
                  >
                    <Play className="h-5 w-5 translate-x-0.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => handleRemove(v)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur transition-all hover:bg-black/80 hover:text-white group-hover:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  {v.status === "success" && (
                    <CheckCircle2 className="absolute left-2 top-2 h-5 w-5 text-emerald-400" />
                  )}
                </div>

                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-1 text-sm font-medium">
                      {v.name}
                    </CardTitle>
                    {statusBadge(v.status, v.progress)}
                  </div>
                  <CardDescription className="mt-1">
                    {formatBytes(v.sizeBytes)} · {v.mimeType}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-2 p-4 pt-0">
                  {(v.status === "uploading" || v.status === "processing") && (
                    <Progress value={v.progress} className="h-1.5" />
                  )}
                  {v.status === "error" && v.error && (
                    <p className="rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
                      {v.error}
                    </p>
                  )}
                </CardContent>

                <CardFooter className="flex justify-between gap-2 border-t border-[var(--border)] p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(v)}
                    className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={v.status !== "success"}
                    onClick={() => onPreview?.(v)}
                  >
                    <Play className="h-4 w-4" /> Preview
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
