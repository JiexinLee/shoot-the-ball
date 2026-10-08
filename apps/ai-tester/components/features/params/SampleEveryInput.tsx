export type SampleEveryInputProps = {
  value: number;
  onChange: (value: number) => void;
};

export function SampleEveryInput({
  value,
  onChange,
}: SampleEveryInputProps) {
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <label className="text-sm font-semibold">4. Sample every N frames</label>
        <span className="text-sm tabular-nums font-mono text-primary">
          {value} frame{value > 1 ? "s" : ""}
        </span>
      </div>
      <input
        type="number"
        min={1}
        max={1000}
        step={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">
        30 fps video: 30 ≈ 1 fps · 15 ≈ 2 fps · 5 ≈ 6 fps · 2 ≈ 15 fps · 1 = every frame (slow).
      </p>
    </div>
  );
}
