import { Card, CardContent } from "@/components/ui/card";
import { formatConfidence } from "@/lib/format";
import type { Highlight } from "@/lib/types";

interface HighlightCardProps {
  highlight: Highlight;
  onSelect?: (id: string) => void;
  onPlay?: (id: string) => void;
}

export function HighlightCard({ highlight }: HighlightCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video w-full bg-black" />
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--primary)]">
            {highlight.type.replace("_", " ")}
          </span>
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            conf: {formatConfidence(highlight.confidence)}
          </span>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {highlight.startTimeSec.toFixed(1)}s — {highlight.endTimeSec.toFixed(1)}s
        </p>
      </CardContent>
    </Card>
  );
}
