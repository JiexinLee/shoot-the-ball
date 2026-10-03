"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/lib/format";
import type { UploadedVideo } from "@/lib/types";
import {
  completeUpload,
  createUploadSession,
  DEFAULT_PROJECT_ID,
  guessMime,
  startProcessing,
  uploadToPresignedUrl,
} from "@/lib/api-client";
import { videos, type CalibrationInput } from "@/lib/api/videos";
import { VideoCalibrationStage } from "../calibration/VideoCalibrationStage";
import { StageSteps, type DialogStage } from "./components/StageSteps";
import { UploadingStage } from "./components/UploadingStage";

export interface UploadWorkflowDialogProps {
  open: boolean;
  /** 哪个视频在 Modal 里跑流程 */
  video: UploadedVideo | null;
  onOpenChange: (next: boolean) => void;
  /** 当 createSession → videoId 拿到时回调，父组件可以同步更新 queue */
  onVideoId?: (localId: string, videoId: string) => void;
  /** 当上传完成（POST /complete 200）回调，父组件可以更新本地状态 */
  onUploadComplete?: (localId: string) => void;
  /**
   * 当 calibration 保存 + POST process 成功 → jobId 拿到时回调，
   * 父组件会 subscribe SSE、更新 VideoCard 到 processing，等待 highlights。
   */
  onProcessingStarted?: (payload: {
    localId: string;
    videoId: string;
    jobId: string;
  }) => void;
  /** 如果用户取消（点 X 关掉 Dialog 且流程没开始），父组件可以把本地记录删掉 */
  onCancelled?: (localId: string) => void;
}

/**
 * 90% 窗口大小的主流程 Modal：
 *  - Stage 1 "uploading"：视频预览在左，progress + 状态在右，实时 0→100
 *  - Stage 2 "calibrating"：切 VideoCalibrationStage，视频定格 + 时间轴 + 点击式画 hoop/court 两个矩形
 *  - Stage 3 "finalizing"：POST calibration → POST process → 拿到 jobId 就关闭 Modal，
 *    让父组件 VideoUploader 在页面里挂 processing + 等 highlights
 */
