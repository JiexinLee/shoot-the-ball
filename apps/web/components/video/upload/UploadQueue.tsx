"use client";

import {
  Trash2,
  SquareCheck,
  CheckSquare,
  ScissorsLineDashed,
  Square,
  Loader2,
  FileVideo,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UploadedVideo, Highlight } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { UploadQueueHeader } from "./components/UploadQueueHeader";
import { ClipCard } from "./components/ClipCard";
import { ClipsEmptyState } from "./components/ClipsEmptyState";

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
void formatClock;

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
      <UploadQueueHeader
        primary={primary}
        selectionEnabled={selectionEnabled}
        selectedCount={selectedCount}
        totalHighlightCount={totalHighlightCount}
        allSelected={allSelected}
        hasAnyReady={hasAnyReady}
        exporting={exporting}
        onToggleSelectionMode={onToggleSelectionMode}
        onToggleSelectAll={onToggleSelectAll}
        onExport={onExport}
        onClearAll={onClearAll}
      />

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
        <ClipsEmptyState
          Icon={Loader2}
          iconClassName="h-8 w-8 text-[var(--primary)] animate-spin drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]"
          text="Processing highlights… check back shortly."
        />
      )}
    </div>
  );
}
