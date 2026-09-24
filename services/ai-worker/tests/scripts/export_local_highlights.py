#!/usr/bin/env python3
"""
本地一键跑 pipeline + 根据 highlight 把片段剪出来，存到本地目录。

用法:
    # 1) 真实模式（需要你的 detector 真的能检出球/筐，否则 0 个 clip）
    poetry run python tests/scripts/export_local_highlights.py \
        --video /path/to/input.mp4 \
        --output-dir <out-dir>

    # 2) Demo 模式（没有模型也能测试：确定性生成几个假 highlight，验证剪辑链路）
    AI_DEMO_MODE=1 AI_DEMO_HIGHLIGHT_COUNT=5 \
    poetry run python tests/scripts/export_local_highlights.py \
        --video /Users/jiexinli/MyProjects/shoot-the-ball/assets/testing-video.MP4 \
        --output-dir <out-dir> \
        --merge
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from app.clips.highlight_generator import build_clip_ranges  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.ffmpeg.concat import concat_clips  # noqa: E402
from app.ffmpeg.trim import trim_clip  # noqa: E402
from app.logging_setup import logger  # noqa: E402
from app.pipeline.pipeline import HighlightPipeline  # noqa: E402
from app.types import PipelineContext, VideoMetadata  # noqa: E402
from app.ffmpeg.metadata import probe_video  # noqa: E402


def run_pipeline(video_path: Path, video_id: str = "dev-video",
                 project_id: str = "dev-project", user_id: str = "dev-user") -> PipelineContext:
    settings = get_settings()
    if settings.ai_demo_mode:
        logger.warning("AI_DEMO_MODE=1 — 用伪数据生成 highlights（不会跑真实检测器）")

    ctx = PipelineContext(video_id=video_id, project_id=project_id, user_id=user_id)
    ctx.metadata.path = str(video_path.resolve())

    try:
        p = probe_video(str(video_path))
        ctx.metadata = VideoMetadata(
            path=str(video_path.resolve()),
            duration_sec=float(p["duration_sec"]),
            fps=float(p["fps"]),
            width=int(p["width"]),
            height=int(p["height"]),
            total_frames=int(p["total_frames"]),
            codec=str(p["codec"]),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"probe_video 失败，fallback 到 pipeline 自己处理: {exc}")

    pipeline = HighlightPipeline()
    pipeline.run(ctx)
    build_clip_ranges(ctx)
    return ctx


def export_clips(video_path: Path, ctx: PipelineContext, output_dir: Path,
                 merge: bool = False, height: int | None = None) -> list[Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = output_dir / "highlights.json"
    manifest = [
        {
            "index": i,
            "event_time_sec": h.event_time_sec,
            "start_sec": h.start_sec,
            "end_sec": h.end_sec,
            "duration_sec": round(h.end_sec - h.start_sec, 3),
            "confidence": round(h.confidence, 4),
            "type": h.type,
            "components": h.components,
            "metadata": h.metadata,
            "file": f"highlight_{i:03d}.mp4",
        }
        for i, h in enumerate(ctx.highlights)
    ]
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    logger.info(f"写 highlights manifest -> {manifest_path}")

    clips: list[Path] = []
    for i, h in enumerate(ctx.highlights):
        clip_path = output_dir / f"highlight_{i:03d}.mp4"
        trim_clip(
            source=str(video_path.resolve()),
            start_sec=h.start_sec,
            end_sec=h.end_sec,
            output=str(clip_path),
            reencode=True,
            height=height,
        )
        clips.append(clip_path)

    if merge and clips:
        merged = output_dir / "merged_highlights.mp4"
        concat_clips([str(c) for c in clips], str(merged))
        clips.append(merged)
        logger.info(f"合并后的集锦 -> {merged}")

    return clips


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="输入视频路径")
    parser.add_argument("--output-dir", required=True, help="剪辑输出目录")
    parser.add_argument("--merge", action="store_true", help="把所有 highlight 再合成一个集锦 mp4")
    parser.add_argument("--height", type=int, default=None,
                        help="可选：缩放剪辑高度（如 720 代表 720p，保持宽高比），不传则原分辨率")
    args = parser.parse_args()

    video = Path(args.video).expanduser().resolve()
    out = Path(args.output_dir).expanduser().resolve()
    if not video.exists():
        logger.error(f"视频不存在: {video}")
        sys.exit(1)

    ctx = run_pipeline(video)
    if not ctx.highlights:
        settings = get_settings()
        if not settings.ai_demo_mode:
            logger.warning(
                "没有检测到任何 highlight，导不出 clip。"
                "如果想先测试剪辑链路，可以加环境变量: "
                "AI_DEMO_MODE=1 AI_DEMO_HIGHLIGHT_COUNT=5"
            )
        else:
            logger.warning("Demo 模式下也没有 highlight，检查 seed/count 配置")
        return

    clips = export_clips(video, ctx, out, merge=args.merge, height=args.height)
    logger.info(f"全部完成 ✅ 共导出 {len(ctx.highlights)} 个 clip:")
    for p in clips:
        size_kb = p.stat().st_size / 1024 if p.exists() else 0
        print(f"  - {p}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
