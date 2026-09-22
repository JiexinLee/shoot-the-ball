from __future__ import annotations

from app.config import get_settings
from app.logging_setup import logger
from app.types import PipelineContext

settings = get_settings()


def coarse_sampling(ctx: PipelineContext) -> tuple[list[int], list[float]]:
    """
    Coarse sampling stage: produce a list of frame indices and timestamps
    at a low FPS (default 2 fps) focusing on the hoop ROI.
    Returns (frame_indices, timestamps_sec).
    """
    meta = ctx.metadata
    if meta.total_frames <= 0 or meta.fps <= 0:
        logger.warning("No video metadata, returning empty coarse sample")
        return [], []

    step = max(1, int(round(meta.fps / settings.ai_coarse_fps)))
    frames: list[int] = list(range(0, meta.total_frames, step))
    times: list[float] = [f / meta.fps for f in frames]
    logger.info(
        f"Coarse sampling: {len(frames)} frames out of {meta.total_frames}, "
        f"step={step} (~{settings.ai_coarse_fps} fps)"
    )
    return frames, times
