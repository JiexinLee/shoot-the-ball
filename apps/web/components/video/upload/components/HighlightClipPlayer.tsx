"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";
import { formatHighlightType, type UploadedVideo } from "@/lib/types";
import type { Highlight } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface HighlightClipPlayerProps {
  highlight?: Highlight;
  clip?: Highlight;
  previewUrl?: string;
  video?: UploadedVideo;
  selectionEnabled?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  className?: string;
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
}: HighlightClipPlayerProps) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const h = highlight ?? clip;
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

  useEffect(() => {
    const v = videoElRef.current;
    if (!v || !h || !src) return;

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
            · {formatHighlightType(h?.type, score)}
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
