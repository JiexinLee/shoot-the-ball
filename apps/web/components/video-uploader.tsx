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
  | "pending"
  | "uploading"
  | "processing"
  | "success"
  | "error";

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

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function probeVideo(
  previewUrl: string
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

export function VideoUploader({ className, onPreview, onRemove }: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    const m = timersRef.current;
    return () => {
      m.forEach((t) => clearInterval(t));
      m.clear();
      videos.forEach((v) => URL.revokeObjectURL(v.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateVideo = (id: string, patch: Partial<UploadedVideo>) =>
    setVideos((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...patch } : v))
    );

  const cleanupUpload = (id: string, previewUrl: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearInterval(timer);
    timersRef.current.delete(id);
    URL.revokeObjectURL(previewUrl);
  };

  const startMockUpload = (v: UploadedVideo) => {
    let progress = v.progress;
    const timer = setInterval(() => {
      progress += Math.random() * 14 + 2;
      if (progress >= 100) {
        progress = 100;
        updateVideo(v.id, { progress: 100, status: "processing" });
        clearInterval(timer);
        timersRef.current.delete(v.id);
        setTimeout(() => {
          updateVideo(v.id, { status: "success" });
        }, 800 + Math.random() * 1200);
        return;
      }
      updateVideo(v.id, { progress });
    }, 220);
    timersRef.current.set(v.id, timer);
    updateVideo(v.id, { status: "uploading", progress });
  };

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("video/"));
    if (!arr.length) return;

    const created: UploadedVideo[] = await Promise.all(
      arr.map(async (file) => {
        const id = uid();
        const previewUrl = URL.createObjectURL(file);
        const probe = await probeVideo(previewUrl);
        return {
          id,
          file,
          previewUrl,
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type || "video/mp4",
          progress: 0,
          status: "pending",
          createdAt: Date.now(),
          ...probe,
        };
      })
    );

    setVideos((prev) => [...created, ...prev]);
    created.forEach((v) => {
      if (v.sizeBytes > MAX_SIZE_BYTES) {
        updateVideo(v.id, {
          status: "error",
          error: `文件过大（上限 ${formatBytes(MAX_SIZE_BYTES)}）`,
        });
        return;
      }
      startMockUpload(v);
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
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
            <Loader2 className="h-3 w-3" /> 等待中
          </span>
        );
      case "uploading":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
            <Loader2 className="h-3 w-3 animate-spin" /> 上传中 {progress.toFixed(0)}%
          </span>
        );
      case "processing":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
            <Loader2 className="h-3 w-3 animate-spin" /> AI 分析中…
          </span>
        );
      case "success":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> 已就绪
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--destructive)]">
            <AlertCircle className="h-3 w-3" /> 失败
          </span>
        );
    }
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* ---- 拖拽区 ---- */}
      <div
        onDragEnter={(e) => {
          handleDrag(e);
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          handleDrag(e);
          const r = e.currentTarget.getBoundingClientRect();
          const outside =
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom;
          if (outside) setDragActive(false);
        }}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-all duration-200 select-none",
          dragActive
            ? "border-[var(--primary)] bg-[var(--primary)]/5 scale-[1.01]"
            : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60 hover:bg-[var(--card)]/80"
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
              : "bg-[var(--primary)]/10 text-[var(--primary)] group-hover:bg-[var(--primary)]/20"
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
            拖拽视频文件到这里，或者
            <span className="mx-1 text-[var(--primary)] underline underline-offset-4">
              点击选择
            </span>
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            支持 MP4 / MOV / MKV 等常见视频格式 · 单个文件上限 8 GB · 可批量上传
          </p>
        </div>
        <Button size="sm" variant="secondary" type="button" className="pointer-events-none">
          <FileVideo className="h-4 w-4" /> 选择视频
        </Button>
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[var(--primary)]/5" />
        )}
      </div>

      {/* ---- 列表 ---- */}
      {videos.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--muted-foreground)]">
              上传队列 · {videos.length} 个
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                videos.forEach((v) => cleanupUpload(v.id, v.previewUrl));
                setVideos([]);
              }}
            >
              <Trash2 className="h-4 w-4" /> 清空列表
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => (
              <Card
                key={v.id}
                className="group overflow-hidden border transition-all hover:border-[var(--primary)]/40"
              >
                {/* 缩略图 */}
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
                      {v.width && v.height && <span>{v.width}×{v.height}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="预览"
                    onClick={() => onPreview?.(v)}
                    className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--primary)]/95 text-[var(--primary-foreground)] opacity-0 shadow-lg transition-all hover:scale-110 group-hover:opacity-100"
                  >
                    <Play className="h-5 w-5 translate-x-0.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="移除"
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
                    <Trash2 className="h-4 w-4" /> 删除
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={v.status !== "success"}
                    onClick={() => onPreview?.(v)}
                  >
                    <Play className="h-4 w-4" /> 预览
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
