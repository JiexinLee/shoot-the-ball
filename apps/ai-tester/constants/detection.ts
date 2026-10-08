export const CLASS_COLORS: Record<string, string> = {
  person: "#22c55e",
  player: "#22c55e",
  sports_ball: "#facc15",
  "sports ball": "#facc15",
  ball: "#facc15",
  basketball: "#facc15",
  hoop: "#3b82f6",
  rim: "#3b82f6",
};

export const DEFAULT_COLOR = "#06b6d4";

export function colorFor(label: string): string {
  return CLASS_COLORS[label] ?? DEFAULT_COLOR;
}

export type ClassesOption = { value: string; label: string };
export const CLASSES_OPTIONS: ClassesOption[] = [
  { value: "person", label: "person (COCO 0)" },
  { value: "ball", label: "ball / sports ball (COCO 32)" },
  { value: "0,32", label: "person + ball (0,32)" },
  { value: "all", label: "all 80 COCO classes" },
];

export type ModelOption = { value: string; label: string };
export const MODEL_OPTIONS: ModelOption[] = [
  { value: "yolov8n.pt", label: "yolov8n (nano · 6MB · fastest)" },
  { value: "yolov8s.pt", label: "yolov8s (small · 22MB)" },
  { value: "yolov8m.pt", label: "yolov8m (medium · 95MB · most accurate)" },
  { value: "__custom__", label: "Custom model path…" },
];
