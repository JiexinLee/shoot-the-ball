"use client";

import { useState } from "react";
import { ExternalLink, Sparkles, Activity, Cpu } from "lucide-react";
import { VideoUploader, type UploadedVideo } from "@/components/video-uploader";
import { VideoPreviewDialog } from "@/components/video-preview-dialog";
import { Button } from "@/components/ui/button";

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg shadow-[var(--primary)]/20">
        <Activity className="h-5 w-5" strokeWidth={2.6} />
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--background)] ring-2 ring-[var(--card)]">
          <span className="block h-2 w-2 rounded-full bg-[var(--primary)]" />
        </span>
      </div>
      <div className="leading-tight">
        <div className="text-lg font-extrabold tracking-tight">
          Shoot <span className="text-[var(--primary)]">The</span> Ball
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          篮球高光 · 智能剪辑控制台
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [preview, setPreview] = useState<UploadedVideo | null>(null);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="hidden items-center gap-4 sm:flex">
            <Button variant="ghost" size="sm">
              <Sparkles className="h-4 w-4 text-[var(--primary)]" /> AI Pipeline
            </Button>
            <Button variant="ghost" size="sm">
              <Cpu className="h-4 w-4 text-[var(--primary)]" /> Worker 状态
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="text-[var(--muted-foreground)]"
            >
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="GitHub"
              >
                <ExternalLink className="h-4 w-4" /> 代码仓库
              </a>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--border)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(1200px 400px at 50% -10%, rgba(250,204,21,0.15), transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 sm:py-18">
          <div className="flex flex-col items-start gap-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-xs font-medium text-[var(--primary)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--primary)]" />
              </span>
              开发模式 · 本地预览版（模拟上传进度，文件不会离开浏览器）
            </span>
            <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              把你的整场录像
              <br />
              <span className="bg-gradient-to-r from-[var(--primary)] to-[var(--accent)] bg-clip-text text-transparent">
                秒级切出精彩瞬间
              </span>
            </h1>
            <p className="max-w-2xl text-base text-[var(--muted-foreground)] sm:text-lg">
              拖拽上传 MP4 / MOV / MKV 等任意篮球比赛视频，AI Worker
              会自动识别「进球、三分、助攻、抢断、盖帽」等事件，
              自动生成每个瞬间的独立短视频 +
              整场集锦。下面就是你日常调试上传链路用的工作台。
            </p>
          </div>
        </div>
      </section>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <VideoUploader onPreview={setPreview} />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <p className="text-xs text-[var(--muted-foreground)]">
            © {new Date().getFullYear()} Shoot The Ball ·
            本控制台仅用于开发调试，暂未接入真实上传接口。
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            技术栈：<span className="text-[var(--primary)]">Next.js 16</span> ·
            Tailwind v4 · shadcn/ui · pnpm workspace
          </p>
        </div>
      </footer>

      <VideoPreviewDialog video={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
