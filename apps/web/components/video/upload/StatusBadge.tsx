import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { UploadStatus } from "@/lib/types";

interface StatusBadgeProps {
  status: UploadStatus;
  progress: number;
}

export function StatusBadge({ status, progress }: StatusBadgeProps) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
          <Loader2 className="h-3 w-3" /> Pending
        </span>
      );
    case "uploading":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--primary)]">
          <Loader2 className="h-3 w-3 animate-spin" /> Uploading{" "}
          {progress.toFixed(0)}%
        </span>
      );
    case "processing":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]">
          <Loader2 className="h-3 w-3 animate-spin" /> AI Processing…
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Ready
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--destructive)]">
          <AlertCircle className="h-3 w-3" /> Failed
        </span>
      );
  }
}
