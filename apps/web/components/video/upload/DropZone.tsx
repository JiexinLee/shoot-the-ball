"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Upload, UploadCloud, FileVideo } from "lucide-react";
import { ACCEPTED_MIME } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES } from "@/lib/api-client";

interface DropZoneProps {
  dragActive: boolean;
  onDragActiveChange: (active: boolean) => void;
  onFilesAdded: (files: FileList | File[]) => void;
  className?: string;
}

export function DropZone({
  dragActive,
  onDragActiveChange,
  onFilesAdded,
  className,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCountRef = useRef(0);

  const validateDragData = (e: React.DragEvent<HTMLDivElement>): boolean => {
    if (!e.dataTransfer) return false;
    if (
      e.dataTransfer.types &&
      Array.from(e.dataTransfer.types).includes("Files")
    ) {
      return true;
    }
    const items = e.dataTransfer.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") return true;
      }
    }
    return false;
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    onDragActiveChange(false);
    if (e.dataTransfer.files?.length) onFilesAdded(e.dataTransfer.files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!validateDragData(e)) return;
    dragCountRef.current += 1;
    if (dragCountRef.current === 1) {
      onDragActiveChange(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = Math.max(0, dragCountRef.current - 1);
    if (dragCountRef.current === 0) {
      onDragActiveChange(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-all duration-200 select-none",
        dragActive
          ? "border-primary bg-(--primary)/5 scale-[1.01]"
          : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/60 hover:bg-[var(--card)]/80",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_MIME}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFilesAdded(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-2xl transition-all",
          dragActive
            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "bg-[var(--primary)]/10 text-[var(--primary)] group-hover:bg-[var(--primary)]/20",
        )}
      >
        {dragActive ? (
          <UploadCloud className="h-8 w-8" />
        ) : (
          <Upload className="h-8 w-8" />
        )}
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold">
          Drag and drop video files here, or
          <span className="mx-1 text-[var(--primary)] underline underline-offset-4">
            click to browse
          </span>
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          Supports MP4 / MOV / MKV and other common formats · Max{" "}
          {formatBytes(MAX_UPLOAD_BYTES)} per file · Batch upload enabled
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        className="pointer-events-none"
      >
        <FileVideo className="h-4 w-4" /> Select Video
      </Button>
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[var(--primary)]/5" />
      )}
    </div>
  );
}
