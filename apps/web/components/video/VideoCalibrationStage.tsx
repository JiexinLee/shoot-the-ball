"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Square, Sparkles, Trash2, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RoiRect } from "@/lib/api/videos";

type RoiMode = "hoop" | "court";

type StageCalibration = {
  mode: RoiMode;
  /** normalized [0,1] 百分比坐标 — 方便映射不同分辨率 */
  hoopRoiNorm: { x: number; y: number; width: number; height: number } | null;
  courtRoiNorm: { x: number; y: number; width: number; height: number } | null;
  /** 画框的第一步（只点了左上角），还没点右下角。null 表示没有在画 */
  pendingFirstPoint: { mode: RoiMode; x: number; y: number } | null;
  /** 用户正在 hover，只是做十字辅助线预览 */
  hoverPoint: { x: number; y: number } | null;
};

export interface VideoCalibrationStageProps {
  /** 本地 File objectURL，给 <video> src */
  previewUrl: string;
  /** probeVideoMetadata 返回的原始分辨率，给后端保存 ROI 真实像素坐标用。未知就 fallback 1920x1080 */
  naturalWidth?: number;
  naturalHeight?: number;
  /** probe 出来的总时长秒，range slider 最大值用 */
  durationSec?: number;
  /** 视频元数据已 probe 的话，可默认 seek 到 30% 位置给一张清晰能看到篮筐的帧 */
  defaultSeekSec?: number;
  /** 用户保存前调这个验证/取最终值；我们 onClick 就会把 norm 乘 natural 之后再传回 parent */
  onSave: (result: {
    hoopRoi: RoiRect;
    courtRoi: RoiRect | null;
    selectedFrameSec: number;
  }) => void;
  /** Save 按钮 loading（一般是 POST saveCalibration + POST process 的时候） */
  saving?: boolean;
  className?: string;
}

/**
 * 校准阶段：
 *   - 视频默认 paused，不自动播放，用户拖 range 找帧
 *   - 先选模式（Hoop 必选 / Court 可选）→ 在视频画面上「点左上角 → 点右下角」两次点击就确定一个矩形
 *   - 顶部 Alert 提示用户怎么操作 + 为什么需要 ROI
 *   - 右上角放 Auto Calibrate (AI) 按钮，tooltip 说 Coming soon，现在 disabled
 *   - 保存时把百分比坐标 × 视频原始 width/height → 真实像素传给 parent
 */
