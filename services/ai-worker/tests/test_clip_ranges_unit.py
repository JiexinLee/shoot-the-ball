from __future__ import annotations

from pathlib import Path

import pytest

from app.clips.highlight_generator import build_clip_ranges
from app.config import get_settings
from app.types import HighlightCandidate, PipelineContext, VideoMetadata


def _make_ctx(
    duration: float,
    highlights: list[HighlightCandidate],
    pre: float = 5.0,
    post: float = 3.0,
) -> PipelineContext:
    settings = get_settings().model_copy(
        update={
            "ai_default_highlight_pre_seconds": pre,
            "ai_default_highlight_post_seconds": post,
        }
    )
    # Patch the singleton via env — easier in test: monkeypatch env instead
    import os

    os.environ["AI_DEFAULT_HIGHLIGHT_PRE_SECONDS"] = str(pre)
    os.environ["AI_DEFAULT_HIGHLIGHT_POST_SECONDS"] = str(post)

    # Force reload of lru_cached settings
    from app import config as _cfg

    _cfg.get_settings.cache_clear()

    ctx = PipelineContext(video_id="v", project_id="p", user_id="u")
    ctx.metadata = VideoMetadata(
        path="tmp.mp4",
        duration_sec=duration,
        fps=30,
        width=1280,
        height=720,
        total_frames=int(30 * duration),
        codec="h264",
    )
    ctx.highlights = highlights
    return ctx


def test_clip_default_padding() -> None:
    h = HighlightCandidate(
        event_time_sec=60.0, start_sec=0, end_sec=0, confidence=0.9
    )
    ctx = _make_ctx(duration=120.0, highlights=[h], pre=5.0, post=3.0)
    build_clip_ranges(ctx)
    assert ctx.highlights[0].start_sec == 55.0
    assert ctx.highlights[0].end_sec == 63.0


def test_clip_clamps_bounds() -> None:
    early = HighlightCandidate(
        event_time_sec=1.0, start_sec=0, end_sec=0, confidence=0.9
    )
    late = HighlightCandidate(
        event_time_sec=119.0, start_sec=0, end_sec=0, confidence=0.9
    )
    ctx = _make_ctx(duration=120.0, highlights=[early, late], pre=10.0, post=5.0)
    build_clip_ranges(ctx)
    assert ctx.highlights[0].start_sec == 0.0, "start before 0 clamped to 0"
    assert ctx.highlights[0].end_sec == 1.0 + 5.0
    assert ctx.highlights[1].start_sec == 119.0 - 10.0
    assert ctx.highlights[1].end_sec == 120.0, "end > duration clamped to duration"


def test_clip_zero_duration_video_safe() -> None:
    """Shouldn't crash when duration unknown (0.0)."""
    h = HighlightCandidate(
        event_time_sec=10.0, start_sec=0, end_sec=0, confidence=0.9
    )
    ctx = _make_ctx(duration=0.0, highlights=[h])
    build_clip_ranges(ctx)
    # start is clamped to 0, end = event + post (default fallback no clamp)
    assert ctx.highlights[0].start_sec == 0.0
    assert ctx.highlights[0].end_sec > 10.0
