"use client";

import { Trash2, SquareCheck, CheckSquare, ScissorsLineDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VideoCard } from "./VideoCard";
import type { UploadedVideo } from "@/lib/types";

interface UploadQueueProps {
  videos: UploadedVideo[];
  onPreview: (video: UploadedVideo) => void;
  onRemove: (video: UploadedVideo) => void;
  onClearAll: () => void;
  className?: string;
}

export function UploadQueue({
  videos,
  onPreview,
  onRemove,
  onClearAll,
  className,
}: UploadQueueProps) {
  if (videos.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold text-[var(--muted-foreground)]">
          Processed Videos · {videos.length} item
          {videos.length !== 1 ? "s" : ""}
        </h3>

        <div className="flex items-center gap-1.5">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled>
                <SquareCheck className="h-4 w-4" /> Select
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Coming soon — pick highlights to merge.
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled>
                <CheckSquare className="h-4 w-4" /> Select All
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Coming soon — batch-select every clip below.
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button variant="default" size="sm" disabled>
                <ScissorsLineDashed className="h-4 w-4" /> Export
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Coming soon — Export API in development. Will call
              POST /exports to render mp4 via server-side ffmpeg.
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-6 bg-[var(--border)] mx-1" />

          <Button variant="ghost" size="sm" onClick={onClearAll}>
            <Trash2 className="h-4 w-4" /> Clear All
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {videos.map((v) => (
          <VideoCard
            key={v.id}
            video={v}
            onPreview={onPreview}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}
