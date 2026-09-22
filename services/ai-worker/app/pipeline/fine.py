from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings
from app.detectors.ball_detector import BallDetector
from app.detectors.hoop_detector import HoopDetector
from app.logging_setup import logger
from app.types import PipelineContext, ShotCandidate

settings = get_settings()


@dataclass
class FineWindow:
    candidate: ShotCandidate
    frame_indices: list[int]
    timestamps: list[float]


def fine_verification(
    ctx: PipelineContext,
    ball_det: BallDetector,
    hoop_det: HoopDetector,
) -> list[FineWindow]:
    """
    Produce high-FPS verification windows only around coarse shot candidates.
    Returns a list of FineWindow (one per candidate).
    """
    meta = ctx.metadata
    if meta.fps <= 0 or meta.total_frames <= 0:
        return []

    step = max(1, int(round(meta.fps / settings.ai_fine_fps)))
    windows: list[FineWindow] = []

    for cand in ctx.shot_candidates:
        start_sec = max(0.0, cand.start_sec - 1.0)
        end_sec = min(meta.duration_sec, cand.end_sec + 1.0)
        start_f = max(0, int(start_sec * meta.fps))
        end_f = min(meta.total_frames - 1, int(end_sec * meta.fps))
        frames = list(range(start_f, end_f + 1, step))
        times = [f / meta.fps for f in frames]
        windows.append(FineWindow(candidate=cand, frame_indices=frames, timestamps=times))

    logger.info(f"Fine verification: {len(windows)} windows")
    return windows
