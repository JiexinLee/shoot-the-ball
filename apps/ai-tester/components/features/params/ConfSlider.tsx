export type ConfSliderProps = {
  value: number;
  onChange: (value: number) => void;
  hint?: string;
};

export function ConfSlider({
  value,
  onChange,
  hint = "For ball detection with yolov8n, try 0.05–0.15 first.",
}: ConfSliderProps) {
  return (
    <div>
      <div className="flex items-end justify-between mb-2">
        <label className="text-sm font-semibold">3. Confidence threshold</label>
        <span className="text-sm tabular-nums font-mono text-primary">
          {value.toFixed(3)}
        </span>
      </div>
      <input
        type="range"
        min={0.001}
        max={1}
        step={0.001}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
