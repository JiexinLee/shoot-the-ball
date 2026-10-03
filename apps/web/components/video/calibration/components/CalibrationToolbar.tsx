"use client";

import { Circle, Square, Trash2, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CalibrationToolbarProps {
  mode: "hoop" | "court";
  hoopSet: boolean;
  courtSet: boolean;
  saving: boolean;
  saveDisabled: boolean;
  onModeChange: (mode: "hoop" | "court") => void;
  onClearCurrent: () => void;
  onSave: () => void;
}

export function CalibrationToolbar({
  mode,
  hoopSet,
  courtSet,
  saving,
  saveDisabled,
  onModeChange,
  onClearCurrent,
  onSave,
}: CalibrationToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2">
      <div className="flex items-center gap-2">
        <Button
          variant={mode === "hoop" ? "default" : "outline"}
          size="sm"
          onClick={() => onModeChange("hoop")}
          className={cn(
            hoopSet &&
              "ring-2 ring-offset-2 ring-offset-[var(--card)] ring-emerald-500",
          )}
        >
          <Circle className="h-4 w-4" /> Hoop ROI
          {hoopSet ? (
            <Badge
              variant="secondary"
              className="ml-1 h-4 bg-emerald-500/15 text-emerald-600"
            >
              ✓ Set
            </Badge>
          ) : (
            <Badge variant="destructive" className="ml-1 h-4">
              Required
            </Badge>
          )}
        </Button>
        <Button
          variant={mode === "court" ? "default" : "outline"}
          size="sm"
          onClick={() => onModeChange("court")}
          className={cn(
            courtSet &&
              "ring-2 ring-offset-2 ring-offset-[var(--card)] ring-emerald-500",
          )}
        >
          <Square className="h-4 w-4" /> Court ROI
          <Badge variant="outline" className="ml-1 h-4">
            {courtSet ? "Set" : "Optional"}
          </Badge>
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearCurrent}>
          <Trash2 className="h-4 w-4" /> Clear {mode.toUpperCase()}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" disabled>
              <Sparkles className="h-4 w-4" /> Auto Calibrate (AI)
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="text-xs">
              Coming soon — ai-worker is not connected yet. Once it runs, this
              will call{" "}
              <span className="font-mono">
                POST /videos/:id/calibration/auto
              </span>{" "}
              and fill suggested hoop / court boxes for you to tweak.
            </p>
          </TooltipContent>
        </Tooltip>
        <Button
          size="sm"
          disabled={saveDisabled || saving}
          onClick={onSave}
          className="gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving&hellip;
            </>
          ) : (
            "Save Calibration & Start AI"
          )}
        </Button>
      </div>
    </div>
  );
}
