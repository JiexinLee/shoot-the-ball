import type { Detection, RenderRect } from "@/types/detection";
import { colorFor } from "@/constants/detection";
import type { DrawnBox } from "../canvas/drawBboxes";

export type BboxInspectorFrameDebug = {
  currentTime: number;
  nearestTime: number | null;
  render: RenderRect | null;
  detectionsAtTime: Detection[];
  drawnBoxes: DrawnBox[];
  sampledFramesCount: number;
};

export type BboxInspectorProps = {
  debug: BboxInspectorFrameDebug | null;
  htmlRef?: (el: HTMLDivElement | null) => void;
};

export function BboxInspector({ debug, htmlRef }: BboxInspectorProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-[11px] font-mono space-y-1 max-h-60 overflow-y-auto">
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider font-semibold mb-1">
        Current-frame bbox inspector
      </div>
      <div ref={htmlRef} className="leading-relaxed">
        {debug == null
          ? "(play or seek the video to populate)"
          : debug.drawnBoxes.length === 0
            ? "(no bboxes matched at current time)"
            : debug.drawnBoxes.map((b, i) => (
                <div
                  key={`${b.label}-${i}`}
                  className="border-b border-white/10 py-1 first:pt-0 last:pb-0 last:border-0"
                >
                  <span
                    style={{ color: colorFor(b.label), fontWeight: 700 }}
                  >
                    {b.label}
                  </span>{" "}
                  <span className="text-muted-foreground">conf=</span>
                  {(b.conf * 100).toFixed(1)}%
                  <br />
                  <span className="text-muted-foreground">  native=</span>(
                  {b.nat[0].toFixed(0)},{b.nat[1].toFixed(0)})-(
                  {b.nat[2].toFixed(0)},{b.nat[3].toFixed(0)}){" "}
                  <span className="text-muted-foreground">screen=</span>(
                  {b.scr[0].toFixed(0)},{b.scr[1].toFixed(0)})-(
                  {b.scr[2].toFixed(0)},{b.scr[3].toFixed(0)})
                </div>
              ))}
      </div>
    </div>
  );
}