export function VideoCalibrationStage({
  previewUrl,
  naturalWidth,
  naturalHeight,
  durationSec,
  defaultSeekSec,
  onSave,
  saving,
  className,
}: VideoCalibrationStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** 拖动 Slider 期间屏蔽 onTimeUpdate 的 state 回写，防止 thumb 回弹 */
  const isDraggingSliderRef = useRef(false);

  const [state, setState] = useState<StageCalibration>({
    mode: "hoop",
    hoopRoiNorm: null,
    courtRoiNorm: null,
    pendingFirstPoint: null,
    hoverPoint: null,
  });

  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  /** 真实视频时长（从 loadedmetadata 的 video.duration 来，覆盖 props 的 durationSec 防止传错） */
  const [realDuration, setRealDuration] = useState<number>(
    Math.max(1, durationSec ?? 1),
  );
  /** 🔥 真实视频渲染区域（去 letterbox 黑边后）相对外层 "h-full w-full flex" 盒子的像素 rect */
  const [videoRenderRect, setVideoRenderRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  /* —— 统一的 seek 工具：校准阶段视频默认保持 paused，只由滑块控制时间，绝不自动播放。
     先强制 pause() 防任何情况下留在 playing，再 set currentTime；
     如果浏览器 paused 时只改 currentTime 不渲染画面（Safari/部分 Chrome），
     用一次 muted play→pause 的单帧刷新 trick，所有出口 100% 再调一次 forcePause()
     保证不残留 playing 状态。 */
  const seekSafetyTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const timers = seekSafetyTimersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  const seekVideoTo = useCallback(
    (targetSec: number) => {
      const v = videoRef.current;
      if (!v) return;
      const maxDur =
        Number.isFinite(v.duration) && v.duration > 0
          ? v.duration
          : realDuration;
      const clamped = Math.max(0, Math.min(maxDur, targetSec));
      const wasMuted = v.muted;

      const forcePause = () => {
        try {
          if (!v.paused) v.pause();
        } catch {
          /* ignore */
        }
        try {
          v.muted = wasMuted;
        } catch {
          /* ignore */
        }
        try {
          setCurrentTimeSec(v.currentTime);
        } catch {
          /* ignore */
        }
      };

      try {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
        v.currentTime = clamped;
        setCurrentTimeSec(clamped);

        let safetyTimer: number | null = null;
        const clearSafety = () => {
          if (safetyTimer != null) {
            window.clearTimeout(safetyTimer);
            seekSafetyTimersRef.current.delete(safetyTimer);
            safetyTimer = null;
          }
        };
        const wrapped = () => {
          clearSafety();
          try {
            const p = (() => {
              try {
                if (!v.muted) v.muted = true;
                return v.play();
              } catch {
                return null;
              }
            })();
            if (p && typeof (p as Promise<void>).then === "function") {
              (p as Promise<void>)
                .then(() => forcePause())
                .catch(() => forcePause());
            } else {
              forcePause();
            }
          } catch {
            forcePause();
          }
        };
        v.addEventListener("seeked", wrapped, { once: true });
        safetyTimer = window.setTimeout(() => {
          safetyTimer = null;
          forcePause();
        }, 600);
        seekSafetyTimersRef.current.add(safetyTimer);
      } catch {
        forcePause();
      }
    },
    [realDuration],
  );

  /* —— 计算真实视频渲染区域（和 computeNormPoint 算法完全对称，输出像素 rect） —— */
  const recomputeRenderRect = useCallback(() => {
    const wrap =
      stageRef.current?.querySelector<HTMLDivElement>("[data-video-wrap]");
    const v = videoRef.current;
    if (!wrap || !v || !v.videoWidth || !v.videoHeight) {
      setVideoRenderRect(null);
      return;
    }
    const wrapRect = wrap.getBoundingClientRect();
    const w = wrapRect.width;
    const h = wrapRect.height;
    if (w <= 0 || h <= 0) {
      setVideoRenderRect(null);
      return;
    }
    const videoRatio = v.videoWidth / v.videoHeight;
    const displayRatio = w / h;
    let innerW = w;
    let innerH = h;
    let innerX = 0;
    let innerY = 0;
    if (displayRatio > videoRatio) {
      innerW = h * videoRatio;
      innerX = (w - innerW) / 2;
    } else {
      innerH = w / videoRatio;
      innerY = (h - innerH) / 2;
    }
    setVideoRenderRect({ x: innerX, y: innerY, w: innerW, h: innerH });
  }, []);

  /* —— 监听 loadedmetadata + resize + loadeddata，保证 renderRect 永远和 DOM 对齐 —— */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    recomputeRenderRect();
    const onMeta = () => recomputeRenderRect();
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadeddata", onMeta);
    v.addEventListener("resize", onMeta);
    window.addEventListener("resize", onMeta);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("loadeddata", onMeta);
      v.removeEventListener("resize", onMeta);
      window.removeEventListener("resize", onMeta);
    };
  }, [recomputeRenderRect]);
  const [isReady, setIsReady] = useState(false);

  const nw = naturalWidth ?? 1920;
  const nh = naturalHeight ?? 1080;

  /* ----- 视频加载完毕：记录真实时长 + seek 到 defaultSeekSec or 30% + 强制保持 paused ----- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const targetSec = (t: number) =>
      typeof defaultSeekSec === "number" ? defaultSeekSec : t * 0.3;
    const onMeta = () => {
      try {
        const trueDur =
          Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
        setRealDuration(trueDur);
        seekVideoTo(targetSec(trueDur));
        // —— 防自动播放（关键）：loadedmetadata 之后永远再调一次 v.pause()
        try {
          if (!v.paused) v.pause();
        } catch {
          /* ignore */
        }
        setIsReady(true);
        recomputeRenderRect();
      } catch {
        /* ignore */
      }
    };
    const onPlay = () => {
      // —— 最终保险：如果任何情况（浏览器策略/用户误点）进入 playing，立刻拉回 paused
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl, defaultSeekSec, recomputeRenderRect]);

  /* ----- 把鼠标 clientX/Y → → video render area 内 norm [0,1] ----- */
  const computeNormPoint = useCallback((clientX: number, clientY: number) => {
    const v = videoRef.current;
    if (!v) return null;
    const rect = v.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    if (vw <= 0 || vh <= 0) return null;
    // letterbox: 视频按 aspect ratio 在 rect 里居中显示，上下/左右有黑边
    // 需要求出真实显示的视频区域（去掉黑边后的内部 rect）
    const displayRatio = vw / vh;
    const videoRatio = v.videoWidth / v.videoHeight || 16 / 9;
    let innerW = vw;
    let innerH = vh;
    let innerX = 0;
    let innerY = 0;
    if (displayRatio > videoRatio) {
      // 左右黑边
      innerW = vh * videoRatio;
      innerX = (vw - innerW) / 2;
    } else {
      // 上下黑边
      innerH = vw / videoRatio;
      innerY = (vh - innerH) / 2;
    }
    const px = clientX - rect.left - innerX;
    const py = clientY - rect.top - innerY;
    if (innerW <= 0 || innerH <= 0) return null;
    return {
      x: Math.max(0, Math.min(1, px / innerW)),
      y: Math.max(0, Math.min(1, py / innerH)),
    };
  }, []);

  const handleVideoMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const p = computeNormPoint(e.clientX, e.clientY);
      setState((s) => ({ ...s, hoverPoint: p }));
    },
    [computeNormPoint],
  );
  const handleVideoMouseLeave = useCallback(() => {
    setState((s) => ({ ...s, hoverPoint: null }));
  }, []);

  const handleVideoClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const p = computeNormPoint(e.clientX, e.clientY);
      if (!p) return;
      setState((s) => {
        if (!s.pendingFirstPoint) {
          // 第一次点击：记左上角
          return { ...s, pendingFirstPoint: { mode: s.mode, x: p.x, y: p.y } };
        }
        if (s.pendingFirstPoint.mode !== s.mode) {
          // 用户点了第一次后切换了模式 —— 第二次点击丢弃第一次，重新算左上角
          return { ...s, pendingFirstPoint: { mode: s.mode, x: p.x, y: p.y } };
        }
        // 第二次点击：和左上角合成矩形
        const first = s.pendingFirstPoint;
        const x = Math.min(first.x, p.x);
        const y = Math.min(first.y, p.y);
        const w = Math.abs(p.x - first.x);
        const h = Math.abs(p.y - first.y);
        // 矩形太小（< 1%）当成误触直接放弃
        if (w < 0.01 || h < 0.01) {
          return { ...s, pendingFirstPoint: null };
        }
        const roiNorm = { x, y, width: w, height: h };
        const mode = s.mode;
        return {
          ...s,
          pendingFirstPoint: null,
          hoopRoiNorm: mode === "hoop" ? roiNorm : s.hoopRoiNorm,
          courtRoiNorm: mode === "court" ? roiNorm : s.courtRoiNorm,
        };
      });
    },
    [computeNormPoint],
  );

  /* ----- Slider seek ----- */
  const handleSliderChange = useCallback(
    (v: number[]) => {
      const t = v[0] ?? 0;
      isDraggingSliderRef.current = true;
      seekVideoTo(t);
      setCurrentTimeSec(t);
    },
    [seekVideoTo],
  );

  const handleSliderCommit = useCallback(
    (v: number[]) => {
      const t = v[0] ?? 0;
      isDraggingSliderRef.current = false;
      seekVideoTo(t);
    },
    [seekVideoTo],
  );

  const handleTimeUpdate = () => {
    if (isDraggingSliderRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    setCurrentTimeSec(v.currentTime);
  };

  /* ----- 保存：百分比 → 真实像素 ----- */
  const saveDisabled = state.hoopRoiNorm == null || saving;

  const handleSave = () => {
    if (!state.hoopRoiNorm) return;
    const hoopRoi: RoiRect = {
      x: Math.round(state.hoopRoiNorm.x * nw),
      y: Math.round(state.hoopRoiNorm.y * nh),
      width: Math.max(1, Math.round(state.hoopRoiNorm.width * nw)),
      height: Math.max(1, Math.round(state.hoopRoiNorm.height * nh)),
    };
    const courtRoi: RoiRect | null = state.courtRoiNorm
      ? {
          x: Math.round(state.courtRoiNorm.x * nw),
          y: Math.round(state.courtRoiNorm.y * nh),
          width: Math.max(1, Math.round(state.courtRoiNorm.width * nw)),
          height: Math.max(1, Math.round(state.courtRoiNorm.height * nh)),
        }
      : null;
    onSave({
      hoopRoi,
      courtRoi,
      selectedFrameSec: currentTimeSec,
    });
  };

  /* ----- Tooltip 展示当前画框 mode / pending 左上角 ----- */
  const cursorHint = useMemo(() => {
    if (state.pendingFirstPoint) {
      return "Step 2/2: Click the bottom-right corner of the box";
    }
    if (state.mode === "hoop")
      return "Step 1/2: Click the TOP-LEFT of the hoop bounding box";
    return "Step 1/2: Click the TOP-LEFT of the court bounding box";
  }, [state.pendingFirstPoint, state.mode]);

  return (
    <div className={cn("flex h-full flex-col gap-3 overflow-auto", className)}>
      <Alert className="border-amber-500/40 bg-amber-500/5">
        <AlertTitle className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-amber-500" /> Calibrate Hoop &amp;
          Court
        </AlertTitle>
        <AlertDescription className="mt-1 text-sm leading-relaxed">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span>
              Required:{" "}
              <span className="font-semibold">
                Hoop <span className="text-rose-500">*</span>
              </span>
            </span>
            <span>
              Optional: <span className="font-semibold">Court</span>
            </span>
            <span className="text-[var(--muted-foreground)]">
              Pick a frame → choose a mode → mark 2 corners per box.
            </span>
          </div>
          <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
            Tip:{" "}
            <span className="font-mono font-bold text-amber-300">
              Auto Calibrate (AI)
            </span>{" "}
            will suggest boxes once AI worker is connected.
          </span>
        </AlertDescription>
      </Alert>

      {/* Stage 1: Toolbar — modes + AutoCalibrate placeholder */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
        <div className="flex items-center gap-2">
          <Button
            variant={state.mode === "hoop" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setState((s) => ({ ...s, mode: "hoop", pendingFirstPoint: null }))
            }
            className={cn(
              state.hoopRoiNorm &&
                "ring-2 ring-offset-2 ring-offset-[var(--card)] ring-emerald-500",
            )}
          >
            <Circle className="h-4 w-4" /> Hoop ROI
            {state.hoopRoiNorm ? (
              <Badge
                variant="secondary"
                className="ml-1 h-4 bg-emerald-500/15 text-emerald-600"
              >
                ✓ Set
              </Badge>
            ) : (
              <Badge variant="destructive" className="ml-1 h-4">
                Required
              </Badge>
            )}
          </Button>
          <Button
            variant={state.mode === "court" ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setState((s) => ({
                ...s,
                mode: "court",
                pendingFirstPoint: null,
              }))
            }
            className={cn(
              state.courtRoiNorm &&
                "ring-2 ring-offset-2 ring-offset-[var(--card)] ring-emerald-500",
            )}
          >
            <Square className="h-4 w-4" /> Court ROI
            <Badge variant="outline" className="ml-1 h-4">
              {state.courtRoiNorm ? "Set" : "Optional"}
            </Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setState((s) => ({
                ...s,
                hoopRoiNorm: s.mode === "hoop" ? null : s.hoopRoiNorm,
                courtRoiNorm: s.mode === "court" ? null : s.courtRoiNorm,
                pendingFirstPoint: null,
              }))
            }
          >
            <Trash2 className="h-4 w-4" /> Clear {state.mode.toUpperCase()}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" disabled>
                <Sparkles className="h-4 w-4" /> Auto Calibrate (AI)
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                Coming soon — ai-worker is not connected yet. Once it runs, this
                will call{" "}
                <span className="font-mono">
                  POST /videos/:id/calibration/auto
                </span>{" "}
                and fill suggested hoop / court boxes for you to tweak.
              </p>
            </TooltipContent>
          </Tooltip>
          <Button
            size="sm"
            disabled={saveDisabled || saving}
            onClick={handleSave}
            className="gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving&hellip;
              </>
            ) : (
              "Save Calibration & Start AI"
            )}
          </Button>
        </div>
      </div>

      {/* Stage 2: Video (no autoplay, paused, overlay ROI boxes + crosshair) */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 rounded-xl border border-[var(--border)] bg-black overflow-hidden select-none"
      >
        <div
          data-video-wrap
          className="relative h-full w-full flex items-center justify-center"
          onMouseMove={handleVideoMouseMove}
          onMouseLeave={handleVideoMouseLeave}
          onClick={handleVideoClick}
        >
          <video
            ref={videoRef}
            src={previewUrl}
            muted
            playsInline
            preload="auto"
            controls={false}
            autoPlay={false}
            onTimeUpdate={handleTimeUpdate}
            className="h-full w-full object-contain cursor-crosshair"
          />

          {/* 🔥 关键修复：这个绝对定位盒子 = 精确覆盖「真实视频渲染面积（去黑边）」
              ROI / crosshair / pending 红点全部挂在这里，
              它们的 top/left: N% 就对应归一化坐标的 N%，不会再因为黑边错位。 */}
          {videoRenderRect &&
            videoRenderRect.w > 0 &&
            videoRenderRect.h > 0 && (
              <div
                data-video-overlay
                className="pointer-events-none absolute"
                style={{
                  left: videoRenderRect.x,
                  top: videoRenderRect.y,
                  width: videoRenderRect.w,
                  height: videoRenderRect.h,
                }}
              >
                {/* ROI boxes overlay —— 用 % 定位，现在参考框就是真实视频本身 */}
                {state.hoopRoiNorm && (
                  <div
                    className="absolute border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                    style={{
                      left: `${state.hoopRoiNorm.x * 100}%`,
                      top: `${state.hoopRoiNorm.y * 100}%`,
                      width: `${state.hoopRoiNorm.width * 100}%`,
                      height: `${state.hoopRoiNorm.height * 100}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      HOOP
                    </span>
                  </div>
                )}
                {state.courtRoiNorm && (
                  <div
                    className="absolute border-2 border-sky-400 bg-sky-400/10 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                    style={{
                      left: `${state.courtRoiNorm.x * 100}%`,
                      top: `${state.courtRoiNorm.y * 100}%`,
                      width: `${state.courtRoiNorm.width * 100}%`,
                      height: `${state.courtRoiNorm.height * 100}%`,
                    }}
                  >
                    <span className="absolute -top-5 left-0 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">
                      COURT
                    </span>
                  </div>
                )}

                {/* Crosshair when hovering — 水平线高度现在就是真实视频高度，不会延伸到黑边 */}
                {state.hoverPoint && (
                  <>
                    <div
                      className="absolute h-px w-full bg-white/40"
                      style={{ top: `${state.hoverPoint.y * 100}%` }}
                    />
                    <div
                      className="absolute w-px h-full bg-white/40"
                      style={{ left: `${state.hoverPoint.x * 100}%` }}
                    />
                    {/* pending 第一次点击的角标记 */}
                    {state.pendingFirstPoint && (
                      <div
                        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500"
                        style={{
                          left: `${state.pendingFirstPoint.x * 100}%`,
                          top: `${state.pendingFirstPoint.y * 100}%`,
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            )}

          {/* Bottom hint banner — 毛玻璃边框背景 + 明显的圆角胶囊 */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-center px-4 pb-4 pt-8 bg-gradient-to-t from-black/60 to-transparent">
            <div className="pointer-events-none backdrop-blur-md bg-black/50 border border-white/15 rounded-full px-4 py-2 shadow-xl ring-1 ring-black/20 shadow-black/40">
              <p className="text-xs font-semibold text-white tracking-wide">
                {cursorHint}
              </p>
            </div>
          </div>
        </div>

        {/* Loading spinner while metadata not ready */}
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-sm text-white/80">Loading video frame…</p>
          </div>
        )}
      </div>

      {/* Stage 3: Timeline slider */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span className="font-mono">{formatClock(currentTimeSec)}</span>
          <span className="font-semibold text-[var(--foreground)]">
            Drag the timeline to find a clear hoop view
          </span>
          <span className="font-mono">{formatClock(realDuration)}</span>
        </div>
        <Slider
          min={0}
          max={realDuration}
          step={0.01}
          value={[currentTimeSec]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          className="w-full cursor-grab active:cursor-grabbing"
        />
      </div>
    </div>
  );
}

function formatClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const sec = Math.floor(s);
  const m = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  const h = Math.floor(m / 60);
  if (h > 0) {
    const mm = String(m % 60).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}
