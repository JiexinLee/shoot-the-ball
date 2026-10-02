export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <p className="text-xs text-[var(--muted-foreground)]">
          © {new Date().getFullYear()} Shoot The Ball
        </p>
      </div>
    </footer>
  );
}
