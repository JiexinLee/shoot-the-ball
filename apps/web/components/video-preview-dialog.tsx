"use client";

import * as React from "react";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { UploadedVideo } from "@/components/video-uploader";

export interface VideoPreviewDialogProps {
  video: UploadedVideo | null;
  onClose: () => void;
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

function formatBytes(n: number): string {
  const mb = 1024 * 1024;
  const gb = mb * 1024;
  if (n >= gb) return `${(n / gb).toFixed(2)} GB`;
  if (n >= mb) return `${(n / mb).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function VideoPreviewDialog({ video, onClose }: VideoPreviewDialogProps) {
  React.useEffect(() => {
    if (!video) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [video, onClose]);

  if (!video) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = video.previewUrl;
    a.download = video.name;
    a.click();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className={cn(
          "relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部栏 */}
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <h3 className="line-clamp-1 text-lg font-semibold">{video.name}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatBytes(video.sizeBytes)} · {formatDuration(video.durationSec)}
              {video.width && video.height ? ` · ${video.width}×${video.height}` : ""}
              {video.mimeType ? ` · ${video.mimeType}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" /> 下载原文件
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭"
              onClick={onClose}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* 视频区 */}
        <div className="flex-1 overflow-auto bg-black">
          <video
            autoPlay
            controls
            controlsList="nodownload"
            className="mx-auto block max-h-[70vh] w-full bg-black"
            src={video.previewUrl}
          />
        </div>

        {/* 底部提示 */}
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3 text-xs text-[var(--muted-foreground)]">
          提示：当前为本地开发模式，文件仅在浏览器中预览。接入后端后，会调用
          <span className="mx-1 font-mono text-[var(--primary)]">POST /v1/videos</span>
          上传到对象存储并进入 AI 分析队列。
        </div>
      </div>
    </div>
  );
}
