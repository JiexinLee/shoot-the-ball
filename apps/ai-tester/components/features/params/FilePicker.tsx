import type { VideoMeta } from "@/types/detection";

export type FilePickerProps = {
  videoFile: File | null;
  videoMeta: VideoMeta | null;
  onChange: (file: File | null) => void;
};

export function FilePicker({ videoFile, videoMeta, onChange }: FilePickerProps) {
  return (
    <div>
      <label className="block text-sm font-semibold mb-2">1. Pick a video</label>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-muted-foreground
          file:mr-4 file:py-2 file:px-4
          file:rounded-md file:border-0
          file:text-sm file:font-semibold
          file:bg-primary file:text-primary-foreground
          hover:file:opacity-90 cursor-pointer"
      />
      {videoFile && (
        <p className="mt-2 text-xs text-muted-foreground break-all">
          {videoFile.name} · {(videoFile.size / 1024 / 1024).toFixed(2)} MB
          {videoMeta && (
            <>
              {" · "}
              <span className="text-primary font-mono">
                {videoMeta.w}×{videoMeta.h}
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
