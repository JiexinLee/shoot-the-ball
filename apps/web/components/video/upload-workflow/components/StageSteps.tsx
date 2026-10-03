"use client";

import {
  UploadCloud,
  Video,
  Gauge,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DialogStage = "uploading" | "calibrating" | "finalizing";

export interface StageStepsProps {
  stage: DialogStage;
}

export function StageSteps({ stage }: StageStepsProps) {
  const steps: { key: DialogStage; label: string; icon: typeof UploadCloud }[] = [
    { key: "uploading", label: "Upload", icon: UploadCloud },
    { key: "calibrating", label: "Calibrate", icon: Gauge },
    { key: "finalizing", label: "Start AI", icon: Video },
  ];
  const idx = steps.findIndex((s) => s.key === stage);
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <Badge
              variant={done ? "secondary" : active ? "default" : "outline"}
              className={cn(
                "h-7 gap-1.5 text-xs",
                done &&
                  "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20",
                active && "text-[var(--primary-foreground)]",
              )}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <s.icon className="h-3.5 w-3.5" />
              )}
              {i + 1}. {s.label}
            </Badge>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "h-px w-8",
                  done ? "bg-emerald-500/60" : "bg-[var(--border)]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
