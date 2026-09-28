"use client";

import { useState } from "react";
import {
  VideoUploader,
  VideoPreviewDialog,
  type UploadedVideo,
} from "@/components/video";
import { PageHeader } from "@/components/shared";

export default function HomePage() {
  const [preview, setPreview] = useState<UploadedVideo | null>(null);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Upload & Process"
        description="Drag and drop basketball game videos to auto-detect made baskets, assists, steals and generate highlight clips."
      />

      <section className="relative mt-10 overflow-hidden border-b border-[var(--border)] rounded-2xl mb-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(1200px 400px at 50% -10%, rgba(250,204,21,0.15), transparent 60%)",
          }}
        />
        <div className="p-8 sm:p-10">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-xs font-medium text-[var(--primary)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--primary)]" />
            </span>
            Dev Mode · Local Preview (simulated upload progress, files stay in
            browser)
          </span>
          <h1 className="mt-4 max-w-3xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Turn your full-game footage into
            <br />
            <span className="bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] bg-clip-text text-transparent">
              highlight clips in seconds
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-[var(--muted-foreground)] sm:text-lg">
            Drag and drop any basketball game video (MP4 / MOV / MKV, etc.),
            and the AI Worker will automatically detect events like &quot;Made
            Basket, 3-pointer, Assist, Steal, Block&quot;, generating
            individual clips for each moment plus a full-game montage. Below is
            your daily workbench for debugging the upload pipeline.
          </p>
        </div>
      </section>

      <VideoUploader onPreview={setPreview} />
      <VideoPreviewDialog video={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
