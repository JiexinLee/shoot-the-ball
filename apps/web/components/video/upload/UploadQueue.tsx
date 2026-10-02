"use client";

import {
  Trash2,
  SquareCheck,
  CheckSquare,
  ScissorsLineDashed,
  Square,
  Loader2,
  Play,
  FileVideo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HighlightClipPlayer } from "./VideoCard";
import {
  formatHighlightType,
  type UploadedVideo,
  type Highlight,
} from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

interface UploadQueueProps {
  videos: UploadedVideo[];
  onPreviewClip: (video: UploadedVideo, clip: Highlight) => void;
  onRemoveClip: (video: UploadedVideo, clip: Highlight) => void;
  onClearAll: () => void;
  className?: string;
  selectionEnabled?: boolean;
  selectedHighlightIds?: Set<string>;
  deletedHighlightIds?: Set<string>;
  totalHighlightCount?: number;
  exporting?: boolean;
  onToggleSelectionMode?: () => void;
  onToggleSelectAll?: () => void;
  onToggleHighlight?: (highlightId: string) => void;
  onExport?: () => void;
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

export function UploadQueue({
  videos,
  onPreviewClip,
  onRemoveClip,
  onClearAll,
  className,
  selectionEnabled = false,
  selectedHighlightIds,
  deletedHighlightIds,
  totalHighlightCount = 0,
  exporting = false,
  onToggleSelectionMode,
  onToggleSelectAll,
  onToggleHighlight,
  onExport,
}: UploadQueueProps) {
  if (videos.length === 0) return null;

  const primary = videos[0];
  const clips: { clip: Highlight; video: UploadedVideo }[] = [];
  for (const v of videos) {
    if (v.highlights) {
      for (const c of v.highlights) {
        if (deletedHighlightIds?.has(c.id)) continue;
        clips.push({ clip: c, video: v });
      }
    }
  }

  const selectedCount = selectedHighlightIds?.size ?? 0;
  const allSelected =
    totalHighlightCount > 0 && selectedCount === totalHighlightCount;
  const hasAnyReady = clips.length > 0;

  return (
    <div className={cn("w-full", className)}>
      {/* Header: left = filename + meta, right = selection/export actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 h-9 w-9 rounded-lg bg-[var(--primary)]/15 border border-[var(--primary)]/30 flex items-center justify-center">
            <FileVideo className="h-4 w-4 text-[var(--primary)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{primary.name}</p>
              <Badge
                variant="outline"
                className="text-[10px] h-5 border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              >
                Ready
              </Badge>
              {selectionEnabled && totalHighlightCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                >
                  {selectedCount}/{totalHighlightCount} selected
                </Badge>
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {formatBytes(primary.sizeBytes)} · {primary.mimeType}
              {primary.durationSec != null
                ? ` · ${formatClock(primary.durationSec)}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant={selectionEnabled ? "default" : "outline"}
            size="sm"
            disabled={!hasAnyReady || exporting}
            onClick={onToggleSelectionMode}
            className={cn(
              selectionEnabled &&
                "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90",
            )}
          >
            {selectionEnabled ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <SquareCheck className="h-4 w-4" />
            )}
            {selectionEnabled ? "Picking" : "Select"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={
              !selectionEnabled || totalHighlightCount === 0 || exporting
            }
            onClick={onToggleSelectAll}
          >
            {allSelected ? (
              <Square className="h-4 w-4" />
            ) : (
              <CheckSquare className="h-4 w-4" />
            )}
            {allSelected ? "Clear All" : "Select All"}
          </Button>

          <Button
            variant="default"
            size="sm"
            disabled={!selectionEnabled || selectedCount === 0 || exporting}
            onClick={onExport}
            className="gap-1.5"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ScissorsLineDashed className="h-4 w-4" />
            )}
            {exporting
              ? "Exporting…"
              : selectedCount > 0
                ? `Export ${selectedCount} clip${
                    selectedCount !== 1 ? "s" : ""
                  }`
                : "Export"}
          </Button>

          <div className="w-px h-6 bg-[var(--border)] mx-1" />

          <Button variant="ghost" size="sm" onClick={onClearAll}>
            <Trash2 className="h-4 w-4" /> Clear All
          </Button>
        </div>
      </div>

      {/* Clips grid: fill entire width, responsive 3/2/1 */}
      {clips.length > 0 ? (
        <div className="w-full grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clips.map(({ clip, video }) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              video={video}
              selectionEnabled={selectionEnabled}
              selected={selectedHighlightIds?.has(clip.id) ?? false}
              onToggleSelect={onToggleHighlight}
              onPreviewClip={() => onPreviewClip(video, clip)}
              onRemoveClip={() => onRemoveClip(video, clip)}
            />
          ))}
        </div>
      ) : (
        <div className="w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-4 py-12 text-center">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2
              className="h-8 w-8 text-[var(--primary)] animate-spin drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]"
              strokeWidth={2.25}
            />
            <p className="text-sm text-[var(--muted-foreground)]">
              Processing highlights… check back shortly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ClipCard({
  clip,
  video,
  selectionEnabled,
  selected,
  onToggleSelect,
  onPreviewClip,
  onRemoveClip,
}: {
  clip: Highlight;
  video: UploadedVideo;
  selectionEnabled: boolean;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
  onPreviewClip: () => void;
  onRemoveClip: () => void;
}) {
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
