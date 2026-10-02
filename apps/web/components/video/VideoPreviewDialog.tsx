"use client";

import * as React from "react";
import { X, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadedVideo } from "@/lib/types";

export interface VideoPreviewDialogProps {
  video: UploadedVideo | null;
  onClose: () => void;
  clipStartSec?: number | null;
  clipEndSec?: number | null;
  clipTitle?: string | null;
  /**
   * 后端真裁剪好的短 MP4 presigned URL（exports bucket）。
   * 如果提供了就直接用这个当 <video src>，进度条显示 clip 自己的时长
   * （比如 4s），而不是全视频 17s；hasClip 仍会生效做兜底 guard + 末尾循环。
   */
  clipSrc?: string | null;
}

export function VideoPreviewDialog({
  video,
  onClose,
  clipStartSec,
  clipEndSec,
  clipTitle,
  clipSrc,
}: VideoPreviewDialogProps) {
  const videoElRef = React.useRef<HTMLVideoElement | null>(null);
  const hasClip =
    typeof clipStartSec === "number" &&
    typeof clipEndSec === "number" &&
    clipEndSec > clipStartSec;
  const effectiveSrc = clipSrc ?? video?.previewUrl ?? "";
  const isTrimmedClip = Boolean(clipSrc);

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

  React.useEffect(() => {
    const v = videoElRef.current;
    if (!v) return;

    // 1) 用了后端裁剪好的短 clip：整个 MP4 就是进球片段，不需要 seek 平移
    //    只需要到末尾 seek 回 0，循环播放即可
    if (isTrimmedClip) {
      const onTime = () => {
        try {
          if (
            Number.isFinite(v.duration) &&
            v.duration > 0.2 &&
            v.currentTime >= v.duration - 0.05
          ) {
            v.currentTime = 0;
          }
        } catch {
          /* ignore */
        }
      };
      v.addEventListener("timeupdate", onTime);
      return () => {
        v.removeEventListener("timeupdate", onTime);
      };
    }

    // 2) fallback：全视频 URL + clip 区间 clamp（Dialog 打开时 loadedmetadata seek 到 start，
    //    到 end 循环回 start，用户拖 slider 到 <start 也立刻拉回 start）
    if (!hasClip) return;
    const start = clipStartSec as number;
    const end = clipEndSec as number;
    const seekToStart = () => {
      try {
        v.currentTime = Math.max(0, Math.min(v.duration || end, start));
      } catch {
        /* ignore */
      }
    };
    const onLoaded = () => seekToStart();
    const onTime = () => {
      try {
        if (v.currentTime >= end) seekToStart();
        if (v.currentTime < start) seekToStart();
      } catch {
        /* ignore */
      }
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    seekToStart();
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [
    hasClip,
    isTrimmedClip,
    clipStartSec,
    clipEndSec,
    clipSrc,
    video?.previewUrl,
  ]);

  if (!video) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = clipSrc ?? video.previewUrl;
    a.download = video.name;
    a.click();
  };

  const clipTag = hasClip
    ? `(${String(clipStartSec?.toFixed?.(0) ?? clipStartSec)}s–${String(
        clipEndSec?.toFixed?.(0) ?? clipEndSec,
      )}s clip)`
    : null;

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
          "relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <h3 className="line-clamp-1 text-lg font-semibold">
              {clipTitle ?? video.name}
              {clipTag && (
                <span className="ml-2 text-xs font-normal text-[var(--primary)]">
                  · {clipTag}
                </span>
              )}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatBytes(video.sizeBytes)} ·{" "}
              {formatDuration(video.durationSec)}
              {video.width && video.height
                ? ` · ${video.width}×${video.height}`
                : ""}
              {video.mimeType ? ` · ${video.mimeType}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" /> Download Original
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={onClose}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-black">
          <video
            ref={videoElRef}
            autoPlay
            controls
            controlsList="nodownload"
            className="mx-auto block max-h-[70vh] w-full bg-black"
            src={effectiveSrc}
          />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3 text-xs text-[var(--muted-foreground)]">
          {hasClip ? (
            <>
              Highlight preview is looping on the selected clip segment.
              Download Original will export the full video.
            </>
          ) : (
            <>
              Note: Currently in local dev mode, files are previewed in browser
              only. After connecting the backend, this will call
              <span className="mx-1 font-mono text-[var(--primary)]">
                POST /v1/videos
              </span>
              to upload to object storage and enter the AI processing queue.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
