from __future__ import annotations

import math
import random
from typing import Literal

from app.config import get_settings
from app.logging_setup import logger
from app.types import HighlightCandidate, PipelineContext

_HL_TYPES: tuple[
    Literal[
        "MADE_BASKET",
        "THREE_POINTER",
        "ASSIST",
        "STEAL",
        "BLOCK",
        "REBOUND",
        "OTHER",
    ],
    ...,
] = (
    "MADE_BASKET",
    "MADE_BASKET",
    "MADE_BASKET",
    "THREE_POINTER",
    "THREE_POINTER",
    "ASSIST",
    "STEAL",
    "BLOCK",
    "REBOUND",
)


def _components_for(rnd: random.Random) -> dict[str, float]:
    return {
        "ball_tracking": round(0.6 + rnd.random() * 0.4, 3),
        "trajectory": round(0.5 + rnd.random() * 0.5, 3),
        "hoop_interaction": round(0.7 + rnd.random() * 0.3, 3),
        "temporal_consistency": round(0.4 + rnd.random() * 0.6, 3),
    }


def _weighted(components: dict[str, float]) -> float:
    weights = {
        "ball_tracking": 0.20,
        "trajectory": 0.30,
        "hoop_interaction": 0.35,
        "temporal_consistency": 0.15,
    }
    total = sum(components.get(k, 0.0) * w for k, w in weights.items())
    return min(1.0, max(0.0, total))


def generate_demo_highlights(ctx: PipelineContext) -> list[HighlightCandidate]:
    """
    Generate pseudo-highlights deterministically from video duration.
    Used when real vision models are not plugged in yet; guarantees a
    non-empty highlight list so the pipeline always produces downstream
    (Flutter Review / Export UI) demo data.
    """
    settings = get_settings()
    duration = max(1.0, float(ctx.metadata.duration_sec or 60.0))

    if settings.ai_demo_highlight_count and settings.ai_demo_highlight_count > 0:
        count = settings.ai_demo_highlight_count
    else:
        count = max(1, int(math.ceil(duration / 30.0)))

    rnd = random.Random(settings.ai_demo_seed + hash(ctx.video_id) % (2**31))

    # Spread event_times evenly across [10% … 95%] of duration, plus small jitter
    positions = [
        0.10 + 0.85 * (i / max(1, count - 1)) for i in range(count)
    ] if count > 1 else [0.5]

    out: list[HighlightCandidate] = []
    for p in positions:
        jitter = rnd.uniform(-0.02, 0.02)
        event_time = max(0.5, min(duration - 0.5, duration * (p + jitter)))
        components = _components_for(rnd)
        confidence = _weighted(components)
        if confidence < settings.ai_confidence_threshold:
            # nudge to always pass threshold in demo mode — product wants highlights
            confidence = settings.ai_confidence_threshold + rnd.uniform(0.0, 0.05)

        out.append(
            HighlightCandidate(
                event_time_sec=event_time,
                start_sec=0.0,
                end_sec=0.0,
                confidence=round(confidence, 3),
                type=_HL_TYPES[rnd.randrange(len(_HL_TYPES))],
                components=components,
                metadata={
                    "demo": True,
                    "seed": settings.ai_demo_seed,
                    "source": "demo-generator",
                },
            )
        )

    out.sort(key=lambda h: h.event_time_sec)
    logger.info(
        f"[DEMO MODE] Generated {len(out)} pseudo-highlights "
        f"(duration={duration:.1f}s, count-setting={settings.ai_demo_highlight_count})"
    )
    return out
