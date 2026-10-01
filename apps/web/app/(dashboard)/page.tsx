"use client";

import { useState } from "react";
import {
  VideoUploader,
  VideoPreviewDialog,
  type UploadedVideo,
} from "@/components/video";

export default function HomePage() {
  const [preview, setPreview] = useState<UploadedVideo | null>(null);

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <VideoUploader onPreview={setPreview} />
      <VideoPreviewDialog video={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
