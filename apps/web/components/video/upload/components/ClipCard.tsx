"use client";

import { Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatHighlightType,
  type UploadedVideo,
  type Highlight,
} from "@/lib/types";
import { HighlightClipPlayer } from "./HighlightClipPlayer";

export interface ClipCardProps {
  clip: Highlight;
  video: UploadedVideo;
  selectionEnabled: boolean;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
  onPreviewClip: () => void;
  onRemoveClip: () => void;
  className?: string;
}

function formatClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const sec = Math.floor(s);
  const m = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  const h = Math.floor(m / 60);
  if (h > 0) {
    const mm = String(m % 60).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

export function ClipCard({
  clip,
  video,
  selectionEnabled,
  selected,
  onToggleSelect,
  onPreviewClip,
  onRemoveClip,
  className,
}: ClipCardProps) {
  const conf = Math.max(
    0,
    Math.min(100, Math.round((clip.confidence ?? 0) * 100)),
  );
  const score = clip.metadata?.score as number | undefined;
  const team = clip.metadata?.teamSide as string | undefined;
  const dur = Math.max(0, (clip.endTime ?? 0) - (clip.startTime ?? 0));
  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-[var(--card)] overflow-hidden flex flex-col transition-all",
        "border-[var(--border)] hover:border-[var(--primary)]/50 hover:shadow-lg",
        selected &&
          "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)]",
        className,
      )}
    >
      <HighlightClipPlayer
        clip={clip}
        video={video}
        selectionEnabled={selectionEnabled}
        selected={selected}
        onToggleSelect={() => onToggleSelect?.(clip.id)}
        className="aspect-video w-full rounded-none border-0 bg-black"
      />

      <div className="flex-1 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[var(--muted-foreground)]">
            {formatClock(clip.startTime ?? 0)} –{" "}
            {formatClock(clip.endTime ?? 0)}
          </span>
          <span className="text-xs font-semibold">
            · {formatHighlightType(clip.type, score ?? null)}
          </span>
          {score != null && (
            <Badge
              variant="secondary"
              className="h-4 text-[10px] bg-sky-500/15 text-sky-500 border-none"
            >
              {score}PT
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "h-5 text-[10px] border-none",
              team === "AWAY"
                ? "bg-rose-500/15 text-rose-500"
                : "bg-emerald-500/15 text-emerald-600",
            )}
          >
            {team ?? "HOME"}
          </Badge>
          <Badge
            variant="outline"
            className="h-5 text-[10px] border-amber-500/40 text-amber-400 bg-amber-500/10"
          >
            MOCK
          </Badge>
          <span className="text-xs text-[var(--muted-foreground)]">
            clip · {formatClock(dur)}
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            conf {conf}%
          </span>
        </div>

        <div className="pt-2 flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onPreviewClip}
            className="h-8 px-2.5"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="ml-1 text-xs">Preview</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRemoveClip}
            className="h-8 px-2.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="ml-1 text-xs">Delete</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
