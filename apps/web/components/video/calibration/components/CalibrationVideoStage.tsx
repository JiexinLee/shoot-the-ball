"use client";

import type { MutableRefObject, ReactNode } from "react";

type RoiMode = "hoop" | "court";
type NormRect = { x: number; y: number; width: number; height: number };
type NormPoint = { x: number; y: number };

interface RoiDrawingState {
  mode: RoiMode;
  hoopRoiNorm: NormRect | null;
  courtRoiNorm: NormRect | null;
  pendingFirstPoint: { mode: RoiMode; x: number; y: number } | null;
  hoverPoint: NormPoint | null;
}

export interface CalibrationVideoStageProps {
  stageRef: MutableRefObject<HTMLDivElement | null>;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  previewUrl: string;
  videoRenderRect: { x: number; y: number; w: number; h: number } | null;
  state: RoiDrawingState;
  isReady: boolean;
  cursorHint: string;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTimeUpdate: () => void;
  children?: ReactNode;
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
void formatClock;

export function CalibrationVideoStage({
  stageRef,
  videoRef,
  previewUrl,
  videoRenderRect,
  state,
  isReady,
  cursorHint,
  onMouseMove,
  onMouseLeave,
  onClick,
  onTimeUpdate,
}: CalibrationVideoStageProps) {
  return (
    <div
      ref={stageRef}
      className="relative flex-1 min-h-0 rounded-xl border border-[var(--border)] bg-black overflow-hidden select-none"
    >
      <div
        data-video-wrap
        className="relative h-full w-full flex items-center justify-center"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        <video
          ref={videoRef}
          src={previewUrl}
          muted
          playsInline
          preload="auto"
          controls={false}
          autoPlay={false}
          onTimeUpdate={onTimeUpdate}
          className="h-full w-full object-contain cursor-crosshair"
        />

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

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-center px-4 pb-4 pt-8 bg-gradient-to-t from-black/60 to-transparent">
          <div className="pointer-events-none backdrop-blur-md bg-black/50 border border-white/15 rounded-full px-4 py-2 shadow-xl ring-1 ring-black/20 shadow-black/40">
            <p className="text-xs font-semibold text-white tracking-wide">
              {cursorHint}
            </p>
          </div>
        </div>
      </div>

      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <p className="text-sm text-white/80">Loading video frame…</p>
        </div>
      )}
    </div>
  );
}
