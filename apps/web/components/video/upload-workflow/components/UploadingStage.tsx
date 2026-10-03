"use client";

import {
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadedVideo } from "@/lib/types";

export interface UploadingStageProps {
  video: UploadedVideo;
  progress: number;
  stageText: string;
  error: string | null;
}

export function UploadingStage({
  video,
  progress,
  stageText,
  error,
}: UploadingStageProps) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[2.5fr_1fr]">
      {/* Left: video preview */}
      <div className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-black overflow-hidden">
        <div className="relative flex-1 min-h-0 flex items-center justify-center">
          <video
            src={video.previewUrl}
            muted
            playsInline
            autoPlay={false}
            controls
            controlsList="nodownload nofullscreen"
            className="h-full w-full object-contain"
          />
          {/* Upload progress overlay */}
          <div className="absolute left-3 right-3 bottom-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-white/90 font-medium tabular-nums drop-shadow">
              <span>{stageText}</span>
              <span>{progress}%</span>
            </div>
            <Progress
              value={progress}
              className="h-1.5 bg-white/10 [&>div]:bg-[var(--primary)]"
            />
          </div>
        </div>
      </div>

      {/* Right: info panel */}
      <div className="flex min-h-0 flex-col gap-3 overflow-auto">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)] flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-[var(--primary)]" />{" "}
              {stageText}
            </span>
            <span className="font-mono tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--muted-foreground)]">
            <div>
              <span className="block opacity-70">File</span>
              <p className="truncate text-[var(--foreground)] font-medium">
                {video.name}
              </p>
            </div>
            <div>
              <span className="block opacity-70">Size</span>
              <p className="text-[var(--foreground)] font-medium">
                {formatBytes(video.sizeBytes)}
              </p>
            </div>
            <div>
              <span className="block opacity-70">Duration</span>
              <p className="text-[var(--foreground)] font-medium">
                {formatDuration(video.durationSec) ?? "—"}
              </p>
            </div>
            <div>
              <span className="block opacity-70">Resolution</span>
              <p className="text-[var(--foreground)] font-medium">
                {video.width && video.height
                  ? `${video.width}×${video.height}`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="ml-2 text-xs font-semibold">
              Upload failed
            </AlertTitle>
            <AlertDescription className="ml-6 mt-1 text-xs">
              {error}. Close the dialog and retry dropping the file.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-emerald-500/40 bg-emerald-500/5">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <AlertTitle className="ml-2 text-xs font-semibold">
              What happens next
            </AlertTitle>
            <AlertDescription className="ml-6 mt-1 text-xs leading-relaxed">
              Once upload completes you will mark the hoop / court position
              (calibration), then we queue the video for AI analysis. After
              that, this modal closes and you wait on the main page while the
              highlights are being detected.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
