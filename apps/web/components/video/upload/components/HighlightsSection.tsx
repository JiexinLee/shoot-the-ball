"use client";

import { Film } from "lucide-react";
import type { Highlight } from "@/lib/types";
import { HighlightClipPlayer } from "./HighlightClipPlayer";

export interface HighlightsSectionProps {
  highlights: Highlight[];
  previewUrl: string;
  selectionEnabled?: boolean;
  selectedHighlightIds?: Set<string>;
  onToggleHighlight?: (id: string) => void;
}

export function HighlightsSection({
  highlights,
  previewUrl,
  selectionEnabled,
  selectedHighlightIds,
  onToggleHighlight,
}: HighlightsSectionProps) {
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
