"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DropZone } from "./upload/DropZone";
import { UploadQueue } from "./upload/UploadQueue";
import type { UploadedVideo } from "@/lib/types";
import {
  completeUpload,
  createUploadSession,
  DEFAULT_PROJECT_ID,
  generateUid,
  guessMime,
  isVideoFile,
  probeVideoMetadata,
  MAX_UPLOAD_BYTES,
  startProcessing,
  subscribeJobProgress,
  uploadToPresignedUrl,
} from "@/lib/api-client";
import { formatBytes } from "@/lib/format";

export interface VideoUploaderProps {
  className?: string;
  onPreview?: (video: UploadedVideo) => void;
  onRemove?: (video: UploadedVideo) => void;
}

export type { UploadedVideo } from "@/lib/types";

export function VideoUploader({
  className,
  onPreview,
  onRemove,
}: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [videos, setVideos] = useState<UploadedVideo[]>([]);
  const sseCleanupRef = useRef<Map<string, () => void>>(new Map());
  const aborterRef = useRef<Map<string, AbortController>>(new Map());

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const startUploadAndProcess = async (v: UploadedVideo) => {
    const contentType = guessMime(v.name, v.mimeType);
    updateVideo(v.id, { status: "uploading", progress: 0 });

    try {
      const session = await createUploadSession({
        projectId: DEFAULT_PROJECT_ID,
        filename: v.name,
        contentType,
        sizeBytes: v.sizeBytes,
      });
      updateVideo(v.id, { videoId: session.videoId });

      const ab = new AbortController();
      aborterRef.current.set(v.id, ab);
      const signal = ab.signal;

      await uploadToPresignedUrl({
        uploadUrl: session.uploadUrl,
        uploadMethod: session.uploadMethod,
        file: v.file,
        contentType,
        onProgress: (pct) => updateVideo(v.id, { progress: pct }),
        signal,
      });
      aborterRef.current.delete(v.id);

      await completeUpload({
        videoId: session.videoId,
        durationSec: v.durationSec,
        width: v.width,
        height: v.height,
      });

      updateVideo(v.id, {
        status: "processing",
        progress: 0,
      });
      const jobId = await startProcessing(session.videoId);
      updateVideo(v.id, { jobId });

      sseCleanupRef.current.set(
        v.id,
        subscribeJobProgress(jobId, {
          onProgress: (pct) => {
            updateVideo(v.id, { progress: pct });
          },
          onCompleted: () => {
            updateVideo(v.id, { progress: 100, status: "success" });
            sseCleanupRef.current.delete(v.id);
          },
          onFailed: (err) => {
            updateVideo(v.id, { status: "error", error: err });
            sseCleanupRef.current.delete(v.id);
          },
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown upload error";
      updateVideo(v.id, { status: "error", error: message });
    }
  };

  const handleFilesAdded = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isVideoFile);
    if (!arr.length) return;

    const created: UploadedVideo[] = await Promise.all(
      arr.map(async (file) => {
        const id = crypto.randomUUID ? crypto.randomUUID() : generateUid();
        const previewUrl = URL.createObjectURL(file);
        const probe = await probeVideoMetadata(previewUrl);
        const mimeType = guessMime(file.name, file.type);
        return {
          id,
          file,
          previewUrl,
          name: file.name,
          sizeBytes: file.size,
          mimeType,
          progress: 0,
          status: "pending",
          createdAt: Date.now(),
          ...probe,
        };
      }),
    );

    setVideos((prev) => [...created, ...prev]);
    created.forEach((v) => {
      if (v.sizeBytes > MAX_UPLOAD_BYTES) {
        updateVideo(v.id, {
          status: "error",
          error: `File too large (max ${formatBytes(MAX_UPLOAD_BYTES)})`,
        });
        return;
      }
      void startUploadAndProcess(v);
    });
  };

  const handleRemove = (v: UploadedVideo) => {
    cleanupUpload(v.id, v.previewUrl);
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
    onRemove?.(v);
  };

  const handleClearAll = () => {
    videos.forEach((v) => cleanupUpload(v.id, v.previewUrl));
    setVideos([]);
  };

  return (
    <div className={cn("space-y-6", className)}>
      <DropZone
        dragActive={dragActive}
        onDragActiveChange={setDragActive}
        onFilesAdded={handleFilesAdded}
      />
      <UploadQueue
        videos={videos}
        onPreview={(v) => onPreview?.(v)}
        onRemove={handleRemove}
        onClearAll={handleClearAll}
      />
    </div>
  );
}
