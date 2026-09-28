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
}

export function VideoPreviewDialog({
  video,
  onClose,
}: VideoPreviewDialogProps) {
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
          "relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <h3 className="line-clamp-1 text-lg font-semibold">{video.name}</h3>
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
            autoPlay
            controls
            controlsList="nodownload"
            className="mx-auto block max-h-[70vh] w-full bg-black"
            src={video.previewUrl}
          />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3 text-xs text-[var(--muted-foreground)]">
          Note: Currently in local dev mode, files are previewed in browser
          only. After connecting the backend, this will call
          <span className="mx-1 font-mono text-[var(--primary)]">
            POST /v1/videos
          </span>
          to upload to object storage and enter the AI processing queue.
        </div>
      </div>
    </div>
  );
}
