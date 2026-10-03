"use client";

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface ClipsEmptyStateProps {
  Icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  iconClassName?: string;
  text?: string;
  className?: string;
}

export function ClipsEmptyState({
  Icon,
  iconClassName,
  text = "Processing highlights… check back shortly.",
  className,
}: ClipsEmptyStateProps) {
  const IconComp = Icon;
  return (
    <div
      className={cn(
        "w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-4 py-12 text-center",
        className,
      )}
    >
      <div className="flex flex-col items-center justify-center gap-3">
        {IconComp && (
          <IconComp
            className={iconClassName ?? "h-8 w-8 text-[var(--primary)]"}
            strokeWidth={2.25}
          />
        )}
        <p className="text-sm text-[var(--muted-foreground)]">{text}</p>
      </div>
    </div>
  );
}
