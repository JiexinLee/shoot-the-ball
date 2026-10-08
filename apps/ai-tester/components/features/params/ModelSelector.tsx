"use client";

import { useState } from "react";
import { MODEL_OPTIONS } from "@/constants/detection";
import { CustomModelGuideModal } from "./CustomModelGuideModal";

export type ModelSelectorProps = {
  model: string;
  customModel: string;
  onChangeModel: (value: string) => void;
  onChangeCustomModel: (value: string) => void;
};

export function ModelSelector({
  model,
  customModel,
  onChangeModel,
  onChangeCustomModel,
}: ModelSelectorProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const showCustomInput = model === "__custom__";

  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-2">
        <label className="text-sm font-semibold leading-none">
          5. YOLO model
        </label>
        <button
          type="button"
          title="How to use a custom trained model (Plan A)"
          onClick={() => setGuideOpen(true)}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition shrink-0"
          aria-label="Open custom model guide"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </button>
      </div>
      <select
        value={model}
        onChange={(e) => onChangeModel(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        {MODEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {showCustomInput && (
        <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-2.5">
          <div className="flex items-start gap-2">
            <div className="text-[11px] mt-0.5 text-primary shrink-0">Tip</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed flex-1">
              Click the{" "}
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="text-primary hover:underline inline-flex items-center gap-1 align-middle px-1 rounded"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                <span className="font-semibold">info</span>
              </button>{" "}
              icon next to “YOLO model” for a step-by-step guide, including how
              to pull <code>best.pt</code> from EC2 and how to set class IDs for
              your custom dataset.
            </div>
          </div>
          <div className="mt-2 relative">
            <input
              type="text"
              value={customModel}
              onChange={(e) => onChangeCustomModel(e.target.value)}
              placeholder="e.g. /Users/jiexinli/models/custom-bball-v1.pt"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm pr-24"
            />
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/30 px-2 py-1 text-[10px] font-semibold text-primary hover:bg-primary/20 transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Guide
            </button>
          </div>
        </div>
      )}

      <CustomModelGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}
