"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { RoiRect } from "@/lib/api/videos";
import { CalibrationAlert } from "./components/CalibrationAlert";
import { CalibrationToolbar } from "./components/CalibrationToolbar";
import { CalibrationVideoStage } from "./components/CalibrationVideoStage";
import { CalibrationTimeline } from "./components/CalibrationTimeline";

type RoiMode = "hoop" | "court";

type StageCalibration = {
  mode: RoiMode;
  hoopRoiNorm: { x: number; y: number; width: number; height: number } | null;
  courtRoiNorm: { x: number; y: number; width: number; height: number } | null;
  pendingFirstPoint: { mode: RoiMode; x: number; y: number } | null;
  hoverPoint: { x: number; y: number } | null;
};

export interface VideoCalibrationStageProps {
  previewUrl: string;
  naturalWidth?: number;
  naturalHeight?: number;
  durationSec?: number;
  defaultSeekSec?: number;
  onSave: (result: {
    hoopRoi: RoiRect;
    courtRoi: RoiRect | null;
    selectedFrameSec: number;
  }) => void;
  saving?: boolean;
  className?: string;
}

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
  const isDraggingSliderRef = useRef(false);

  const [state, setState] = useState<StageCalibration>({
    mode: "hoop",
    hoopRoiNorm: null,
    courtRoiNorm: null,
    pendingFirstPoint: null,
    hoverPoint: null,
  });

  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [realDuration, setRealDuration] = useState<number>(
    Math.max(1, durationSec ?? 1),
  );
  const [videoRenderRect, setVideoRenderRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

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

  const computeNormPoint = useCallback((clientX: number, clientY: number) => {
    const v = videoRef.current;
    if (!v) return null;
    const rect = v.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    if (vw <= 0 || vh <= 0) return null;
    const displayRatio = vw / vh;
    const videoRatio = v.videoWidth / v.videoHeight || 16 / 9;
    let innerW = vw;
    let innerH = vh;
    let innerX = 0;
    let innerY = 0;
    if (displayRatio > videoRatio) {
      innerW = vh * videoRatio;
      innerX = (vw - innerW) / 2;
    } else {
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
          return { ...s, pendingFirstPoint: { mode: s.mode, x: p.x, y: p.y } };
        }
        if (s.pendingFirstPoint.mode !== s.mode) {
          return { ...s, pendingFirstPoint: { mode: s.mode, x: p.x, y: p.y } };
        }
        const first = s.pendingFirstPoint;
        const x = Math.min(first.x, p.x);
        const y = Math.min(first.y, p.y);
        const w = Math.abs(p.x - first.x);
        const h = Math.abs(p.y - first.y);
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

  const saveDisabled = state.hoopRoiNorm == null || Boolean(saving);

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

  const cursorHint = useMemo(() => {
    if (state.pendingFirstPoint) {
      return "Step 2/2: Click the bottom-right corner of the box";
    }
    if (state.mode === "hoop")
      return "Step 1/2: Click the TOP-LEFT of the hoop bounding box";
    return "Step 1/2: Click the TOP-LEFT of the court bounding box";
  }, [state.pendingFirstPoint, state.mode]);

  const handleModeChange = useCallback((mode: RoiMode) => {
    setState((s) => ({ ...s, mode, pendingFirstPoint: null }));
  }, []);

  const handleClearCurrent = useCallback(() => {
    setState((s) => ({
      ...s,
      hoopRoiNorm: s.mode === "hoop" ? null : s.hoopRoiNorm,
      courtRoiNorm: s.mode === "court" ? null : s.courtRoiNorm,
      pendingFirstPoint: null,
    }));
  }, []);

  return (
    <div className={cn("flex h-full flex-col gap-3 overflow-auto", className)}>
      <CalibrationAlert />

      <CalibrationToolbar
        mode={state.mode}
        hoopSet={Boolean(state.hoopRoiNorm)}
        courtSet={Boolean(state.courtRoiNorm)}
        saving={saving ?? false}
        saveDisabled={saveDisabled}
        onModeChange={handleModeChange}
        onClearCurrent={handleClearCurrent}
        onSave={handleSave}
      />

      <CalibrationVideoStage
        stageRef={stageRef}
        videoRef={videoRef}
        previewUrl={previewUrl}
        videoRenderRect={videoRenderRect}
        state={state}
        isReady={isReady}
        cursorHint={cursorHint}
        onMouseMove={handleVideoMouseMove}
        onMouseLeave={handleVideoMouseLeave}
        onClick={handleVideoClick}
        onTimeUpdate={handleTimeUpdate}
      />

      <CalibrationTimeline
        currentTimeSec={currentTimeSec}
        realDuration={realDuration}
        onChange={handleSliderChange}
        onCommit={handleSliderCommit}
      />
    </div>
  );
}
