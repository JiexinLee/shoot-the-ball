import { useCallback } from "react";
import type { Detection, RenderRect } from "@/types/detection";
import { computeRenderRect } from "@/utils/objectFit";

export type UseRenderHelpers = {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
};

export function useCanvasHelpers({
  videoRef,
  stageRef,
  canvasRef,
}: UseRenderHelpers) {
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [canvasRef, stageRef]);

  const computeRender = useCallback((): RenderRect | null => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return null;
    const natW = video.videoWidth;
    const natH = video.videoHeight;
    if (!natW || !natH) return null;
    const stageRect = stage.getBoundingClientRect();
    const stageW = stageRect.width;
    const stageH = stageRect.height;
    if (!stageW || !stageH) return null;
    return computeRenderRect(natW, natH, stageW, stageH);
  }, [videoRef, stageRef]);

  return { resizeCanvas, computeRender };
}
