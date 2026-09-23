from __future__ import annotations

import math

from app.events.confidence import compute_confidence
from app.types import HighlightCandidate, PipelineContext


def _ctx() -> PipelineContext:
    return PipelineContext(video_id="v", project_id="p", user_id="u")


def test_confidence_is_weighted_sum() -> None:
    """Weights: 0.2 tracking + 0.3 trajectory + 0.35 hoop + 0.15 consistency = 1.0 total."""
    components = {
        "ball_tracking": 0.80,
        "trajectory": 0.90,
        "hoop_interaction": 0.95,
        "temporal_consistency": 0.70,
    }
    expected = (
        0.80 * 0.20
        + 0.90 * 0.30
        + 0.95 * 0.35
        + 0.70 * 0.15
    )  # = 0.8775
    h = HighlightCandidate(
        event_time_sec=10.0,
        start_sec=5.0,
        end_sec=13.0,
        confidence=0.0,
        components=components,
    )
    compute_confidence(_ctx(), h)

    assert math.isclose(h.confidence, expected, abs_tol=0.001), (
        f"expected {expected:.4f}, got {h.confidence:.4f}"
    )


def test_confidence_missing_components_defaults_zero() -> None:
    """If some components are missing, setdefault fills 0."""
    h = HighlightCandidate(
        event_time_sec=10.0,
        start_sec=5.0,
        end_sec=13.0,
        confidence=0.0,
        components={},
    )
    compute_confidence(_ctx(), h)
    assert set(h.components.keys()) == {
        "ball_tracking",
        "trajectory",
        "hoop_interaction",
        "temporal_consistency",
    }
    assert h.confidence == 0.0


def test_confidence_clamped_0_1() -> None:
    """Even if sum overflows (components >1 manually), clamp result to [0,1]."""
    h = HighlightCandidate(
        event_time_sec=10.0,
        start_sec=5.0,
        end_sec=13.0,
        confidence=0.0,
        components={
            "ball_tracking": 2.0,
            "trajectory": 2.0,
            "hoop_interaction": 2.0,
            "temporal_consistency": 2.0,
        },
    )
    compute_confidence(_ctx(), h)
    assert 0.0 <= h.confidence <= 1.0
    assert h.confidence == 1.0


def test_confidence_skips_none() -> None:
    """candidate=None -> no crash, no side effects."""
    compute_confidence(_ctx(), None)
