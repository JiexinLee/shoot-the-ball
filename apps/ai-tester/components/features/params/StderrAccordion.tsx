export type StderrAccordionProps = {
  stderr: string;
};

export function StderrAccordion({ stderr }: StderrAccordionProps) {
  if (!stderr) return null;
  return (
    <details className="rounded-md border border-border bg-background">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none">
        detect.py stderr log
      </summary>
      <pre className="px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground font-mono whitespace-pre-wrap break-words max-h-80 overflow-auto">
        {stderr}
      </pre>
    </details>
  );
}
