export function VideoPlayer() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)] p-12 text-center">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Video Player</p>
        <p className="text-xs text-[var(--muted-foreground)]">
          Component placeholder — full-screen video player with timeline scrubbing.
        </p>
      </div>
    </div>
  );
}
