import type { Detection, RenderRect } from "@/types/detection";
import { colorFor } from "@/constants/detection";

export type DrawnBox = {
  label: string;
  conf: number;
  nat: [number, number, number, number];
  scr: [number, number, number, number];
};

export type DrawBboxesArgs = {
  ctx: CanvasRenderingContext2D;
  render: RenderRect;
  list: Detection[];
  currentTime: number;
  nearestTime: number | null;
};

export function drawBboxes({
  ctx,
  render,
  list,
  currentTime: _currentTime,
  nearestTime: _nearestTime,
}: DrawBboxesArgs): DrawnBox[] {
  ctx.clearRect(0, 0, render.stageW, render.stageH);
  const drawn: DrawnBox[] = [];

  for (const d of list) {
    const nativeX1 = d.x - d.w / 2;
    const nativeY1 = d.y - d.h / 2;
    const nativeX2 = d.x + d.w / 2;
    const nativeY2 = d.y + d.h / 2;
    const x1 = render.dispX + nativeX1 * render.sx;
    const y1 = render.dispY + nativeY1 * render.sy;
    const x2 = render.dispX + nativeX2 * render.sx;
    const y2 = render.dispY + nativeY2 * render.sy;
    const w = x2 - x1;
    const h = y2 - y1;

    const color = colorFor(d.label);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.strokeRect(x1, y1, Math.max(0, w), Math.max(0, h));

    const labelText = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
    const metrics = ctx.measureText(labelText);
    const padX = 6;
    const padY = 3;
    const tagW = metrics.width + padX * 2;
    const tagH = 12 + padY * 2;
    let tagY = y1 - tagH;
    if (tagY < 0) tagY = y1;
    if (tagY + tagH > render.stageH) tagY = y1 - tagH;
    ctx.fillStyle = color;
    ctx.fillRect(x1, tagY, tagW, tagH);
    ctx.fillStyle = "#0a0a0a";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, x1 + padX, tagY + tagH / 2);

    drawn.push({
      label: d.label,
      conf: d.confidence,
      nat: [nativeX1, nativeY1, nativeX2, nativeY2],
      scr: [x1, y1, x2, y2],
    });
  }

  return drawn;
}

export function findNearestTimestamps(
  t: number,
  sampledTimestamps: number[],
): number | null {
  if (sampledTimestamps.length === 0) return null;
  let lo = 0;
  let hi = sampledTimestamps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sampledTimestamps[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let bestIdx = lo;
  if (lo > 0) {
    const a = sampledTimestamps[lo - 1];
    const b = sampledTimestamps[lo];
    if (Math.abs(a - t) < Math.abs(b - t)) bestIdx = lo - 1;
  }
  return sampledTimestamps[bestIdx];
}
