import { Activity } from "lucide-react";

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20">
        <Activity className="h-5 w-5" strokeWidth={2.6} />
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--background)] ring-2 ring-[var(--card)]">
          <span className="block h-2 w-2 rounded-full bg-[var(--primary)]" />
        </span>
      </div>
      <div className="leading-tight">
        <div className="text-lg font-extrabold tracking-tight">
          Shoot <span className="text-[var(--primary)]">The</span> Ball
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          Basketball Highlight · Smart Clipping Console
        </div>
      </div>
    </div>
  );
}
