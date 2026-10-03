"use client";

import { Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function CalibrationAlert() {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <AlertTitle className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-amber-500" /> Calibrate Hoop &amp;
        Court
      </AlertTitle>
      <AlertDescription className="mt-1 text-sm leading-relaxed">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>
            Required:{" "}
            <span className="font-semibold">
              Hoop <span className="text-rose-500">*</span>
            </span>
          </span>
          <span>
            Optional: <span className="font-semibold">Court</span>
          </span>
          <span className="text-[var(--muted-foreground)]">
            Pick a frame → choose a mode → mark 2 corners per box.
          </span>
        </div>
        <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
          Tip:{" "}
          <span className="font-mono font-bold text-amber-300">
            Auto Calibrate (AI)
          </span>{" "}
          will suggest boxes once AI worker is connected.
        </span>
      </AlertDescription>
    </Alert>
  );
}
