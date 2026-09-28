import { FileVideo, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: "video" | "folder";
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon = "video",
  className,
}: EmptyStateProps) {
  const Icon = icon === "folder" ? FolderOpen : FileVideo;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-12 text-center",
        className,
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)]">
        <Icon className="h-7 w-7" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-xs">
          {description}
        </p>
      )}
    </div>
  );
}
