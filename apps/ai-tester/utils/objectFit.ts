import type { RenderRect } from "@/types/detection";

export function computeObjectFitContain(
  natW: number,
  natH: number,
  stageW: number,
  stageH: number,
): { dispW: number; dispH: number; dispX: number; dispY: number } {
  if (!natW || !natH || !stageW || !stageH) {
    return { dispW: 0, dispH: 0, dispX: 0, dispY: 0 };
  }
  const natRatio = natW / natH;
  const stageRatio = stageW / stageH;
  let dispW: number;
  let dispH: number;
  if (natRatio > stageRatio) {
    dispW = stageW;
    dispH = stageW / natRatio;
  } else {
    dispH = stageH;
    dispW = stageH * natRatio;
  }
  const dispX = (stageW - dispW) / 2;
  const dispY = (stageH - dispH) / 2;
  return { dispW, dispH, dispX, dispY };
}

export function computeRenderRect(
  natW: number,
  natH: number,
  stageW: number,
  stageH: number,
): RenderRect {
  const { dispW, dispH, dispX, dispY } = computeObjectFitContain(
    natW,
    natH,
    stageW,
    stageH,
  );
  return {
    stageW,
    stageH,
    dispX,
    dispY,
    dispW,
    dispH,
    sx: dispW / natW,
    sy: dispH / natH,
    natW,
    natH,
  };
}
