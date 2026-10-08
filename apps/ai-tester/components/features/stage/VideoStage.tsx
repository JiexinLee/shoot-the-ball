import type { VideoMeta } from "@/types/detection";

export type VideoStageProps = {
  videoUrl: string | null;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  stageRef: React.MutableRefObject<HTMLDivElement | null>;
  debugRef?: React.MutableRefObject<HTMLDivElement | null>;
  onLoadedMetadata?: () => void;
  videoMeta: VideoMeta | null;
};

export function VideoStage({
  videoUrl,
  videoRef,
  canvasRef,
  stageRef,
  debugRef,
  onLoadedMetadata,
}: VideoStageProps) {
  return (
    <div
      ref={stageRef as React.RefObject<HTMLDivElement>}
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-border"
    >
      {videoUrl ? (
        <>
          <video
            ref={videoRef as React.RefObject<HTMLVideoElement>}
            src={videoUrl}
            controls
            playsInline
            onLoadedMetadata={onLoadedMetadata}
            className="absolute inset-0 w-full h-full object-contain bg-black block"
          />
          <canvas
            ref={canvasRef as React.RefObject<HTMLCanvasElement>}
            className="absolute inset-0 pointer-events-none"
          />
          <div
            ref={debugRef as React.RefObject<HTMLDivElement>}
            className="absolute bottom-2 left-2 right-2 px-2.5 py-1 rounded bg-black/80 text-[10px] font-mono text-primary whitespace-nowrap overflow-x-auto pointer-events-none select-none"
          >
            (debug info will appear here once video plays)
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2 p-8 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-40"
          >
            <path d="m22 8-6 4 6 4V8Z" />
            <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
          </svg>
          <p className="text-sm">
            Pick a local video from the left panel to start.
          </p>
          <p className="text-xs text-muted-foreground opacity-80 max-w-md">
            Rendering uses object-fit:contain math on the full stage canvas —
            native bbox coords from YOLO are scaled and translated to match the
            exact rendered video rectangle.
          </p>
        </div>
      )}
    </div>
  );
}
