"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  UploadCloud,
  Video,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  X,
} from "lucide-react";
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
import { VideoCalibrationStage } from "./VideoCalibrationStage";

type DialogStage = "uploading" | "calibrating" | "finalizing";

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

/* ---- small sub-component: 阶段进度 steps ---- */
function StageSteps({ stage }: { stage: DialogStage }) {
  const steps: { key: DialogStage; label: string; icon: typeof UploadCloud }[] =
    [
      { key: "uploading", label: "Upload", icon: UploadCloud },
      { key: "calibrating", label: "Calibrate", icon: Gauge },
      { key: "finalizing", label: "Start AI", icon: Video },
    ];
  const idx = steps.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <Badge
              variant={done ? "secondary" : active ? "default" : "outline"}
              className={cn(
                "h-7 gap-1.5 text-xs",
                done &&
                  "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20",
                active && "text-[var(--primary-foreground)]",
              )}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <s.icon className="h-3.5 w-3.5" />
              )}
              {i + 1}. {s.label}
            </Badge>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px w-8",
                  done ? "bg-emerald-500/60" : "bg-[var(--border)]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
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
   */
  const latestVideoRef = useRef<UploadedVideo | null>(video);
  useEffect(() => {
    latestVideoRef.current = video;
  }, [video]);

  useEffect(() => {
    if (!open || !video || stage !== "uploading") return;
    const localId = video.id;
    if (uploadStartedForIdRef.current === localId) return; // 🔒 严格模式双跑 / 重入直接跳过
    uploadStartedForIdRef.current = localId;
    let cancelled = false;

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
        if (cancelled || uploadStartedForIdRef.current !== localId) return;
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
        if (cancelled || uploadStartedForIdRef.current !== localId) return;
        aborterRef.current = null;

        setUploadStageText("Verifying upload & saving metadata…");
        await completeUpload({
          videoId: session.videoId,
          durationSec: latestVideoRef.current?.durationSec,
          width: latestVideoRef.current?.width,
          height: latestVideoRef.current?.height,
        });
        if (cancelled || uploadStartedForIdRef.current !== localId) return;

        setUploadPct(100);
        onUploadComplete?.(localId);
        setStage("calibrating");
      } catch (err) {
        if (cancelled || uploadStartedForIdRef.current !== localId) return;
        const m = err instanceof Error ? err.message : "Unknown upload error";
        setErrorMsg(m);
      }
    };

    void run();
    return () => {
      cancelled = true;
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
    if (stage === "calibrating" || sessionVideoId) {
      // 已经写了 DB，不要删，父组件保留记录，下次可以继续/重跑
      onOpenChange(false);
      return;
    }
    // 还在上传初期且没拿到 session videoId → 允许取消记录
    aborterRef.current?.abort();
    aborterRef.current = null;
    onCancelled?.(video.id);
    onOpenChange(false);
  };

  const title = useMemo(() => {
    if (!video) return "Upload workflow";
    return stage === "uploading"
      ? "Uploading video"
      : stage === "calibrating"
        ? "Calibrate hoop & court"
        : "Starting AI analysis";
  }, [video, stage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        /* 🔥 强制 90vw / 90vh — 全部 !important 覆盖 shadcn 默认 sm:max-w-lg / p-6 / gap-4 */
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

        {/* Body —— 留最小 padding，把空间让给视频预览 */}
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

/* ---- UploadingStage: 左预览（占主要空间） + 右进度面板 ---- */
function UploadingStage({
  video,
  progress,
  stageText,
  error,
}: {
  video: UploadedVideo;
  progress: number;
  stageText: string;
  error: string | null;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[2.5fr_1fr]">
      {/* Left: video preview — 直接顶到边框，用满左栏 2.5/3.5 ≈ 71% */}
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
          {/* Upload progress overlay — 叠在视频下方 5%，不挡画面 */}
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
