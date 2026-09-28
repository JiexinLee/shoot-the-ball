"use client";

import { Play, X, CheckCircle2, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "./StatusBadge";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadedVideo } from "@/lib/types";

interface VideoCardProps {
  video: UploadedVideo;
  onPreview: (video: UploadedVideo) => void;
  onRemove: (video: UploadedVideo) => void;
}

export function VideoCard({ video, onPreview, onRemove }: VideoCardProps) {
  const showProgress =
    video.status === "uploading" || video.status === "processing";

  return (
    <Card className="group overflow-hidden border transition-all hover:border-[var(--primary)]/40">
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video
          src={video.previewUrl}
          muted
          preload="metadata"
          className="h-full w-full object-cover"
          poster=""
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            el.currentTime = Math.min((video.durationSec ?? 5) / 3, 3);
            el.play().catch(() => {});
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.pause();
          }}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3">
          <div className="flex items-center justify-between text-xs text-white/80">
            <span>{formatDuration(video.durationSec)}</span>
            {video.width && video.height && (
              <span>
                {video.width}×{video.height}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Preview"
          onClick={() => onPreview(video)}
          className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--primary)]/95 text-[var(--primary-foreground)] opacity-0 shadow-lg transition-all hover:scale-110 group-hover:opacity-100"
        >
          <Play className="h-5 w-5 translate-x-0.5" />
        </button>
        <button
          type="button"
          aria-label="Remove"
          onClick={() => onRemove(video)}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 backdrop-blur transition-all hover:bg-black/80 hover:text-white group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
        {video.status === "success" && (
          <CheckCircle2 className="absolute left-2 top-2 h-5 w-5 text-emerald-400" />
        )}
      </div>

      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-1 text-sm font-medium">
            {video.name}
          </CardTitle>
          <StatusBadge status={video.status} progress={video.progress} />
        </div>
        <CardDescription className="mt-1">
          {formatBytes(video.sizeBytes)} · {video.mimeType}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-2 p-4 pt-0">
        {showProgress && <Progress value={video.progress} className="h-1.5" />}
        {video.status === "error" && video.error && (
          <p className="rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
            {video.error}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex justify-between gap-2 border-t border-[var(--border)] p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(video)}
          className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={video.status !== "success"}
          onClick={() => onPreview(video)}
        >
          <Play className="h-4 w-4" /> Preview
        </Button>
      </CardFooter>
    </Card>
  );
}
