"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DetectResponse, Detection, VideoMeta } from "@/types/detection";
import { useCanvasHelpers } from "@/components/features/canvas/useCanvasHelpers";
import {
  useDrawBboxes,
  type UseDrawBboxesArgs,
} from "@/components/features/canvas/useDrawBboxes";
import type { DrawnBox } from "@/components/features/canvas/drawBboxes";
import { FilePicker } from "@/components/features/params/FilePicker";
import { ClassesSelector } from "@/components/features/params/ClassesSelector";
import { ConfSlider } from "@/components/features/params/ConfSlider";
import { SampleEveryInput } from "@/components/features/params/SampleEveryInput";
import { ModelSelector } from "@/components/features/params/ModelSelector";
import { RunDetectionButton } from "@/components/features/params/RunDetectionButton";
import { ResultSummary } from "@/components/features/params/ResultSummary";
import { StderrAccordion } from "@/components/features/params/StderrAccordion";
import { ErrorBanner } from "@/components/features/params/ErrorBanner";
import {
  BboxInspector,
  type BboxInspectorFrameDebug,
} from "@/components/features/inspector/BboxInspector";
import { VideoStage } from "@/components/features/stage/VideoStage";
import { SiteHeader } from "@/components/SiteHeader";

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const debugRef = useRef<HTMLDivElement | null>(null);
  const debugBoxesElRef = useRef<HTMLDivElement | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);

  const [classes, setClasses] = useState<string>("person");
  const [customClasses, setCustomClasses] = useState<string>("");
  const [conf, setConf] = useState<number>(0.3);
  const [sampleEvery, setSampleEvery] = useState<number>(30);
  const [model, setModel] = useState<string>("yolov8n.pt");
  const [customModel, setCustomModel] = useState<string>("");

  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stderr, setStderr] = useState<string>("");
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [frameDebug, setFrameDebug] = useState<BboxInspectorFrameDebug | null>(
    null,
  );

  const { resizeCanvas, computeRender } = useCanvasHelpers({
    videoRef,
    stageRef,
    canvasRef,
  });

  const sampledTimestamps = useMemo(() => {
    if (!detections) return [] as number[];
    const set = new Set<number>();
    for (const d of detections) set.add(d.time);
    return Array.from(set).sort((a, b) => a - b);
  }, [detections]);

  const stats = useMemo(() => {
    if (!detections) return null;
    const byLabel = new Map<string, number>();
    for (const d of detections) {
      byLabel.set(d.label, (byLabel.get(d.label) ?? 0) + 1);
    }
    return {
      total: detections.length,
      framesSampled: sampledTimestamps.length,
      byLabel: Array.from(byLabel.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [detections, sampledTimestamps]);

  const effectiveClasses = classes === "__custom__" ? customClasses : classes;
  const effectiveModel = model === "__custom__" ? customModel : model;

  const onFrameDebug = useCallback<
    NonNullable<UseDrawBboxesArgs["onFrameDebug"]>
  >(
    (args) => {
      const { currentTime, nearestTime, render, detectionsAtTime, drawnBoxes } =
        args;

      if (debugRef.current) {
        debugRef.current.textContent =
          `t=${currentTime.toFixed(2)}s | ` +
          `nearest=${nearestTime == null ? "N/A" : `${nearestTime.toFixed(2)}s`} | ` +
          `detections@nearest=${detectionsAtTime.length} | ` +
          `sampled=${sampledTimestamps.length} frames | ` +
          (render
            ? `stage=${render.stageW.toFixed(0)}x${render.stageH.toFixed(0)} | ` +
              `native=${render.natW}x${render.natH} | ` +
              `disp=(${render.dispX.toFixed(1)},${render.dispY.toFixed(1)}) ` +
              `${render.dispW.toFixed(0)}x${render.dispH.toFixed(0)} | ` +
              `sx=${render.sx.toFixed(4)} sy=${render.sy.toFixed(4)}`
            : "");
      }

      const drawn: DrawnBox[] = drawnBoxes;
      const inspectorDebug: BboxInspectorFrameDebug = {
        currentTime,
        nearestTime,
        render,
        detectionsAtTime,
        drawnBoxes: drawn,
        sampledFramesCount: sampledTimestamps.length,
      };
      if (
        !frameDebug ||
        frameDebug.currentTime !== inspectorDebug.currentTime ||
        frameDebug.drawnBoxes.length !== inspectorDebug.drawnBoxes.length
      ) {
        setFrameDebug(inspectorDebug);
      }

      if (debugBoxesElRef.current) {
        if (drawn.length === 0) {
          debugBoxesElRef.current.textContent =
            "(no bboxes matched at current time)";
        } else {
          debugBoxesElRef.current.innerHTML = drawn
            .map(
              (b, i) =>
                `<div class="border-b border-white/10 py-1 first:pt-0 last:pb-0 last:border-0">` +
                `<span style="color:var(--primary)">${b.label}</span> ` +
                `<span>conf=${(b.conf * 100).toFixed(1)}%</span><br/>` +
                `native=(${b.nat[0].toFixed(0)},${b.nat[1].toFixed(0)})-` +
                `(${b.nat[2].toFixed(0)},${b.nat[3].toFixed(0)}) ` +
                `screen=(${b.scr[0].toFixed(0)},${b.scr[1].toFixed(0)})-` +
                `(${b.scr[2].toFixed(0)},${b.scr[3].toFixed(0)})` +
                `</div>`,
            )
            .join("");
        }
      }
    },
    [frameDebug, sampledTimestamps],
  );

  useDrawBboxes({
    videoRef,
    canvasRef,
    detections,
    sampledTimestamps,
    computeRender,
    onFrameDebug,
  });

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const onFileChange = useCallback(
    (file: File | null) => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setDetections(null);
      setStderr("");
      setError(null);
      setVideoMeta(null);
      setVideoFile(file);
      setVideoUrl(file ? URL.createObjectURL(file) : null);
    },
    [videoUrl],
  );

  const onVideoLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setVideoMeta({ w: video.videoWidth, h: video.videoHeight });
    }
    resizeCanvas();
  }, [resizeCanvas]);

  const runDetection = useCallback(async () => {
    if (!videoFile) return;
    const classesToSend = effectiveClasses.trim();
    if (!classesToSend) {
      setError("Classes cannot be empty.");
      return;
    }
    const modelToSend = effectiveModel.trim();
    if (!modelToSend) {
      setError("Model cannot be empty.");
      return;
    }

    setDetecting(true);
    setError(null);
    setStderr("");
    setDetections(null);

    try {
      const fd = new FormData();
      fd.append("video", videoFile);
      fd.append("classes", classesToSend);
      fd.append("conf", String(conf));
      fd.append("sampleEvery", String(sampleEvery));
      fd.append("model", modelToSend);

      const res = await fetch("/api/detect", { method: "POST", body: fd });
      const json = (await res.json()) as DetectResponse | { error: string };
      if (!res.ok || !("ok" in json) || !json.ok) {
        throw new Error(
          "error" in json && typeof json.error === "string"
            ? json.error
            : `HTTP ${res.status}`,
        );
      }
      setDetections(json.detections ?? []);
      setStderr(json.meta?.stderr ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setDetecting(false);
    }
  }, [videoFile, effectiveClasses, conf, sampleEvery, effectiveModel]);

  useEffect(() => {
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    resizeCanvas();
    return () => window.removeEventListener("resize", onResize);
  }, [resizeCanvas, videoMeta]);

  return (
    <div className="min-h-screen w-full px-4 py-6 md:px-8 md:py-8">
      <SiteHeader />

      <main className="max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
        <section className="rounded-xl border border-border bg-card p-5 space-y-5 h-fit">
          <FilePicker
            videoFile={videoFile}
            videoMeta={videoMeta}
            onChange={onFileChange}
          />

          <div className="border-t border-border pt-5 space-y-4">
            <ClassesSelector
              classes={classes}
              customClasses={customClasses}
              onChangeClasses={setClasses}
              onChangeCustomClasses={setCustomClasses}
            />

            <ConfSlider value={conf} onChange={setConf} />

            <SampleEveryInput value={sampleEvery} onChange={setSampleEvery} />

            <ModelSelector
              model={model}
              customModel={customModel}
              onChangeModel={setModel}
              onChangeCustomModel={setCustomModel}
            />
          </div>

          <RunDetectionButton
            disabled={!videoFile || detecting}
            loading={detecting}
            onClick={runDetection}
          />

          <ErrorBanner error={error} />
          <ResultSummary stats={stats} />
          <StderrAccordion stderr={stderr} />
        </section>

        <section className="space-y-4">
          <VideoStage
            videoUrl={videoUrl}
            videoRef={videoRef}
            canvasRef={canvasRef}
            stageRef={stageRef}
            debugRef={debugRef}
            onLoadedMetadata={onVideoLoadedMetadata}
            videoMeta={videoMeta}
          />

          <BboxInspector
            debug={frameDebug}
            htmlRef={(el) => {
              debugBoxesElRef.current = el;
            }}
          />

          <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground space-y-1">
            <p>
              <span className="text-foreground font-semibold">
                How bbox mapping works:
              </span>{" "}
              Video and canvas both cover the entire stage. The stage canvas
              computes an object-fit:contain render rect from (native width,
              native height) vs (stage width, stage height) — identical to how
              browsers draw video inside <code>object-contain</code>. Native
              coords from detect.py are multiplied by scale then translated by
              (dispX, dispY) to land on actual screen pixels.{" "}
              <strong>
                If native coords in the inspector already miss the person,
                that&apos;s a model/dataset issue, not a rendering bug.
              </strong>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
