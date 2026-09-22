from __future__ import annotations

from app.config import get_settings
from app.logging_setup import logger
from app.types import PipelineContext

settings = get_settings()


def build_clip_ranges(ctx: PipelineContext) -> None:
    """
    For each highlight, set default start/end clip ranges around the event time
    (pre + post seconds configured via env).
    """
    pre = settings.ai_default_highlight_pre_seconds
    post = settings.ai_default_highlight_post_seconds
    duration = ctx.metadata.duration_sec

    for h in ctx.highlights:
        h.start_sec = max(0.0, h.event_time_sec - pre)
        h.end_sec = min(duration, h.event_time_sec + post) if duration else h.event_time_sec + post
    logger.info(f"Built clip ranges for {len(ctx.highlights)} highlights (pre={pre}s post={post}s)")
