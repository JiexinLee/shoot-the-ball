import { Card, CardContent } from "@/components/ui/card";
import { Download, Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, formatTimestamp } from "@/lib/format";
import type { Export } from "@/lib/types";

interface ExportCardProps {
  exportItem: Export;
  onDownload?: (id: string) => void;
}

export function ExportCard({ exportItem }: ExportCardProps) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <Clapperboard className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium truncate">
              {exportItem.type} Export
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {exportItem.highlightIds.length} clips
              {exportItem.sizeBytes ? ` · ${formatBytes(exportItem.sizeBytes)}` : ""}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatTimestamp(exportItem.createdAt)}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          disabled={exportItem.status !== "READY"}
          variant={exportItem.status === "READY" ? "default" : "outline"}
        >
          <Download className="h-4 w-4" />
          {exportItem.status === "READY" ? "Download" : exportItem.status}
        </Button>
      </CardContent>
    </Card>
  );
}
