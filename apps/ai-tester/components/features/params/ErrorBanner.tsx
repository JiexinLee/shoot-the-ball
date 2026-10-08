export type ErrorBannerProps = {
  error: string | null;
};

export function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) return null;
  return (
    <div className="rounded-md border border-destructive/60 bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
      <div className="font-semibold mb-1">Detection failed</div>
      {error}
    </div>
  );
}
