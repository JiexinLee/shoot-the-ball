export function SiteHeader() {
  return (
    <header className="max-w-[1600px] mx-auto mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          <span className="text-primary">AI Worker</span> Detection Lab
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Validate YOLO detection accuracy &amp; performance on local
          basketball videos before running the full pipeline.
        </p>
      </div>
      <div className="text-xs text-muted-foreground">
        Runs{" "}
        <code className="px-1.5 py-0.5 rounded bg-muted">detect.py</code> via{" "}
        <code className="px-1.5 py-0.5 rounded bg-muted">poetry</code> · port
        5679 · bboxes use object-fit:contain math (identical to browser&apos;s
        video renderer)
      </div>
    </header>
  );
}
