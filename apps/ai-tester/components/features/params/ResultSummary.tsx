import type { DetectionStats } from "@/types/detection";
import { colorFor } from "@/constants/detection";

export type ResultSummaryProps = {
  stats: DetectionStats | null;
};

export function ResultSummary({ stats }: ResultSummaryProps) {
  if (!stats) return null;
  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Result summary
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Sampled frames</div>
          <div className="font-mono text-primary">{stats.framesSampled}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Total bboxes</div>
          <div className="font-mono text-primary">{stats.total}</div>
        </div>
      </div>
      {stats.byLabel.length > 0 && (
        <ul className="space-y-1 pt-1 border-t border-border">
          {stats.byLabel.map(([label, count]) => (
            <li
              key={label}
              className="flex items-center justify-between text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: colorFor(label) }}
                />
                {label}
              </span>
              <span className="font-mono">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
