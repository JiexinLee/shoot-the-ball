import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatProgress } from "@/lib/format";
import { Loader2 } from "lucide-react";

interface JobProgressTrackerProps {
  progress: number;
  stage?: string;
  status: "idle" | "running" | "completed" | "failed";
  errorMessage?: string;
}

export function JobProgressTracker({
  progress,
  stage,
  status,
  errorMessage,
}: JobProgressTrackerProps) {
  const statusColor =
    status === "failed"
      ? "text-[var(--destructive)]"
      : status === "completed"
        ? "text-emerald-400"
        : "text-[var(--primary)]";

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2
              className={`h-4 w-4 ${status === "running" ? "animate-spin" : ""} ${statusColor}`}
            />
            <span className={`text-sm font-medium ${statusColor}`}>
              {stage ?? "Idle"}
            </span>
          </div>
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            {formatProgress(progress / 100)}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
        {errorMessage && (
          <p className="rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
            {errorMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
