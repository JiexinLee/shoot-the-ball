import { CLASSES_OPTIONS } from "@/constants/detection";

export type ClassesSelectorProps = {
  classes: string;
  customClasses: string;
  onChangeClasses: (value: string) => void;
  onChangeCustomClasses: (value: string) => void;
};

export function ClassesSelector({
  classes,
  customClasses,
  onChangeClasses,
  onChangeCustomClasses,
}: ClassesSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-2">
        2. Detection targets
      </label>
      <select
        value={classes}
        onChange={(e) => onChangeClasses(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {CLASSES_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        <option value="__custom__">Custom class IDs (comma separated)</option>
      </select>
      {classes === "__custom__" && (
        <input
          type="text"
          value={customClasses}
          onChange={(e) => onChangeCustomClasses(e.target.value)}
          placeholder="e.g. 0,32,1"
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}
