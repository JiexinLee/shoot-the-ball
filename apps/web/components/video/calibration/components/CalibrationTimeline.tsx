"use client";

import { Slider } from "@/components/ui/slider";

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

export interface CalibrationTimelineProps {
  currentTimeSec: number;
  realDuration: number;
  onChange: (value: number[]) => void;
  onCommit: (value: number[]) => void;
}

export function CalibrationTimeline({
  currentTimeSec,
  realDuration,
  onChange,
  onCommit,
}: CalibrationTimelineProps) {
  return (
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
        onValueChange={onChange}
        onValueCommit={onCommit}
        className="w-full cursor-grab active:cursor-grabbing"
      />
    </div>
  );
}
