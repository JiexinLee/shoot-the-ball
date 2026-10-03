"use client";

import { Play, Trash2 } from "lucide-react";
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
import { HighlightsSection } from "./components/HighlightsSection";

interface VideoCardProps {
  video: UploadedVideo;
  onPreview: (video: UploadedVideo) => void;
  onRemove: (video: UploadedVideo) => void;
  selectionEnabled?: boolean;
  selectedHighlightIds?: Set<string>;
  onToggleHighlight?: (highlightId: string) => void;
  className?: string;
}

export function VideoCard({
  video,
  onPreview,
  onRemove,
  selectionEnabled = false,
  selectedHighlightIds,
  onToggleHighlight,
  className,
}: VideoCardProps) {
  const showProgress =
    video.status === "uploading" ||
    video.status === "processing" ||
    video.status === "calibrating";

  const hasHighlights = video.highlights && video.highlights.length > 0;
  void className;

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
