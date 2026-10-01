"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DropZone } from "./upload/DropZone";
import { UploadQueue } from "./upload/UploadQueue";
import { UploadWorkflowDialog } from "./UploadWorkflowDialog";
import type { UploadedVideo, Highlight } from "@/lib/types";
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
import { PageHeader } from "@/components/shared";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  /** 当前 Modal 里正在处理的 UploadedVideo（本地 id） */
  const [activeVideo, setActiveVideo] = useState<UploadedVideo | null>(null);

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

  const beginSubscribeJobProgress = (v: UploadedVideo) => {
    if (!v.jobId) return;
    const jobId = v.jobId;
    const localId = v.id;
    const videoId = v.videoId;

    // 同个 jobId 重复订阅了就先 cancel 旧的，防 rerender 叠两层 SSE
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
          // 1. 标 success
          updateVideo(localId, { progress: 100, status: "success" });
          sseCleanupRef.current.delete(localId);

          // 2. SSE READY 后立刻 GET highlights，直接挂在 UploadedVideo 上，
          //    VideoCard 就会在上传页卡片下方直接渲染 mini highlight list
          if (!videoId) return;
          try {
            const { highlights } = await apiVideos.listHighlights(videoId);
            if (highlights && highlights.length > 0) {
              const patch = {
                highlights: highlights as unknown as Highlight[],
              };
              updateVideo(localId, patch);
            } else {
              // 极端情况：SSE completed 了但 highlights GET 还没写好（DB 延迟），
              // 给用户一个 空 mock 提示也可以，这里就什么都不做，保持 success。
            }
          } catch (_e) {
            // GET highlights 失败不影响主流程，VideoCard 只显示 success 绿色对勾
          }
        },
        onFailed: (err) => {
          updateVideo(localId, { status: "error", error: err });
          sseCleanupRef.current.delete(localId);
        },
      }),
    );
  };

  /* —— 拖/选文件：MVP 单文件，所以只取第一个，立刻开 Modal —— */
  const handleFilesAdded = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(isVideoFile);
    if (!arr.length) return;
    // 强制单文件：只处理 files[0]
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

    // 打开 90% Modal：上传流程在 Dialog 内部执行
    setActiveVideo(created);
    setDialogOpen(true);
  };

  const handleRemove = (v: UploadedVideo) => {
    cleanupUpload(v.id, v.previewUrl);
    setVideos((prev) => prev.filter((x) => x.id !== v.id));
    if (activeVideo?.id === v.id) {
      setActiveVideo(null);
      setDialogOpen(false);
    }
    onRemove?.(v);
  };

  const handleClearAll = () => {
    videos.forEach((v) => cleanupUpload(v.id, v.previewUrl));
    setVideos([]);
    setActiveVideo(null);
    setDialogOpen(false);
  };

  /* —— Dialog callbacks —— 全部 useCallback 稳定引用，避免 effect 死循环 */
  const handleOnVideoId = useCallback((localId: string, videoId: string) => {
    setVideos((prev) =>
      prev.map((v) =>
        v.id === localId ? { ...v, videoId, status: "uploading" } : v,
      ),
    );
  }, []);

  const handleOnUploadComplete = useCallback((localId: string) => {
    // 上传 complete 完下一步就是 calibration，UI 端 local 状态先改 calibrating
    setVideos((prev) =>
      prev.map((v) =>
        v.id === localId ? { ...v, progress: 100, status: "calibrating" } : v,
      ),
    );
  }, []);

  const handleOnProcessingStarted = useCallback(
    (payload: { localId: string; videoId: string; jobId: string }) => {
      const { localId, jobId } = payload;
      // 1. 先把本地状态切 processing，进度 0
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
      // 2. 挂 SSE（它内部会等 READY 然后 GET highlights）
      if (target) {
        beginSubscribeJobProgress(target);
      } else {
        // fallback：从下一轮 setVideos 里找
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

  const hasVideos = videos.length > 0;

  return (
    <div className={cn("space-y-6", className)}>
      {!hasVideos ? (
        <>
          <PageHeader
            title="Upload & Process"
            description="Drag and drop basketball game videos to auto-detect made baskets, assists, steals and generate highlight clips."
          />

          <section className="relative overflow-hidden border-b border-[var(--border)] rounded-2xl mb-2">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 opacity-60"
              style={{
                background:
                  "radial-gradient(1200px 400px at 50% -10%, rgba(250,204,21,0.15), transparent 60%)",
              }}
            />
            <div className="p-8 sm:p-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-xs font-medium text-[var(--primary)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--primary)]" />
                </span>
                Dev Mode · Local Preview (simulated upload progress, files stay
                in browser)
              </span>
              <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                Turn your full-game footage into
                <br />
                <span className="bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] bg-clip-text text-transparent">
                  highlight clips in seconds
                </span>
              </h1>
              <p className="mt-3 max-w-2xl text-base text-[var(--muted-foreground)] sm:text-lg">
                Drag and drop any basketball game video (MP4 / MOV / MKV, etc.),
                and the AI Worker will automatically detect events like
                &quot;Made Basket, 3-pointer, Assist, Steal, Block&quot;,
                generating individual clips for each moment plus a full-game
                montage.
              </p>
            </div>
          </section>

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
        onPreview={(v) => onPreview?.(v)}
        onRemove={handleRemove}
        onClearAll={handleClearAll}
      />
      <UploadWorkflowDialog
        /* 🔑 keyed remount：activeVideo 变（新视频打开 / 同一个重开）就卸载重装，
           内部 stage/uploadPct/error/sessionVideoId 全部自动回到 initial value，
           不需要在 Dialog 里写 setState-in-effect 做 reset，React 官方推荐。 */
        key={activeVideo?.id ?? "empty"}
        open={dialogOpen}
        video={activeVideo}
        onOpenChange={setDialogOpen}
        onVideoId={handleOnVideoId}
        onUploadComplete={handleOnUploadComplete}
        onProcessingStarted={handleOnProcessingStarted}
        onCancelled={handleOnCancelled}
      />
    </div>
  );
}
