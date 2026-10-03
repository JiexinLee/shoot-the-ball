"use client";

import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { UploadedVideo } from "@/lib/types";
import { exports_ } from "@/lib/api/exports";
import { DEFAULT_PROJECT_ID } from "@/lib/api/upload";

type ExportPollTimerRef = ReturnType<typeof setTimeout> | null;

export interface PollUntilReadyArgs {
  exportPollTimerRef: MutableRefObject<ExportPollTimerRef>;
}

export function usePollExportUntilReady({
  exportPollTimerRef,
}: PollUntilReadyArgs) {
  return useCallback(
    async (
      exportId: string,
      opts?: {
        videoFilename?: string | null;
        highlightIndex?: number;
        totalCount?: number;
        startTimeSec?: number | null;
        endTimeSec?: number | null;
      },
    ) => {
      const sleep = (ms: number) =>
        new Promise<void>((res) => {
          const t = setTimeout(() => {
            exportPollTimerRef.current = null;
            res();
          }, ms);
          if (exportPollTimerRef.current) {
            /* 外部整体 cancel 时会统一 clearTimeout，这里不单独 clear，避免串行定时器互相打断 */
          }
          exportPollTimerRef.current = t;
        });

      const pad2 = (n: number) => n.toString().padStart(2, "0");
      const formatTime = (s: number | null | undefined) => {
        if (typeof s !== "number" || !Number.isFinite(s)) return "clip";
        const sec = Math.max(0, Math.floor(s));
        const m = Math.floor(sec / 60);
        const ss = sec - m * 60;
        return `${pad2(m)}m${pad2(ss)}s`;
      };

      const buildFilename = (): string => {
        const base = (opts?.videoFilename ?? "highlight")
          .replace(/\.[^.]+$/, "")
          .replace(/[^\p{Letter}\p{Number}_\-]/gu, "_");
        const idx =
          typeof opts?.highlightIndex === "number" &&
          typeof opts?.totalCount === "number"
            ? `${opts.highlightIndex + 1}-of-${opts.totalCount}`
            : `${exportId.slice(-6)}`;
        const time = `${formatTime(opts?.startTimeSec)}-${formatTime(opts?.endTimeSec)}`;
        return `${base}__${idx}__${time}.mp4`;
      };

      try {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const { export: record, downloadUrl } =
            await exports_.getExport(exportId);
          if (record.status === "EXPORTED" && downloadUrl) {
            const filename = buildFilename();
            try {
              const resp = await fetch(downloadUrl, { mode: "cors" });
              if (resp.ok) {
                const blob = await resp.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
                return;
              }
            } catch {
              /* fallthrough: CORS 等失败时兜底直接 <a download> */
            }
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = filename;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            return;
          }
          if ((record.status as string) === "FAILED") {
            return;
          }
          await sleep(800);
        }
      } catch {
        /* swallow */
      }
    },
    [exportPollTimerRef],
  );
}

export interface ExportHandlerArgs {
  activeVideo: UploadedVideo | null;
  selectedHighlightIds: Set<string>;
  deletedHighlightIds: Set<string>;
  videos: UploadedVideo[];
  pollExportUntilReady: ReturnType<typeof usePollExportUntilReady>;
  setExporting: (next: boolean) => void;
  exportPollTimerRef: MutableRefObject<ExportPollTimerRef>;
}

export function useExportHandler({
  activeVideo,
  selectedHighlightIds,
  deletedHighlightIds,
  videos,
  pollExportUntilReady,
  setExporting,
  exportPollTimerRef,
}: ExportHandlerArgs) {
  return useCallback(async () => {
    const active = activeVideo;
    const selectedIds = Array.from(selectedHighlightIds).filter(
      (id) => !deletedHighlightIds.has(id),
    );
    if (selectedIds.length === 0 || !active?.id) return;

    const clipById = new Map<
      string,
      { startTime?: number | null; endTime?: number | null }
    >();
    for (const v of videos) {
      const list = (v as { highlights?: unknown[] | null }).highlights ?? [];
      for (const c of list) {
        const cAny = c as {
          id?: string;
          startTime?: number | null;
          startTimeSec?: number | null;
          endTime?: number | null;
          endTimeSec?: number | null;
        };
        if (!cAny.id) continue;
        clipById.set(cAny.id, {
          startTime: cAny.startTime ?? cAny.startTimeSec ?? null,
          endTime: cAny.endTime ?? cAny.endTimeSec ?? null,
        });
      }
    }

    const safeFilename =
      (active as unknown as { name?: string }).name ??
      (active as unknown as { filename?: string }).filename ??
      "highlight";

    try {
      setExporting(true);
      if (exportPollTimerRef.current) {
        clearTimeout(exportPollTimerRef.current);
        exportPollTimerRef.current = null;
      }

      const total = selectedIds.length;
      await Promise.all(
        selectedIds.map(async (hlId, idx) => {
          const { export: created } = await exports_.createExport({
            projectId: DEFAULT_PROJECT_ID,
            type: "INDIVIDUAL",
            format: "MP4_FULL_HD",
            highlightIds: [hlId],
          });
          const meta = clipById.get(hlId);
          return pollExportUntilReady(created.id, {
            videoFilename: safeFilename,
            highlightIndex: idx,
            totalCount: total,
            startTimeSec: meta?.startTime ?? null,
            endTimeSec: meta?.endTime ?? null,
          });
        }),
      );
    } catch {
      /* swallow */
    } finally {
      setExporting(false);
    }
  }, [
    selectedHighlightIds,
    deletedHighlightIds,
    pollExportUntilReady,
    activeVideo,
    videos,
    setExporting,
    exportPollTimerRef,
  ]);
}
