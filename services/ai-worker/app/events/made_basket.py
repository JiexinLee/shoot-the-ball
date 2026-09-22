from __future__ import annotations

from typing import Optional

from app.pipeline.fine import FineWindow
from app.types import HighlightCandidate, PipelineContext
from app.logging_setup import logger


def verify_made_basket(
    ctx: PipelineContext,
    window: FineWindow,
) -> Optional[HighlightCandidate]:
    """
    Verify whether a shot candidate resulted in a made basket.
    Uses fine-sampled detections around the hoop ROI.
    Placeholder returns None; integrate real classifier here.
    """
    logger.debug(
        f"verify_made_basket candidate peak={window.candidate.peak_sec:.2f}s"
    )
    return None
