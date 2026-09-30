"use client";

import { Play, X, CheckCircle2, Trash2, Film } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./StatusBadge";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadedVideo } from "@/lib/types";
import type { Highlight } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VideoCardProps {
  video: UploadedVideo;
  onPreview: (video: UploadedVideo) => void;
  onRemove: (video: UploadedVideo) => void;
}

export function VideoCard({ video, onPreview, onRemove }: VideoCardProps) {
  const showProgress =
    video.status === "uploading" ||
    video.status === "processing" ||
    video.status === "calibrating";

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
        {video.status === "calibrating" && (
          <Badge
            variant="secondary"
            className="absolute left-2 top-2 h-5 bg-amber-500/15 text-[11px] text-amber-500 border border-amber-500/30"
          >
            Calibrating…
          </Badge>
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

        {/* Highlights mini preview（页面等待 SSE completed 后就有了，直接展示 2-3 条） */}
        {video.highlights && video.highlights.length > 0 && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
              <Film className="h-3.5 w-3.5" /> Highlights (
              {video.highlights.length})
            </div>
            <ul className="space-y-1">
              {video.highlights.slice(0, 4).map((h) => (
                <HighlightRow key={h.id} h={h} />
              ))}
              {video.highlights.length > 4 && (
                <li className="text-[10px] text-[var(--muted-foreground)] pl-5">
                  +{video.highlights.length - 4} more — open Review page.
                </li>
              )}
            </ul>
          </div>
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
          disabled={video.status !== "success" && !video.highlights}
          onClick={() => onPreview(video)}
        >
          <Play className="h-4 w-4" /> Preview
        </Button>
      </CardFooter>
    </Card>
  );
}

function HighlightRow({ h }: { h: Highlight }) {
  const score =
    typeof h.metadata?.score === "number" ? (h.metadata.score as number) : null;
  const teamSide =
    typeof h.metadata?.teamSide === "string"
      ? (h.metadata.teamSide as string).toUpperCase()
      : null;
  /* 兼容新旧字段名：contracts 定稿是 startTime/endTime，旧本地类型是 startTimeSec */
  const start = Number.isFinite(h.startTime)
    ? Number(h.startTime)
    : Number.isFinite(h.startTimeSec)
      ? Number(h.startTimeSec)
      : 0;
  const end = Number.isFinite(h.endTime)
    ? Number(h.endTime)
    : Number.isFinite(h.endTimeSec)
      ? Number(h.endTimeSec)
      : 0;
  const isMock = Boolean(h.metadata?.mock);
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-[11px]",
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]" />
        <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
          {formatDuration(start)} – {formatDuration(end)}
        </span>
        <span className="truncate text-[var(--foreground)]">· {h.type}</span>
        {score && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[9px] bg-sky-500/10 text-sky-600"
          >
            {score}PT
          </Badge>
        )}
        {teamSide && (
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1.5 text-[9px]",
              teamSide === "HOME"
                ? "border-emerald-500/40 text-emerald-600"
                : "border-rose-500/40 text-rose-600",
            )}
          >
            {teamSide}
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isMock && (
          <Badge
            variant="outline"
            className="h-4 px-1.5 text-[9px] border-dashed border-amber-500/40 text-amber-600"
          >
            MOCK
          </Badge>
        )}
        <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
          conf {(h.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </li>
  );
}
