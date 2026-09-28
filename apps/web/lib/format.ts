const MEGABYTE = 1024 * 1024;
const GIGABYTE = MEGABYTE * 1024;

export function formatBytes(n: number): string {
  if (n >= GIGABYTE) return `${(n / GIGABYTE).toFixed(2)} GB`;
  if (n >= MEGABYTE) return `${(n / MEGABYTE).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec)) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatTimestamp(isoString?: string): string {
  if (!isoString) return "--";
  const d = new Date(isoString);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatConfidence(confidence: number): string {
  return `${(confidence * 100).toFixed(1)}%`;
}

export function formatProgress(progress: number): string {
  const pct = Math.max(0, Math.min(100, progress * 100));
  return `${pct.toFixed(0)}%`;
}
