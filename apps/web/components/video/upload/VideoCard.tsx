"use client";

import { useEffect, useRef } from "react";
import { Play, Trash2, Film, Check } from "lucide-react";
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
  selectionEnabled?: boolean;
  selectedHighlightIds?: Set<string>;
  onToggleHighlight?: (highlightId: string) => void;
}

export function VideoCard({
  video,
  onPreview,
  onRemove,
  selectionEnabled = false,
  selectedHighlightIds,
  onToggleHighlight,
}: VideoCardProps) {
  const showProgress =
    video.status === "uploading" ||
    video.status === "processing" ||
    video.status === "calibrating";

  const hasHighlights = video.highlights && video.highlights.length > 0;

  return (
    <Card className="group overflow-hidden border transition-all hover:border-[var(--primary)]/40">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-sm font-medium">
              {video.name}
            </CardTitle>
            <CardDescription className="mt-1">
              {formatBytes(video.sizeBytes)} · {video.mimeType}
              {video.durationSec
                ? ` · ${formatDuration(video.durationSec)}`
                : ""}
            </CardDescription>
          </div>
          <StatusBadge status={video.status} progress={video.progress} />
        </div>
      </CardHeader>

      <CardContent className="space-y-2 p-4 pt-0">
        {showProgress && <Progress value={video.progress} className="h-1.5" />}
        {video.status === "error" && video.error && (
          <p className="rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
            {video.error}
          </p>
        )}

        {hasHighlights ? (
          <HighlightsSection
            highlights={video.highlights!}
            previewUrl={video.previewUrl}
            selectionEnabled={selectionEnabled}
            selectedHighlightIds={selectedHighlightIds}
            onToggleHighlight={onToggleHighlight}
          />
        ) : (
          video.status === "success" && (
            <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">
              No highlights detected yet.
            </p>
          )
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
          onClick={() => onPreview(video)}
          className="gap-1.5"
        >
          <Play className="h-4 w-4" /> Preview Video
        </Button>
      </CardFooter>
    </Card>
  );
}

function HighlightsSection({
  highlights,
  previewUrl,
  selectionEnabled,
  selectedHighlightIds,
  onToggleHighlight,
}: {
  highlights: Highlight[];
  previewUrl: string;
  selectionEnabled?: boolean;
  selectedHighlightIds?: Set<string>;
  onToggleHighlight?: (id: string) => void;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
      <div className="flex items-center justify-between gap-1.5 text-[11px] font-semibold text-emerald-600">
        <div className="flex items-center gap-1.5">
          <Film className="h-3.5 w-3.5" /> Highlight Clips ({highlights.length})
        </div>
        {selectionEnabled && selectedHighlightIds && (
          <span className="font-mono text-emerald-700/80">
            selected:{" "}
            {highlights.filter((h) => selectedHighlightIds.has(h.id)).length}/
            {highlights.length}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {highlights.map((h) => (
          <HighlightClipPlayer
            key={h.id}
            highlight={h}
            previewUrl={previewUrl}
            selectionEnabled={selectionEnabled}
            selected={selectedHighlightIds?.has(h.id) ?? false}
            onToggleSelect={() => onToggleHighlight?.(h.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function HighlightClipPlayer({
  highlight,
  clip,
  previewUrl,
  video,
  selectionEnabled,
  selected,
  onToggleSelect,
  className,
}: {
  highlight?: Highlight;
  clip?: Highlight;
  previewUrl?: string;
  video?: UploadedVideo;
  selectionEnabled?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  className?: string;
}) {
  // React Hooks 必须放在所有 early return 之前，顺序一致。
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const h = highlight ?? clip;
  // 优先用后端裁剪好的短 clip URL（整个 MP4 只有 [start,end] 几秒钟，
  // 原生进度条会正确显示 0:04/0:04 而不是 0:04/0:17 全视频）；
  // 没有裁剪 URL 才 fallback 到原视频 + 旧的 timeupdate clamp。
  const clipUrl = typeof h?.clipUrl === "string" ? h.clipUrl : null;
  const src = clipUrl ?? previewUrl ?? video?.previewUrl;
  const isTrimmedClip = Boolean(clipUrl);

  const score =
    h && typeof h.metadata?.score === "number"
      ? (h.metadata.score as number)
      : null;
  const teamSide =
    h && typeof h.metadata?.teamSide === "string"
      ? (h.metadata.teamSide as string).toUpperCase()
      : null;
  const start = h
    ? Number.isFinite(h.startTime)
      ? Number(h.startTime)
      : Number.isFinite(h.startTimeSec)
        ? Number(h.startTimeSec)
        : 0
    : 0;
  const end = h
    ? Number.isFinite(h.endTime)
      ? Number(h.endTime)
      : Number.isFinite(h.endTimeSec)
        ? Number(h.endTimeSec)
        : start + 5
    : start + 5;
  const isMock = Boolean(h?.metadata?.mock);

  // 哪怕 h/src 暂时为空也必须先 call useEffect，否则 Rules of Hooks 会在 h 从 null→有值时顺序变。
  useEffect(() => {
    const v = videoElRef.current;
    if (!v || !h || !src) return;

    // 如果 src 是后端裁剪好的短 clip：整个 MP4 只有 [start,end] 片段，
    // 只需要保证到末尾循环回 0 秒开始循环播放就行，不用做时间平移。
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

    // fallback: 没裁好的全视频 URL：timeupdate clamp 在 [start,end] 范围，loadedmetadata seek 到 start
    const hasRange = end > start;
    const safeStart = hasRange ? start : 0;
    const safeEnd = hasRange ? end : Infinity;
    const seekToStart = (tolerance = 0) => {
      try {
        const duration = Number.isFinite(v.duration) ? v.duration : safeEnd;
        const clamped = Math.max(0, Math.min(duration, safeStart));
        if (tolerance <= 0 || Math.abs(v.currentTime - clamped) > tolerance) {
          v.currentTime = clamped;
        }
      } catch {
        /* ignore */
      }
    };
    const onLoaded = () => seekToStart(0.05);
    const onTime = () => {
      try {
        if (
          hasRange &&
          (v.currentTime < safeStart || v.currentTime >= safeEnd)
        ) {
          seekToStart(0);
        }
      } catch {
        /* ignore */
      }
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    if (Number.isFinite(v.duration) && v.duration > 0) {
      seekToStart(0.05);
    }
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [h, src, start, end, isTrimmedClip]);

  // early return 必须在所有 Hooks 之后
  if (!h || !src) return null;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-[var(--card)]",
        isMock ? "border-dashed border-amber-500/40" : "border-[var(--border)]",
        selected &&
          "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--background)]",
        className,
      )}
    >
      {selectionEnabled && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={cn(
            "absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded border shadow-sm backdrop-blur transition-all",
            selected
              ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "border-white/60 bg-black/30 text-white hover:bg-black/50",
          )}
          aria-label={selected ? "Unselect clip" : "Select clip"}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </button>
      )}

      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video
          ref={videoElRef}
          src={src}
          muted
          preload="metadata"
          controls
          className="h-full w-full object-contain"
        />
      </div>
      <div className="space-y-1 p-2">
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="font-mono tabular-nums text-[var(--muted-foreground)]">
            {formatDuration(start)} – {formatDuration(end)}
          </span>
          <span className="text-[var(--foreground)]">
            · {h.type.replace(/_/g, " ")}
          </span>
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
          {isMock && (
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] border-dashed border-amber-500/40 text-amber-600"
            >
              MOCK
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-[var(--muted-foreground)]">
          <span>clip · {formatDuration(end - start)}</span>
          <span>conf {(h.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}