export function UploadWorkflowDialog({
  open,
  video,
  onOpenChange,
  onVideoId,
  onUploadComplete,
  onProcessingStarted,
  onCancelled,
}: UploadWorkflowDialogProps) {
  const [stage, setStage] = useState<DialogStage>("uploading");
  const [uploadPct, setUploadPct] = useState<number>(video?.progress ?? 0);
  const [uploadStageText, setUploadStageText] = useState<string>(
    "Preparing upload session…",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionVideoId, setSessionVideoId] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState<boolean>(false);

  const aborterRef = useRef<AbortController | null>(null);
  /** 🔒 防重入保险（严格模式下 effect 会双跑，或同一个 id 下 stage: uploading → calibrating → calibrating 再回传 uploading 极端场景） */
  const uploadStartedForIdRef = useRef<string | null>(null);

  /* —— Step 1: 打开 Modal 就开始跑上传流程（create→PUT→complete） ——
   * 🔑 防死循环 + React setState-in-effect 警告的关键：
   *   1. 调用侧 VideoUploader 传了 key={activeVideo?.id ?? "empty"}：换一个视频 = 整个 Dialog 直接 unmount → remount，
   *      所以「根据 video.id 重置内部 state」这件事 React 已经帮我们做了（useState initial value 会重新跑），
   *      不需要手写 setStage() / setUploadPct() 的同步 reset effect → 彻底消灭 setState-in-effect。
   *   2. dependencies 只放 primitive（open / video.id / stage），不放整个 video 对象引用；
   *      parent setState → 新 video 对象不会再导致依赖变化 → 死循环也从根源堵了。
   *   3. onVideoId / onUploadComplete 已经由 parent useCallback 包装，引用稳定。
   *   4. name/sizeBytes/durationSec/width/height 直接从 latestVideoRef 读，不改依赖数组。
   * ⚠️ React 18 StrictMode 下的特殊约定：await 后的 early return 只检查 `uploadStartedForIdRef.current !== localId`，
   *    绝对不要再加 cancelled flag 检查！因为 StrictMode 会先假 cleanup 写 cancelled=true，
   *    但第二次 effect 因为 uploadStartedForIdRef guard 根本进不来重置 cancelled，导致真正的 run() 在 await 后静默 early return。
   *    真实 unmount 时就算 setState 打一个 dev warning 也不影响用户，总比卡在 0% 强。
   */
  const latestVideoRef = useRef<UploadedVideo | null>(video);
  useEffect(() => {
    latestVideoRef.current = video;
  }, [video]);

  useEffect(() => {
    if (!open || !video || stage !== "uploading") return;
    const localId = video.id;
    if (uploadStartedForIdRef.current === localId) return;
    uploadStartedForIdRef.current = localId;

    const run = async () => {
      const v = latestVideoRef.current;
      if (!v) return;
      const contentType = guessMime(v.name, v.mimeType);
      try {
        setUploadStageText("Creating upload session…");
        const session = await createUploadSession({
          projectId: DEFAULT_PROJECT_ID,
          filename: v.name,
          contentType,
          sizeBytes: v.sizeBytes,
        });
        if (uploadStartedForIdRef.current !== localId) return;
        setSessionVideoId(session.videoId);
        onVideoId?.(localId, session.videoId);

        const ab = new AbortController();
        aborterRef.current = ab;
        setUploadStageText("Uploading video to object storage…");
        await uploadToPresignedUrl({
          uploadUrl: session.uploadUrl,
          uploadMethod: session.uploadMethod,
          file: v.file,
          contentType,
          onProgress: (pct) => setUploadPct(pct),
          signal: ab.signal,
        });
        if (uploadStartedForIdRef.current !== localId) return;
        aborterRef.current = null;

        setUploadStageText("Verifying upload & saving metadata…");
        await completeUpload({
          videoId: session.videoId,
          durationSec: latestVideoRef.current?.durationSec,
          width: latestVideoRef.current?.width,
          height: latestVideoRef.current?.height,
        });
        if (uploadStartedForIdRef.current !== localId) return;

        setUploadPct(100);
        onUploadComplete?.(localId);
        setStage("calibrating");
      } catch (err) {
        if (uploadStartedForIdRef.current !== localId) return;
        const m = err instanceof Error ? err.message : "Unknown upload error";
        setErrorMsg(m);
      }
    };

    void run();
    return () => {
      // 真实 unmount / 视频真切换时尽力 abort XHR，减少带宽浪费；
      // StrictMode 假 cleanup 虽然也会跑，但 await 后的 early return 不再看 cancelled，所以不影响功能。
      aborterRef.current?.abort();
      aborterRef.current = null;
    };
  }, [open, video?.id, stage, onVideoId, onUploadComplete]);

  /* —— Step 2: Calibration 完成 → saveCalibration → startProcess → 关窗 —— */
  const handleCalibrationSave = async (payload: {
    hoopRoi: CalibrationInput["hoopRoi"];
    courtRoi: CalibrationInput["courtRoi"];
    // selectedFrameSec 目前只是展示，没传给后端（schema 不关心），但保留了以后接 metadata
  }) => {
    if (!sessionVideoId || !video) return;
    try {
      setFinalizing(true);
      setErrorMsg(null);
      setStage("finalizing");

      await videos.saveCalibration(sessionVideoId, {
        hoopRoi: payload.hoopRoi,
        courtRoi: payload.courtRoi ?? null,
      });

      const jobId = await startProcessing(sessionVideoId);

      onProcessingStarted?.({
        localId: video.id,
        videoId: sessionVideoId,
        jobId,
      });
      // 立刻关窗：processing 展示回到首页的 VideoCard 网格里
      onOpenChange(false);
    } catch (err) {
      const m =
        err instanceof Error ? err.message : "Failed to start processing";
      setErrorMsg(m);
      setStage("calibrating");
    } finally {
      setFinalizing(false);
    }
  };

  /* —— Close X 时：如果还没开始 processing，可以取消；如果 processing 已经 started，提醒用户—— */
  const handleCloseX = () => {
    if (stage === "finalizing" || !video) {
      // finalizing 阶段正在发请求，不让用户手贱关
      return;
    }
    // 已经在 calibrating，或者 videoId 已经拿到并上传过了：就不关本地记录，只关 Dialog 自己
    if (stage === "calibrating" || sessionVideoId) {
      onOpenChange(false);
      return;
    }
    // 还在 uploading，没拿到 videoId：视为取消
    aborterRef.current?.abort();
    aborterRef.current = null;
    onCancelled?.(video.id);
    onOpenChange(false);
  };

  const title = useMemo(() => {
    if (!video) return "Upload workflow";
    if (stage === "uploading") return "Uploading video";
    if (stage === "calibrating") return "Calibrate hoop & court";
    return "Starting AI analysis";
  }, [video, stage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "!w-[90vw] !max-w-[90vw] !h-[90vh] !max-h-[90vh] !p-0 !gap-0 !rounded-2xl",
          "flex flex-col overflow-hidden",
        )}
        onInteractOutside={(e) => {
          if (stage === "uploading" || finalizing) e.preventDefault();
        }}
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-lg font-semibold leading-tight truncate">
                {title}
              </DialogTitle>
              <StageSteps stage={stage} />
            </div>
            {video && (
              <DialogDescription
                asChild
                className="text-xs text-[var(--muted-foreground)]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="truncate max-w-md">{video.name}</span>
                  <span>· {formatBytes(video.sizeBytes)}</span>
                  <span>· {formatDuration(video.durationSec)}</span>
                  {video.width && video.height && (
                    <span>
                      · {video.width}×{video.height}
                    </span>
                  )}
                </div>
              </DialogDescription>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close dialog"
            onClick={handleCloseX}
            className="shrink-0"
          >
            <X className="h-5 w-5" />
          </Button>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 min-h-0 p-2 sm:p-3">
          {!video ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
              No video selected.
            </div>
          ) : stage === "uploading" ? (
            <UploadingStage
              video={video}
              progress={uploadPct}
              stageText={uploadStageText}
              error={errorMsg}
            />
          ) : stage === "calibrating" ? (
            <div className="flex h-full flex-col gap-3">
              {errorMsg && (
                <Alert variant="destructive" className="py-3">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="ml-2 text-xs font-semibold">
                    Error
                  </AlertTitle>
                  <AlertDescription className="ml-6 mt-1 text-xs">
                    {errorMsg}
                  </AlertDescription>
                </Alert>
              )}
              <VideoCalibrationStage
                previewUrl={video.previewUrl}
                naturalWidth={video.width}
                naturalHeight={video.height}
                durationSec={video.durationSec}
                onSave={handleCalibrationSave}
                saving={finalizing}
                className="min-h-0"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Saving calibration and queueing AI analysis…
                </p>
                {errorMsg && (
                  <Alert variant="destructive" className="max-w-md mx-auto">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="ml-2 text-xs font-semibold">
                      Failed
                    </AlertTitle>
                    <AlertDescription className="ml-6 mt-1 text-xs">
                      {errorMsg}. Please try saving again.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
