from __future__ import annotations

from typing import Optional

from app.config import get_settings
from app.types import HighlightCandidate, PipelineContext

settings = get_settings()


def compute_confidence(
    ctx: PipelineContext,
    candidate: Optional[HighlightCandidate],
) -> None:
    """
    Populate confidence sub-scores for a made-basket candidate.
    Components: ball_tracking / trajectory / hoop_interaction / temporal_consistency
    """
    if candidate is None:
        return
    components = dict(candidate.components)
    for key in ("ball_tracking", "trajectory", "hoop_interaction", "temporal_consistency"):
        components.setdefault(key, 0.0)
    candidate.components = components

    weights = {
        "ball_tracking": 0.20,
        "trajectory": 0.30,
        "hoop_interaction": 0.35,
        "temporal_consistency": 0.15,
    }
    total = sum(components.get(k, 0.0) * w for k, w in weights.items())
    candidate.confidence = min(1.0, max(0.0, total))
