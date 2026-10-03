"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared";
import { DropZone } from "../upload/DropZone";
import { UploadQueue } from "../upload/UploadQueue";
import { UploadWorkflowDialog } from "../upload-workflow/UploadWorkflowDialog";
import { VideoPreviewDialog } from "../preview/VideoPreviewDialog";
import {
  formatHighlightType,
  type UploadedVideo,
  type Highlight,
} from "@/lib/types";
import {
  generateUid,
  guessMime,
  isVideoFile,
  MAX_UPLOAD_BYTES,
  probeVideoMetadata,
  subscribeJobProgress,
} from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { videos as apiVideos } from "@/lib/api/videos";
import { HeroSection } from "./components/HeroSection";
import {
  usePollExportUntilReady,
  useExportHandler,
} from "./hooks/useExportPipeline";

export interface VideoUploaderProps {
  className?: string;
  onPreview?: (video: UploadedVideo) => void;
  onRemove?: (video: UploadedVideo) => void;
}

export function VideoUploader({
  className,
  onPreview,
  onRemove,
}: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeVideo, setActiveVideo] = useState<UploadedVideo | null>(null);

  const [previewDialog, setPreviewDialog] = useState<{
    video: UploadedVideo | null;
    clipStart: number | null;
    clipEnd: number | null;
    clipTitle: string | null;
    clipSrc: string | null;
  }>({
    video: null,
    clipStart: null,
    clipEnd: null,
    clipTitle: null,
    clipSrc: null,
  });

  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<Set<string>>(
    new Set(),
  );
  const [deletedHighlightIds, setDeletedHighlightIds] = useState<Set<string>>(
    new Set(),
  );
  const [exporting, setExporting] = useState(false);

  const sseCleanupRef = useRef<Map<string, () => void>>(new Map());
  const aborterRef = useRef<Map<string, AbortController>>(new Map());
  const exportPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      sseCleanupRef.current.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
      sseCleanupRef.current.clear();
      aborterRef.current.forEach((ab) => ab.abort());
      aborterRef.current.clear();
      videos.forEach((v) => URL.revokeObjectURL(v.previewUrl));
      if (exportPollTimerRef.current) {
        clearTimeout(exportPollTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isHighlightVisible = useCallback(
    (id: string) => !deletedHighlightIds.has(id),
    [deletedHighlightIds],
  );

  const totalHighlightCount = useMemo(
    () =>
      videos.reduce(
        (sum, v) =>
          sum +
          (v.highlights?.filter((h) => isHighlightVisible(h.id)).length ?? 0),
        0,
      ),
    [videos, isHighlightVisible],
  );

  const allHighlightIds = useMemo(
    () =>
      videos.flatMap((v) =>
        v.highlights
          ? v.highlights
              .filter((h) => isHighlightVisible(h.id))
              .map((h) => h.id)
          : [],
      ),
    [videos, isHighlightVisible],
  );

  const updateVideo = (id: string, patch: Partial<UploadedVideo>) =>
    setVideos((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    );

  const cleanupUpload = (id: string, previewUrl: string) => {
    const sseCleanup = sseCleanupRef.current.get(id);
    if (sseCleanup) {
      try {
        sseCleanup();
      } catch {
        /* ignore */
      }
      sseCleanupRef.current.delete(id);
    }
    const ab = aborterRef.current.get(id);
    if (ab) {
      ab.abort();
      aborterRef.current.delete(id);
    }
    URL.revokeObjectURL(previewUrl);
  };

  const beginSubscribeJobProgress = (v: UploadedVideo) => {
    if (!v.jobId) return;
    const jobId = v.jobId;
    const localId = v.id;
    const videoId = v.videoId;
    const durationHint = v.durationSec;

    const existing = sseCleanupRef.current.get(localId);
    if (existing) {
      try {
        existing();
      } catch {
        /* ignore */
      }
    }

    sseCleanupRef.current.set(
      localId,
      subscribeJobProgress(jobId, {
        onProgress: (pct, _stage) => {
          updateVideo(localId, { progress: pct });
        },
        onCompleted: async () => {
          updateVideo(localId, { progress: 100, status: "success" });
          sseCleanupRef.current.delete(localId);

          if (!videoId) return;
          try {
            const { highlights } = await apiVideos.listHighlights(videoId, {
              durationHint,
            });
            if (highlights && highlights.length > 0) {
              const patch = {
                highlights: highlights as unknown as Highlight[],
              };
              updateVideo(localId, patch);
            }
          } catch {
            /* ignore */
          }
        },
        onFailed: (err) => {
          updateVideo(localId, { status: "error", error: err });
          sseCleanupRef.current.delete(localId);
        },
      }),
    );
  };

  const handleFilesAdded = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isVideoFile);
    if (!arr.length) return;
    const first = arr[0];

    const id = crypto.randomUUID ? crypto.randomUUID() : generateUid();
    const previewUrl = URL.createObjectURL(first);
    const probe = await probeVideoMetadata(previewUrl);
    const mimeType = guessMime(first.name, first.type);

    const created: UploadedVideo = {
      id,
      file: first,
      previewUrl,
      name: first.name,
      sizeBytes: first.size,
      mimeType,
      progress: 0,
      status: "pending",
      createdAt: Date.now(),
      ...probe,
    };

    setVideos((prev) => [created, ...prev]);

    if (created.sizeBytes > MAX_UPLOAD_BYTES) {
      updateVideo(id, {
        status: "error",
        error: `File too large (max ${formatBytes(MAX_UPLOAD_BYTES)})`,
      });
      return;
    }

    setActiveVideo(created);
    setDialogOpen(true);
  };

  const handleRemove = (v: UploadedVideo) => {
    cleanupUpload(v.id, v.previewUrl);
    if (v.highlights) {
      setSelectedHighlightIds((prev) => {
        const next = new Set(prev);
        v.highlights!.forEach((h) => next.delete(h.id));
        return next;
      });
      setDeletedHighlightIds((prev) => {
        const next = new Set(prev);
        v.highlights!.forEach((h) => next.delete(h.id));
        return next;
      });
    }
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
    if (activeVideo?.id === v.id) {
      setActiveVideo(null);
      setDialogOpen(false);
    }
    if (previewDialog.video?.id === v.id) {
      setPreviewDialog({
        video: null,
        clipStart: null,
        clipEnd: null,
        clipTitle: null,
        clipSrc: null,
      });
    }
    onRemove?.(v);
  };

  const handleClearAll = () => {
    videos.forEach((v) => cleanupUpload(v.id, v.previewUrl));
    setVideos([]);
    setActiveVideo(null);
    setDialogOpen(false);
    setSelectedHighlightIds(new Set());
    setDeletedHighlightIds(new Set());
    setSelectionEnabled(false);
    setPreviewDialog({
      video: null,
      clipStart: null,
      clipEnd: null,
      clipTitle: null,
      clipSrc: null,
    });
  };

  const handleOnVideoId = useCallback((localId: string, videoId: string) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === localId ? { ...v, videoId, status: "uploading" } : v,
      ),
    );
  }, []);

  const handleOnUploadComplete = useCallback((localId: string) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === localId ? { ...v, progress: 100, status: "calibrating" } : v,
      ),
    );
  }, []);

  const handleOnProcessingStarted = useCallback(
    (payload: { localId: string; videoId: string; jobId: string }) => {
      const { localId, jobId } = payload;
      let target: UploadedVideo | undefined;
      setVideos((prev) => {
        const next = prev.map((v) =>
          v.id === localId
            ? { ...v, status: "processing" as const, progress: 0, jobId }
            : v,
        );
        target = next.find((v) => v.id === localId);
        return next;
      });
      if (target) {
        beginSubscribeJobProgress(target);
      } else {
        setTimeout(() => {
          setVideos((prev) => {
            const v = prev.find((x) => x.id === localId);
            if (v) beginSubscribeJobProgress(v);
            return prev;
          });
        }, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleOnCancelled = useCallback((localId: string) => {
    setVideos((prev) => {
      const target = prev.find((v) => v.id === localId);
      if (target) cleanupUpload(localId, target.previewUrl);
      return prev.filter((v) => v.id !== localId);
    });
    setActiveVideo(null);
    setDialogOpen(false);
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedHighlightIds(new Set());
      }
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    const allSelected =
      totalHighlightCount > 0 &&
      selectedHighlightIds.size === totalHighlightCount;
    if (allSelected) {
      setSelectedHighlightIds(new Set());
    } else {
      setSelectedHighlightIds(new Set(allHighlightIds));
    }
  }, [allHighlightIds, totalHighlightCount, selectedHighlightIds.size]);

  const handleToggleHighlight = useCallback((highlightId: string) => {
    setSelectedHighlightIds((prev) => {
      const next = new Set(prev);
      if (next.has(highlightId)) {
        next.delete(highlightId);
      } else {
        next.add(highlightId);
      }
      return next;
    });
  }, []);

  const handlePreviewVideo = useCallback(
    (v: UploadedVideo) => {
      setPreviewDialog({
        video: v,
        clipStart: null,
        clipEnd: null,
        clipTitle: null,
        clipSrc: null,
      });
      onPreview?.(v);
    },
    [onPreview],
  );

  const handlePreviewClip = useCallback((v: UploadedVideo, clip: Highlight) => {
    const score = clip.metadata?.score as number | undefined;
    const title = formatHighlightType(clip.type, score ?? null);
    setPreviewDialog({
      video: v,
      clipStart: clip.startTime,
      clipEnd: clip.endTime,
      clipTitle: `${title} · ${clip.id.slice(-6)}`,
      clipSrc: clip.clipUrl ?? null,
    });
  }, []);

  const handleRemoveClip = useCallback((_v: UploadedVideo, clip: Highlight) => {
    setDeletedHighlightIds((prev) => {
      const next = new Set(prev);
      next.add(clip.id);
      return next;
    });
    setSelectedHighlightIds((prev) => {
      if (!prev.has(clip.id)) return prev;
      const next = new Set(prev);
      next.delete(clip.id);
      return next;
    });
  }, []);

  const pollExportUntilReady = usePollExportUntilReady({
    exportPollTimerRef,
  });

  const handleExport = useExportHandler({
    activeVideo,
    selectedHighlightIds,
    deletedHighlightIds,
    videos,
    pollExportUntilReady,
    setExporting,
    exportPollTimerRef,
  });

  const hasVideos = videos.length > 0;

  return (
    <div className={cn("space-y-6", className)}>
      {!hasVideos ? (
        <>
          <PageHeader
            title="Upload & Process"
            description="Drag and drop basketball game videos to auto-detect made baskets, assists, steals and generate highlight clips."
          />

          <HeroSection />

          <DropZone
            dragActive={dragActive}
            onDragActiveChange={setDragActive}
            onFilesAdded={handleFilesAdded}
          />
        </>
      ) : (
        <>
          <PageHeader
            title="My Workspace"
            description="Review AI-detected highlights, preview individual clips, and batch-export videos once processing finishes."
          />
        </>
      )}

      <UploadQueue
        videos={videos}
        onPreviewClip={handlePreviewClip}
        onRemoveClip={handleRemoveClip}
        onClearAll={handleClearAll}
        selectionEnabled={selectionEnabled}
        selectedHighlightIds={selectedHighlightIds}
        deletedHighlightIds={deletedHighlightIds}
        totalHighlightCount={totalHighlightCount}
        exporting={exporting}
        onToggleSelectionMode={handleToggleSelectionMode}
        onToggleSelectAll={handleToggleSelectAll}
        onToggleHighlight={handleToggleHighlight}
        onExport={handleExport}
      />
      <UploadWorkflowDialog
        key={activeVideo?.id ?? "empty"}
        open={dialogOpen}
        video={activeVideo}
        onOpenChange={setDialogOpen}
        onVideoId={handleOnVideoId}
        onUploadComplete={handleOnUploadComplete}
        onProcessingStarted={handleOnProcessingStarted}
        onCancelled={handleOnCancelled}
      />
      <VideoPreviewDialog
        video={previewDialog.video}
        clipStartSec={previewDialog.clipStart}
        clipEndSec={previewDialog.clipEnd}
        clipTitle={previewDialog.clipTitle}
        clipSrc={previewDialog.clipSrc}
        onClose={() =>
          setPreviewDialog({
            video: null,
            clipStart: null,
            clipEnd: null,
            clipTitle: null,
            clipSrc: null,
          })
        }
      />
    </div>
  );
}
