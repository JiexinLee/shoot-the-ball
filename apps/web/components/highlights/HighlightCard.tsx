import { Card, CardContent } from "@/components/ui/card";
import { formatConfidence } from "@/lib/format";
import { formatHighlightType, type Highlight } from "@/lib/types";

interface HighlightCardProps {
  highlight: Highlight;
  onSelect?: (id: string) => void;
  onPlay?: (id: string) => void;
}

export function HighlightCard({ highlight }: HighlightCardProps) {
  /* 兼容新旧字段名：contracts 定稿是 startTime/endTime，旧本地类型是 startTimeSec */
  const startTime = Number.isFinite(highlight.startTime)
    ? Number(highlight.startTime)
    : Number.isFinite(highlight.startTimeSec)
      ? Number(highlight.startTimeSec)
      : 0;
  const endTime = Number.isFinite(highlight.endTime)
    ? Number(highlight.endTime)
    : Number.isFinite(highlight.endTimeSec)
      ? Number(highlight.endTimeSec)
      : 0;

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video w-full bg-black" />
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--primary)]">
            {formatHighlightType(highlight.type)}
          </span>
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            conf: {formatConfidence(highlight.confidence)}
          </span>
        </div>
        <p className="text-xs text-[var(--muted-foreground)] tabular-nums">
          {startTime.toFixed(1)}s — {endTime.toFixed(1)}s
        </p>
      </CardContent>
    </Card>
  );
}
