from __future__ import annotations

from app.logging_setup import logger
from app.types import HighlightCandidate


def deduplicate_highlights(
    candidates: list[HighlightCandidate],
    time_tolerance_sec: float = 1.5,
) -> list[HighlightCandidate]:
    """
    Cluster candidates that are too close in time, keep the one with highest confidence.
    """
    if not candidates:
        return []

    sorted_cands = sorted(candidates, key=lambda c: c.event_time_sec)
    clusters: list[list[HighlightCandidate]] = []
    current_cluster: list[HighlightCandidate] = [sorted_cands[0]]

    for cand in sorted_cands[1:]:
        anchor = current_cluster[0]
        if abs(cand.event_time_sec - anchor.event_time_sec) <= time_tolerance_sec:
            current_cluster.append(cand)
        else:
            clusters.append(current_cluster)
            current_cluster = [cand]
    if current_cluster:
        clusters.append(current_cluster)

    result = [max(c, key=lambda x: x.confidence) for c in clusters]
    logger.info(
        f"Deduplicated {len(candidates)} -> {len(result)} highlights"
    )
    return result
