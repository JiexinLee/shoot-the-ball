import { useCallback, useEffect, useRef } from "react";
import type { Detection, RenderRect } from "@/types/detection";
import { drawBboxes, findNearestTimestamps, type DrawnBox } from "./drawBboxes";

export type UseDrawBboxesArgs = {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  detections: Detection[] | null;
  sampledTimestamps: number[];
  computeRender: () => RenderRect | null;
  onFrameDebug?: (args: {
    currentTime: number;
    nearestTime: number | null;
    render: RenderRect | null;
    detectionsAtTime: Detection[];
    drawnBoxes: DrawnBox[];
  }) => void;
};

export function useDrawBboxes({
  videoRef,
  canvasRef,
  detections,
  sampledTimestamps,
  computeRender,
  onFrameDebug,
}: UseDrawBboxesArgs) {
  const rafRef = useRef<number | null>(null);
  const lastDrawnTimeRef = useRef<number>(-1);
  const lastDrawnStageSigRef = useRef<string>("");

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const t = video.currentTime;
    const render = computeRender();
    const stageSig = render
      ? `${render.stageW.toFixed(1)}x${render.stageH.toFixed(1)};${render.natW}x${render.natH};${render.dispX.toFixed(2)},${render.dispY.toFixed(2)},${render.dispW.toFixed(2)},${render.dispH.toFixed(2)}`
      : "";
    const needsRedraw =
      t !== lastDrawnTimeRef.current ||
      stageSig !== lastDrawnStageSigRef.current;
    if (!needsRedraw) return;
    lastDrawnTimeRef.current = t;
    lastDrawnStageSigRef.current = stageSig;
    if (!render) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let list: Detection[] = [];
    let nearestT: number | null = null;
    if (detections && detections.length > 0) {
      nearestT = findNearestTimestamps(t, sampledTimestamps);
      if (nearestT != null) {
        list = detections.filter((d) => Math.abs(d.time - nearestT!) < 1e-6);
      }
    }
    const drawn = drawBboxes({
      ctx,
      render,
      list,
      currentTime: t,
      nearestTime: nearestT,
    });
    onFrameDebug?.({
      currentTime: t,
      nearestTime: nearestT,
      render,
      detectionsAtTime: list,
      drawnBoxes: drawn,
    });
  }, [computeRender, detections, onFrameDebug, sampledTimestamps]);

  useEffect(() => {
    lastDrawnTimeRef.current = -1;
    lastDrawnStageSigRef.current = "";
    const loop = () => {
      tick();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [tick]);
}
