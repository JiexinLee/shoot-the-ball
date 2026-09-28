"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--muted-foreground)]">
          Upload Queue · {videos.length} item
          {videos.length !== 1 ? "s" : ""}
        </h3>
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          <Trash2 className="h-4 w-4" /> Clear All
        </Button>
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
